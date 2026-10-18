/**
 * DL AGENT "eyes" — image understanding without any paid API key.
 *
 * Provider chain (first that answers wins):
 *   1. VISION_API_URL + VISION_API_KEY (+ VISION_MODEL)  → any OpenAI-compatible
 *      vision endpoint. Deployed default: GitHub Models (free with a GitHub PAT),
 *      e.g.  VISION_API_URL=https://models.github.ai/inference
 *            VISION_MODEL=openai/gpt-4o-mini
 *            VISION_FALLBACK_MODELS=meta/llama-4-scout-17b-16e-instruct,mistral-ai/pixtral-12b-2409
 *      (fallback models absorb per-model rate limits automatically)
 *   2. No env configured → Pollinations text API (kept for local dev; often
 *      rate-limited or text-only these days, so it may fail — that's fine).
 *   3. Last resort: OCR text extraction (ocr.space free tier). Not "seeing",
 *      but recovers visible TEXT from screenshots/memes so the agent can still help.
 *
 * If everything fails the caller gets VisionBusyError (rate-limit/429 class) or
 * VisionError (hard failure) and the agent loop degrades gracefully.
 */

const VISION_URL = process.env.VISION_API_URL || 'https://text.pollinations.ai/openai';
const VISION_KEY = process.env.VISION_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'openai';
const VISION_FALLBACK_MODELS = (process.env.VISION_FALLBACK_MODELS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const OCR_KEY = process.env.OCR_SPACE_KEY || 'helloworld';

export class VisionBusyError extends Error {
  constructor(msg = 'all vision providers are rate-limited right now') {
    super(msg);
    this.name = 'VisionBusyError';
  }
}

export class VisionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'VisionError';
  }
}

const DESCRIBE_PROMPT =
  'Describe this image precisely for a blind AI assistant: main subjects, any visible text ' +
  '(transcribe it exactly), colors, setting/context, and anything important or unusual. ' +
  '3-6 sentences, purely factual, no preamble like "Sure" or "This image shows".';

interface VisionChoice {
  message?: { content?: string };
}

/** Base URL → full chat-completions endpoint (handles pollinations-style paths). */
function visionEndpoint(base: string): string {
  const b = base.replace(/\/+$/, '');
  if (b.endsWith('/chat/completions') || b.endsWith('/openai')) return b;
  return `${b}/chat/completions`;
}

async function callVisionProvider(dataUrl: string, model: string, question?: string): Promise<string> {
  const userText = question
    ? `${DESCRIBE_PROMPT}\n\nThe user specifically asks: "${question.slice(0, 300)}" — make sure the description covers the answer.`
    : DESCRIBE_PROMPT;

  const res = await fetch(visionEndpoint(VISION_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // GitHub API (models.github.ai) REQUIRES a User-Agent — bare fetch sends none → 403
      'User-Agent': 'DL-Agent/2.0 (+https://death-legion.agent)',
      ...(VISION_KEY ? { Authorization: `Bearer ${VISION_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
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
    signal: AbortSignal.timeout(28000),
  });

  if (res.status === 429 || res.status === 402 || res.status === 503) {
    throw new VisionBusyError(`provider ${model} rate-limited (HTTP ${res.status})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new VisionError(`vision credentials rejected (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new VisionError(`vision HTTP ${res.status}`);
  }

  const raw = await res.text();
  let json: { choices?: VisionChoice[] };
  try {
    json = JSON.parse(raw) as { choices?: VisionChoice[] };
  } catch {
    throw new VisionError('vision provider returned a non-JSON response');
  }
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new VisionError('vision returned empty response');
  return text.slice(0, 1400);
}

/**
 * Diagnostic (NO secrets returned): call every vision model once with a tiny
 * 1×1 png and report HTTP status + short body snippet per model. Used by the
 * temporary /api/vision-debug route to verify provider health from the host.
 */
export async function debugVisionProviders(): Promise<unknown[]> {
  const tiny =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const out: unknown[] = [];
  for (const model of [VISION_MODEL, ...VISION_FALLBACK_MODELS]) {
    try {
      const text = await callVisionProvider(tiny, model);
      out.push({ model, ok: true, snippet: text.slice(0, 120) });
    } catch (e) {
      out.push({
        model,
        ok: false,
        kind: e instanceof VisionBusyError ? 'busy' : e instanceof VisionError ? 'error' : 'crash',
        message: (e as Error).message.slice(0, 200),
      });
    }
  }
  try {
    const t = await ocrExtract(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    );
    out.push({ model: 'ocr-space', ok: true, snippet: t.slice(0, 120) });
  } catch (e) {
    out.push({ model: 'ocr-space', ok: false, message: (e as Error).message.slice(0, 200) });
  }
  return out;
}

/* ---------------- OCR fallback (text extraction) ---------------- */

async function ocrExtract(dataUrl: string): Promise<string> {
  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      apikey: OCR_KEY,
      base64Image: dataUrl,
      OCREngine: '2',
      scale: 'true',
      detectOrientation: 'true',
    }).toString(),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new VisionError(`ocr HTTP ${res.status}`);
  const j = (await res.json()) as {
    ParsedResults?: { ParsedText?: string }[];
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string | string[];
  };
  if (j.IsErroredOnProcessing) {
    const msg = Array.isArray(j.ErrorMessage) ? j.ErrorMessage.join('; ') : j.ErrorMessage;
    throw new VisionError(`ocr failed: ${msg ?? 'unknown'}`);
  }
  const text = (j.ParsedResults ?? [])
    .map((r) => (r.ParsedText ?? '').replace(/\r/g, '').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 1200);
  if (!text) throw new VisionError('no readable text found in image');
  return `Text extracted from the image (OCR — I cannot see the visuals, only read this text):\n${text}`;
}

/* ---------------- public API ---------------- */

/**
 * Describe an image (data URL). Tries every configured vision model first,
 * then falls back to OCR text extraction. No long sleeps — users get an
 * answer (or an honest failure) in seconds.
 */
export async function describeImage(dataUrl: string, question?: string): Promise<string> {
  const models = [VISION_MODEL, ...VISION_FALLBACK_MODELS];
  let sawBusy = false;
  let lastErr: Error | null = null;

  // Tier 1+2: vision providers (one attempt each, no long waits)
  for (const model of models) {
    try {
      return await callVisionProvider(dataUrl, model, question);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (e instanceof VisionBusyError) {
        sawBusy = true;
        continue; // next model in the chain may still have quota
      }
      if (e instanceof VisionError) continue; // hard fail on this model → next
      // network/timeout fluke → one quick retry on the same model
      try {
        return await callVisionProvider(dataUrl, model, question);
      } catch (e2) {
        lastErr = e2 instanceof Error ? e2 : new Error(String(e2));
        if (e2 instanceof VisionBusyError) sawBusy = true;
        continue;
      }
    }
  }

  // Tier 3: OCR text extraction (always worth one shot — screenshots are common)
  try {
    return await ocrExtract(dataUrl);
  } catch (ocrErr) {
    lastErr = ocrErr instanceof Error ? ocrErr : new Error(String(ocrErr));
  }

  if (sawBusy) {
    throw new VisionBusyError('vision models rate-limited and OCR could not read the image');
  }
  throw new VisionError(`image analysis failed: ${lastErr?.message ?? 'unknown error'}`);
}
