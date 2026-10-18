import vm from 'node:vm';
import type { AgentBrain } from './brain';
import { describeImage, VisionBusyError, VisionError } from './vision';

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

/* ---------------- shared helpers ---------------- */

const UA =
  'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** SSRF guard: only public http(s) URLs allowed for outbound tools. */
function assertPublicHttp(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(String(rawUrl).trim());
  } catch {
    throw new Error('invalid URL');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) URLs allowed');
  const h = u.hostname.toLowerCase();
  const blocked =
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '0.0.0.0' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === '[::1]' ||
    h.endsWith('.internal');
  if (blocked) throw new Error('private/internal addresses are blocked');
  return u;
}

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------------- Web Search ---------------- */

export interface SearchResultItem {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  date: string;
}

export async function webSearch(
  brain: AgentBrain,
  query: string,
  num = 6
): Promise<ToolResult> {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { ok: false, error: 'query is required' };
  }
  const clamped = Math.max(1, Math.min(10, Number(num) || 6));
  const results = await brain.search(query.trim(), clamped);

  const trimmed = (Array.isArray(results) ? results : []).slice(0, clamped).map((r) => ({
    name: r?.name ?? '',
    snippet: r?.snippet ?? '',
    url: r?.url ?? '',
    host_name: r?.host_name ?? '',
    date: r?.date ?? '',
  }));

  return { ok: true, data: { count: trimmed.length, results: trimmed } };
}

/* ---------------- JS Sandbox (upgraded: async, httpGet, console capture) ---------------- */

const BLACKLIST = [
  'require(',
  'process',
  'globalThis',
  'global.',
  'constructor(',
  'constructor[',
  'import(',
  '__proto__',
  'eval(',
  'Function(',
  'setTimeout',
  'setInterval',
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
];

function fmtVal(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

/** http(s) GET for sandboxed user code — the ONLY network escape hatch. */
async function sandboxHttpGet(rawUrl: string): Promise<string> {
  const u = assertPublicHttp(rawUrl);
  const res = await fetch(u, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  return `HTTP ${res.status}\n${text.slice(0, 8000)}`;
}

export async function runJs(code: string): Promise<ToolResult> {
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, error: 'code is required' };
  }
  for (const bad of BLACKLIST) {
    if (code.includes(bad)) {
      return {
        ok: false,
        error: `Sandbox blocked pattern "${bad}" — no system access allowed. Pure JS only (Math, JSON, Date, arrays). For HTTP use the httpGet(url) helper.`,
      };
    }
  }

  const logs: string[] = [];
  const push = (...args: unknown[]) => {
    if (logs.length < 200) logs.push(args.map(fmtVal).join(' '));
  };

  const sandbox: Record<string, unknown> = {
    console: { log: push, info: push, warn: push, error: push },
    httpGet: sandboxHttpGet,
    Math,
    JSON,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Error,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    NaN,
    Infinity,
    encodeURIComponent,
    decodeURIComponent,
  };

  try {
    const context = vm.createContext(sandbox);
    // Wrap in an async IIFE so top-level await works.
    const script = new vm.Script(`(async () => {\n${code}\n})()`, {
      filename: 'agent-sandbox.js',
    });
    const promise = script.runInContext(context, {
      timeout: 4000,
      displayErrors: true,
    }) as unknown;
    let result: unknown;
    try {
      result = await Promise.race([
        Promise.resolve(promise),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('Sandbox timeout: code exceeded 6 seconds')), 6000)
        ),
      ]);
    } catch (e) {
      const err = e as Error;
      return { ok: false, error: `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}` };
    }
    let output = logs.length > 0 ? logs.join('\n') : '(code ran, but no console.log output)';
    if (result !== undefined && result !== null && logs.length === 0) {
      output += `\n(return value: ${fmtVal(result)})`;
    }
    return { ok: true, data: { output } };
  } catch (e: unknown) {
    const err = e as Error;
    return { ok: false, error: `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}` };
  }
}

/* ---------------- Calculator (deathmode: calc) ---------------- */

export async function calc(expression: string): Promise<ToolResult> {
  const expr = String(expression ?? '').trim();
  if (!expr) return { ok: false, error: 'expression is required' };
  if (expr.length > 500) return { ok: false, error: 'expression too long' };
  // Evaluate through the JS sandbox for real, safe math.
  return runJs(`console.log(String((${expr})));`);
}

/* ---------------- JSON parse (deathmode: json_parse) ---------------- */

function walkPath(obj: unknown, path: string): unknown {
  const segs = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur: unknown = obj;
  for (const s of segs) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

export function jsonParse(text: string, path?: string): ToolResult {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: 'text is required' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (path && path.trim()) {
    const value = walkPath(parsed, path.trim());
    return {
      ok: true,
      data: {
        valid: true,
        path: path.trim(),
        found: value !== undefined,
        value: JSON.stringify(value ?? null, null, 2).slice(0, 3000),
      },
    };
  }
  return {
    ok: true,
    data: { valid: true, pretty: JSON.stringify(parsed, null, 2).slice(0, 3000) },
  };
}

/* ---------------- Date & Time ---------------- */

export function getDatetime(): ToolResult {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(now);

  return {
    ok: true,
    data: {
      datetime_colombo: formatted,
      timezone: 'Asia/Colombo (Sri Lanka)',
      iso: now.toISOString(),
    },
  };
}

/* ---------------- Web page reader (deathmode: web_fetch / text_extract) ---------------- */

export async function webFetch(rawUrl: string): Promise<ToolResult> {
  let url: URL;
  try {
    url = assertPublicHttp(rawUrl);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json,text/*;q=0.8,*/*;q=0.5' },
      signal: AbortSignal.timeout(14000),
      redirect: 'follow',
    });
    const ct = res.headers.get('content-type') ?? '';

    if (/^image\//i.test(ct)) {
      return {
        ok: true,
        data: {
          kind: 'image',
          url: res.url || url.toString(),
          content_type: ct,
          note: 'This URL is an image. Use see_image with this URL to actually look at it.',
        },
      };
    }

    const raw = await res.text();
    let title = '';
    let body = raw;

    if (/json/i.test(ct) || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      try {
        body = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* keep raw */
      }
    } else {
      title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
      body = stripTags(raw);
    }

    return {
      ok: true,
      data: {
        kind: 'text',
        url: res.url || url.toString(),
        status: res.status,
        content_type: ct,
        title: stripTags(title).slice(0, 200),
        text: body.replace(/\s+\n/g, '\n').slice(0, 5500),
      },
    };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${(e as Error).message}` };
  }
}

/* ---------------- File download info (squad request) ---------------- */

function parseFilename(contentDisposition: string | null, url: URL): string {
  const cd = contentDisposition ?? '';
  const star = cd.match(/filename\*=(?:UTF-8''|utf-8'')([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/["']/g, '')).trim();
    } catch {
      /* fall through */
    }
  }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  if (plain?.[1]) return plain[1].trim();
  const seg = url.pathname.split('/').filter(Boolean).pop();
  if (seg) {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  }
  return 'download';
}

export async function downloadFile(rawUrl: string): Promise<ToolResult> {
  let url: URL;
  try {
    url = assertPublicHttp(rawUrl);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const pick = (res: Response) => ({
    content_type: res.headers.get('content-type') ?? 'unknown',
    size_bytes: Number(res.headers.get('content-length') ?? 0) || 0,
    filename: parseFilename(res.headers.get('content-disposition'), url),
    final_url: res.url || url.toString(),
  });

  try {
    let res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    if (!res.ok || (!res.headers.get('content-length') && !res.headers.get('content-type'))) {
      // Some servers hate HEAD — fall back to GET and cancel the body.
      res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      });
      await res.body?.cancel().catch(() => undefined);
    }
    const info = pick(res);
    if (!res.ok && res.status !== 206) {
      return { ok: false, error: `server responded HTTP ${res.status}` };
    }
    return {
      ok: true,
      data: {
        ...info,
        size_human: humanSize(info.size_bytes),
        download_url: info.final_url,
        note: 'Give the user this markdown link so they can download: [filename](download_url)',
      },
    };
  } catch (e) {
    return { ok: false, error: `download check failed: ${(e as Error).message}` };
  }
}

/* ---------------- Weather (open data, no key) ---------------- */

const WMO: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

const wmoText = (code: unknown) => WMO[Number(code)] ?? 'Unknown';

export async function weather(place: string): Promise<ToolResult> {
  const q = String(place ?? '').trim();
  if (!q) return { ok: false, error: 'place is required' };

  /* --- 1) wttr.in (primary, no key) --- */
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(q)}?format=j1&lang=en`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const j = (await res.json()) as {
        current_condition?: {
          temp_C: string;
          FeelsLikeC: string;
          humidity: string;
          windspeedKmph: string;
          weatherDesc?: { value: string }[];
        }[];
        nearest_area?: {
          areaName?: { value: string }[];
          region?: { value: string }[];
          country?: { value: string }[];
        }[];
        weather?: {
          date: string;
          maxtempC: string;
          mintempC: string;
          hourly?: { chanceofrain: string; weatherDesc?: { value: string }[] }[];
        }[];
      };
      const cur = j.current_condition?.[0];
      const area = j.nearest_area?.[0];
      if (cur) {
        return {
          ok: true,
          data: {
            place: area?.areaName?.[0]?.value ?? q,
            region: area?.region?.[0]?.value ?? '',
            country: area?.country?.[0]?.value ?? '',
            current: {
              temperature_c: Number(cur.temp_C),
              feels_like_c: Number(cur.FeelsLikeC),
              condition: cur.weatherDesc?.[0]?.value ?? '',
              humidity_percent: Number(cur.humidity),
              wind_kmh: Number(cur.windspeedKmph),
            },
            forecast: (j.weather ?? []).slice(0, 3).map((d) => ({
              date: d.date,
              condition: d.hourly?.[4]?.weatherDesc?.[0]?.value ?? '',
              max_c: Number(d.maxtempC),
              min_c: Number(d.mintempC),
              rain_chance_percent: Math.max(
                0,
                ...(d.hourly ?? []).map((h) => Number(h.chanceofrain) || 0)
              ),
            })),
          },
        };
      }
    }
  } catch {
    /* fall through to open-meteo */
  }

  /* --- 2) open-meteo (fallback, no key) --- */
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
      { signal: AbortSignal.timeout(10000) }
    );
    const geo = (await geoRes.json()) as {
      results?: { name: string; country: string; admin1?: string; latitude: number; longitude: number }[];
    };
    const loc = geo.results?.[0];
    if (!loc) return { ok: false, error: `place not found: ${q}` };

    const fcRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
        `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&timezone=auto&forecast_days=3`,
      { signal: AbortSignal.timeout(10000) }
    );
    const fc = (await fcRes.json()) as {
      current?: Record<string, number>;
      daily?: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: number[];
      };
    };

    return {
      ok: true,
      data: {
        place: loc.name,
        region: loc.admin1 ?? '',
        country: loc.country,
        current: {
          temperature_c: fc.current?.temperature_2m,
          condition: wmoText(fc.current?.weather_code),
          humidity_percent: fc.current?.relative_humidity_2m,
          wind_kmh: fc.current?.wind_speed_10m,
        },
        forecast: (fc.daily?.time ?? []).map((t, i) => ({
          date: t,
          condition: wmoText(fc.daily?.weather_code?.[i]),
          max_c: fc.daily?.temperature_2m_max?.[i],
          min_c: fc.daily?.temperature_2m_min?.[i],
          rain_chance_percent: fc.daily?.precipitation_probability_max?.[i],
        })),
      },
    };
  } catch (e) {
    return { ok: false, error: `weather lookup failed: ${(e as Error).message}` };
  }
}

/* ---------------- AI image generation (free, no key) ---------------- */

export function generateImage(prompt: string, width?: number, height?: number): ToolResult {
  const p = String(prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!p) return { ok: false, error: 'prompt is required' };
  const clamp = (n: number | undefined, d: number) =>
    Math.max(256, Math.min(1024, Math.round(Number(n) || d)));
  const w = clamp(width, 768);
  const h = clamp(height, 768);
  const seed = Math.floor(Math.random() * 1_000_000);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(p)}` +
    `?width=${w}&height=${h}&seed=${seed}&nologo=true`;
  return {
    ok: true,
    data: {
      image_url: url,
      width: w,
      height: h,
      prompt: p,
      markdown: `![${p.slice(0, 80).replace(/[[\]]/g, '')}](${url})`,
      note: 'Include this markdown image in your final answer so the user sees it.',
    },
  };
}

/* ---------------- See an image on the web (squad request) ---------------- */

export async function seeImage(rawUrl: string): Promise<ToolResult> {
  let url: URL;
  try {
    url = assertPublicHttp(rawUrl);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (res.status === 404) {
      return {
        ok: false,
        error:
          'image link is DEAD (HTTP 404 — file removed or expired). Tell the user this link no longer works and ask them to send a fresh link or upload the image directly. Do NOT guess or try other URLs.',
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        error:
          'image host refuses robot access (HTTP 403). Tell the user this site blocks automated viewing — ask them to download and upload the image in chat instead.',
      };
    }
    if (!res.ok) return { ok: false, error: `image server responded HTTP ${res.status} — tell the user honestly` };
    const ct = res.headers.get('content-type') ?? '';
    if (!/^image\//i.test(ct)) {
      return {
        ok: false,
        error: `this URL is not an image (${ct || 'unknown type'}) — ask the user for a direct image link (ends in .jpg/.png/.webp)`,
      };
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > 3_000_000) return { ok: false, error: 'image too large (max 3MB) — tell the user' };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3_000_000) return { ok: false, error: 'image too large (max 3MB) — tell the user' };
    const dataUrl = `data:${ct.split(';')[0]};base64,${buf.toString('base64')}`;
    const description = await describeImage(dataUrl);
    return { ok: true, data: { url: res.url || url.toString(), description } };
  } catch (e) {
    if (e instanceof VisionBusyError) {
      return {
        ok: false,
        error:
          'my eyes are rate-limited right now (all vision models busy). Tell the user image viewing is temporarily unavailable and to try again in a minute. Do NOT invent image descriptions.',
      };
    }
    if (e instanceof VisionError) {
      return {
        ok: false,
        error: `image downloaded fine but analysis failed (${e.message}) — tell the user honestly, do NOT guess what it shows`,
      };
    }
    const msg = (e as Error).message;
    return { ok: false, error: `see_image failed: ${msg}` };
  }
}

/* ---------------- Tool Registry ---------------- */

export type ToolName =
  | 'web_search'
  | 'web_fetch'
  | 'download_file'
  | 'calc'
  | 'json_parse'
  | 'run_js'
  | 'get_datetime'
  | 'weather'
  | 'generate_image'
  | 'see_image';

export const TOOL_NAMES: ToolName[] = [
  'web_search',
  'web_fetch',
  'download_file',
  'calc',
  'json_parse',
  'run_js',
  'get_datetime',
  'weather',
  'generate_image',
  'see_image',
];

export interface ParsedToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
}

export async function executeTool(
  brain: AgentBrain,
  call: ParsedToolCall
): Promise<ToolResult> {
  switch (call.tool) {
    case 'web_search':
      return await webSearch(brain, String(call.args?.query ?? ''), Number(call.args?.num ?? 6));
    case 'web_fetch':
      return await webFetch(String(call.args?.url ?? ''));
    case 'download_file':
      return await downloadFile(String(call.args?.url ?? ''));
    case 'calc':
      return await calc(String(call.args?.expression ?? ''));
    case 'json_parse':
      return jsonParse(String(call.args?.text ?? ''), call.args?.path ? String(call.args.path) : undefined);
    case 'run_js':
      return await runJs(String(call.args?.code ?? ''));
    case 'get_datetime':
      return getDatetime();
    case 'weather':
      return await weather(String(call.args?.place ?? ''));
    case 'generate_image':
      return generateImage(
        String(call.args?.prompt ?? ''),
        Number(call.args?.width) || undefined,
        Number(call.args?.height) || undefined
      );
    case 'see_image':
      return await seeImage(String(call.args?.url ?? ''));
    default:
      return { ok: false, error: `Unknown tool: ${call.tool}` };
  }
}

/**
 * Parse an LLM response into a tool call (if any).
 * Accepts raw JSON, JSON wrapped in ```json fences, or JSON with surrounding prose
 * as a last resort (first { ... last }).
 */
export function parseToolCall(content: string): ParsedToolCall | null {
  if (!content) return null;
  let text = content.trim();

  // Strip code fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) text = fence[1].trim();

  // Fast path: whole string is JSON
  const candidates: string[] = [text];
  // Fallback: first { to last }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const cand of candidates) {
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj === 'object' && typeof obj.tool === 'string') {
        const tool = obj.tool as ToolName;
        if (TOOL_NAMES.includes(tool)) {
          const args =
            obj.args && typeof obj.args === 'object'
              ? (obj.args as Record<string, unknown>)
              : {};
          return { tool, args };
        }
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Rescue paths for common LLM mistakes:
 * 1. Model simulated a [TOOL_RESULT run_js] with a code block instead of calling the tool
 *    → extract the code and turn it into a real run_js call.
 * Returns null when nothing can be rescued.
 */
export function rescueToolCall(content: string): ParsedToolCall | null {
  if (/\[TOOL_RESULT\s+run_js\]/i.test(content)) {
    const block =
      content.match(/```(?:javascript|js|node)?\s*\n([\s\S]*?)```/i) ??
      content.match(/```\s*\n([\s\S]*?)```/);
    if (block && block[1] && block[1].trim().length > 0) {
      return { tool: 'run_js', args: { code: block[1].trim() } };
    }
  }
  return null;
}

/** Did the model simulate a tool result for any tool? */
export function containsFakeToolResult(content: string): boolean {
  return /\[TOOL_RESULT\s+\w+\]/i.test(content);
}
