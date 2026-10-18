import { NextRequest } from 'next/server';
import { debugVisionProviders } from '@/lib/agent/vision';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** TEMPORARY diagnostic route — reports vision provider health (no secrets). */
export async function GET(_req: NextRequest) {
  try {
    const results = await debugVisionProviders();
    return Response.json({ ok: true, results });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
