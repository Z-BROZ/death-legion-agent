import { NextRequest } from 'next/server';
import { SYSTEM_PROMPT } from '@/lib/agent/prompt';
import { createBrain } from '@/lib/agent/brain';
import { containsFakeToolResult, executeTool, parseToolCall, rescueToolCall } from '@/lib/agent/tools';
import { describeImage, VisionBusyError } from '@/lib/agent/vision';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[]; // data URLs — only honoured on the LAST user message
}

const MAX_STEPS = 6;
const MAX_HISTORY = 16;
const MAX_IMAGES = 2;
const MAX_IMAGE_CHARS = 3_500_000; // ~2.6 MB binary per image

type SseEvent =
  | { type: 'status'; text: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; ok: boolean; preview: string }
  | { type: 'answer'; content: string }
  | { type: 'error'; message: string };

function toolPreview(result: { ok: boolean; data?: unknown; error?: string }): string {
  if (!result.ok) return result.error ?? 'error';
  const d = result.data as
    | { count?: number; results?: unknown[]; output?: string; text?: string; description?: string }
    | {
        image_url?: string;
        filename?: string;
        size_human?: string;
        place?: string;
        current?: { temperature_c?: number; condition?: string };
        pretty?: string;
        value?: string;
        title?: string;
      }
    | undefined;
  if (d && typeof d === 'object') {
    if (typeof d.output === 'string') return d.output.slice(0, 500);
    if (typeof d.count === 'number' && Array.isArray(d.results)) return `${d.count} results found`;
    if (typeof d.description === 'string') return d.description.slice(0, 300);
    if ('image_url' in d && typeof d.image_url === 'string') return `image generated: ${d.image_url.slice(0, 120)}`;
    if ('filename' in d) return `${d.filename} (${d.size_human ?? '?'})`;
    if ('place' in d && d.current) return `${d.place}: ${d.current.temperature_c}°C, ${d.current.condition}`;
    if (typeof d.pretty === 'string') return d.pretty.slice(0, 300);
    if (typeof d.value === 'string') return d.value.slice(0, 300);
    if (typeof d.title === 'string' && typeof d.text === 'string') return `${d.title} — ${d.text.slice(0, 250)}`;
    if (typeof d.text === 'string') return d.text.slice(0, 400);
  }
  try {
    return JSON.stringify(result.data).slice(0, 300);
  } catch {
    return 'done';
  }
}

/** Build "[ATTACHED IMAGE n] …" blocks for user-uploaded images. */
async function processImages(images: string[], send: (ev: SseEvent) => void): Promise<string> {
  const blocks: string[] = [];
  for (let i = 0; i < images.length; i++) {
    send({ type: 'status', text: `Analyzing image ${i + 1}…` });
    let desc: string;
    try {
      desc = await describeImage(images[i]);
    } catch (e) {
      const busy = e instanceof VisionBusyError;
      desc = busy
        ? '(The vision models are all rate-limited right now — you CANNOT see this image, and OCR could not read it. IMPORTANT: do NOT invent or guess image URLs, do NOT call see_image with a made-up URL, and do NOT guess what the image shows. Honestly tell the user — in their language — that image viewing is temporarily unavailable, and ask them to try again in a few minutes or type out what the image contains.)'
        : `(Image analysis failed: ${(e as Error).message} — you CANNOT see this image. Do NOT invent image URLs, do NOT guess its contents, do NOT simulate seeing it. Honestly tell the user — in their language — that you could not analyze the image right now, and ask them to try again or describe it in text.)`;
    }
    blocks.push(`[ATTACHED IMAGE ${i + 1}]\n${desc}`);
  }
  return blocks.join('\n\n');
}

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const history: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];
  if (history.length === 0 || history[history.length - 1]?.role !== 'user') {
    return Response.json({ error: 'messages must end with a user message' }, { status: 400 });
  }

  const convo: ChatMessage[] = history.slice(-MAX_HISTORY);
  const last = convo[convo.length - 1];

  // Validate + sanitize image attachments (last user message only).
  let images: string[] = [];
  if (Array.isArray(last.images)) {
    images = last.images
      .filter((s) => typeof s === 'string' && s.startsWith('data:image/'))
      .slice(0, MAX_IMAGES);
    if (images.some((s) => s.length > MAX_IMAGE_CHARS)) {
      return Response.json({ error: 'Image too large (max ~2.5MB after compression)' }, { status: 413 });
    }
  }
  // Strip images from ALL history entries (context stays text-only for the brain).
  for (const m of convo) {
    if (m.images) delete m.images;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      try {
        // Vision pass — describe attached images BEFORE the agent loop.
        if (images.length > 0) {
          const blocks = await processImages(images, send);
          last.content = `${last.content}\n\n${blocks}`.trim();
        }

        const brain = await createBrain();

        for (let step = 0; step <= MAX_STEPS; step++) {
          send({
            type: 'status',
            text: step === 0 ? 'Thinking…' : 'Reading results…',
          });

          const content: string = await brain.chat([
            { role: 'assistant', content: SYSTEM_PROMPT },
            ...convo,
          ]);
          const call = parseToolCall(content) ?? rescueToolCall(content);

          if (!call) {
            // Guard: model simulated a tool result instead of calling the tool
            if (containsFakeToolResult(content) && step < MAX_STEPS) {
              convo.push({ role: 'assistant', content });
              convo.push({
                role: 'user',
                content:
                  '[SYSTEM] You simulated a tool result yourself — that is NOT allowed and that output was fake. Do NOT write [TOOL_RESULT] blocks. Either call the real tool using ONLY the JSON format {"tool": "...", "args": {...}}, or write your final answer without any tool blocks.',
              });
              send({ type: 'status', text: 'Correcting course…' });
              continue;
            }
            send({ type: 'answer', content: content || '…' });
            break;
          }

          // --- tool call detected ---
          send({ type: 'tool_start', tool: call.tool, args: call.args });

          let result;
          try {
            result = await executeTool(brain, call);
          } catch (e) {
            result = { ok: false, error: `Tool crashed: ${String(e)}` };
          }

          send({
            type: 'tool_result',
            tool: call.tool,
            ok: result.ok,
            preview: toolPreview(result),
          });

          convo.push({ role: 'assistant', content: JSON.stringify({ tool: call.tool, args: call.args }) });
          convo.push({
            role: 'user',
            content: `[TOOL_RESULT ${call.tool}]\n${JSON.stringify(result).slice(0, 6000)}`,
          });

          if (step === MAX_STEPS) {
            convo.push({
              role: 'user',
              content:
                '[SYSTEM] Maximum tool steps reached. Write your final answer to the user NOW (no more tool calls).',
            });
            const final = await brain.chat([
              { role: 'assistant', content: SYSTEM_PROMPT },
              ...convo,
            ]);
            send({
              type: 'answer',
              content: parseToolCall(final)
                ? '⚠️ Tool limit reached. Please try rephrasing your question.'
                : final,
            });
            break;
          }
        }
      } catch (e) {
        send({ type: 'error', message: `Agent error: ${e instanceof Error ? e.message : String(e)}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
