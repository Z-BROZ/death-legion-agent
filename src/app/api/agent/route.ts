import { NextRequest } from 'next/server';
import { SYSTEM_PROMPT } from '@/lib/agent/prompt';
import { createBrain } from '@/lib/agent/brain';
import { containsFakeToolResult, executeTool, parseToolCall, rescueToolCall } from '@/lib/agent/tools';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_STEPS = 5;
const MAX_HISTORY = 16;

type SseEvent =
  | { type: 'status'; text: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; ok: boolean; preview: string }
  | { type: 'answer'; content: string }
  | { type: 'error'; message: string };

function toolPreview(result: { ok: boolean; data?: unknown; error?: string }): string {
  if (!result.ok) return result.error ?? 'error';
  const d = result.data as { count?: number; results?: unknown[]; output?: string } | undefined;
  if (d && typeof d === 'object') {
    if (typeof d.output === 'string') return d.output.slice(0, 500);
    if (typeof d.count === 'number') return `${d.count} results found`;
  }
  try {
    return JSON.stringify(result.data).slice(0, 300);
  } catch {
    return 'done';
  }
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      try {
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
