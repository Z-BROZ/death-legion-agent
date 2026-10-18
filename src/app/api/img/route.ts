import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Image-gen proxy — hides the upstream generator host from the chat UI.
 * The agent hands out /api/img?prompt=...&w=&h=&seed= links; this route
 * fetches the real bytes server-side and streams them back, so users never
 * see a third-party generator domain (identity lock).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const prompt = (sp.get('prompt') ?? '').trim().slice(0, 500);
  const w = Math.max(256, Math.min(1024, Number(sp.get('w')) || 768));
  const h = Math.max(256, Math.min(1024, Number(sp.get('h')) || 768));
  const seed = Math.max(0, Math.min(9_999_999, Number(sp.get('seed')) || 0));

  if (!prompt) {
    return new Response('missing prompt', { status: 400 });
  }

  const upstream =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${w}&height=${h}&seed=${seed}&nologo=true`;

  try {
    const res = await fetch(upstream, {
      headers: {
        // some generators reject bare no-UA fetches
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
        Accept: 'image/*,*/*',
      },
      signal: AbortSignal.timeout(50000),
      redirect: 'follow',
    });
    if (!res.ok || !/^image\//i.test(res.headers.get('content-type') ?? '')) {
      return new Response('image generator unavailable', { status: 502 });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return new Response('image generator timeout', { status: 504 });
  }
}
