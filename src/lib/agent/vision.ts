/**
 * DL AGENT "eyes" — image understanding without any paid API key.
 *
 * Uses a free OpenAI-compatible vision endpoint (Pollinations text API by
 * default). Fully configurable via env so a better provider can be plugged in:
 *   VISION_API_URL  (default https://text.pollinations.ai/openai)
 *   VISION_API_KEY  (optional bearer)
 *   VISION_MODEL    (default "openai")
 *
 * Free tier is rate-limited to ~1 reply / 30s per IP, so we retry with
 * backoff. If vision stays busy, callers get VisionBusyError and the agent
 * loop degrades gracefully (user keeps seeing the image in chat).
 */

const VISION_URL = process.env.VISION_API_URL || 'https://text.pollinations.ai/openai';
const VISION_KEY = process.env.VISION_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'openai';

export class VisionBusyError extends Error {
  constructor() {
    super('vision service busy (rate-limited)');
    this.name = 'VisionBusyError';
  }
}

const DESCRIBE_PROMPT =
  'Describe this image precisely for a blind AI assistant: main subjects, any visible text ' +
  '(transcribe it exactly), colors, setting/context, and anything important or unusual. ' +
  '3-6 sentences, purely factual, no preamble like "Sure" or "This image shows".';

interface VisionChoice {
  message?: { content?: string };
}

async function callVision(dataUrl: string, question?: string): Promise<string> {
  const userText = question
    ? `${DESCRIBE_PROMPT}\n\nThe user specifically asks: "${question.slice(0, 300)}" — make sure the description covers the answer.`
    : DESCRIBE_PROMPT;

  const res = await fetch(VISION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(VISION_KEY ? { Authorization: `Bearer ${VISION_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(55000),
  });

  if (res.status === 402 || res.status === 429) throw new VisionBusyError();
  if (!res.ok) throw new Error(`vision HTTP ${res.status}`);

  const json = (await res.json()) as { choices?: VisionChoice[] };
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('vision returned empty response');
  return text.slice(0, 1400);
}

/**
 * Describe an image (data URL). Retries twice on rate-limit with ~21s
 * backoff (free tier window is 30s/IP). Non-busy errors fail fast.
 */
export async function describeImage(dataUrl: string, question?: string): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callVision(dataUrl, question);
    } catch (e) {
      lastErr = e;
      if (e instanceof VisionBusyError && attempt < 2) {
        await new Promise((r) => setTimeout(r, 21000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('vision failed');
}
