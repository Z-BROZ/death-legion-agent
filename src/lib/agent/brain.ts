import ZAI from 'z-ai-web-dev-sdk';
import type { SearchResultItem } from './tools';

/**
 * AgentBrain — the AI "engine" behind the agent loop.
 *
 * Two implementations:
 * 1. SdkBrain  — sandbox / local dev: uses z-ai-web-dev-sdk (.z-ai-config)
 * 2. RestBrain — deployed (Render etc.): any OpenAI-compatible chat API
 *                using ZAI_API_KEY (+ ZAI_BASE_URL, ZAI_MODEL). Z.ai native,
 *                notrack.ai, OpenRouter, etc. all work.
 */

export interface BrainChatMessage {
  role: 'assistant' | 'user' | 'system';
  content: string;
}

export interface AgentBrain {
  chat(messages: BrainChatMessage[]): Promise<string>;
  search(query: string, num: number): Promise<SearchResultItem[]>;
}

/* ---------------- Sandbox brain (z-ai-web-dev-sdk) ---------------- */

type SdkClient = import('z-ai-web-dev-sdk').default;

class SdkBrain implements AgentBrain {
  constructor(private zai: SdkClient) {}

  async chat(messages: BrainChatMessage[]): Promise<string> {
    const completion = await this.zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
    } as Parameters<SdkClient['chat']['completions']['create']>[0]);
    return completion.choices?.[0]?.message?.content ?? '';
  }

  async search(query: string, num: number): Promise<SearchResultItem[]> {
    const results = (await this.zai.functions.invoke('web_search', {
      query,
      num,
    })) as SearchResultItem[];
    return Array.isArray(results) ? results : [];
  }
}

/* ---------------- REST brain (Z.ai open API — for Vercel) ---------------- */

const REST_BASE =
  (process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, '');
const REST_MODEL = process.env.ZAI_MODEL || 'glm-4.7-flash'; // free tier model
const IS_ZAI_REST = /z\.ai|bigmodel/i.test(REST_BASE);

/* -------- Generic web search fallback (non-Z.ai providers) --------
 * Providers like notrack.ai ship no built-in web_search tool, so we
 * scrape organic results from Bing (DuckDuckGo HTML as backup).
 * No API key needed. Fails soft: agent continues without results. */

const SCRAPE_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function stripTags(s: string): string {
  return s
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

function decodeBingUrl(href: string): string {
  const m = href.match(/[?&]u=a1([^&]+)/);
  if (!m) return href;
  try {
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const out = Buffer.from(b64, 'base64').toString('utf-8');
    return /^https?:\/\//.test(out) ? out : href;
  } catch {
    return href;
  }
}

async function fetchText(url: string, timeoutMs = 9000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': SCRAPE_UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`scrape ${res.status}`);
  return res.text();
}

function parseBing(html: string, num: number): SearchResultItem[] {
  const out: SearchResultItem[] = [];
  const seen = new Set<string>();
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  for (const b of blocks) {
    const a = b.match(/<a[^>]+href="(http[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = decodeBingUrl(a[1]);
    const name = stripTags(a[2]);
    if (!name || !/^https?:\/\//.test(url) || seen.has(url)) continue;
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    const p = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    seen.add(url);
    out.push({
      name: name.slice(0, 200),
      snippet: p ? stripTags(p[1]).slice(0, 500) : '',
      url,
      host_name: host,
      date: '',
    });
    if (out.length >= num) break;
  }
  return out;
}

function parseDdg(html: string, num: number): SearchResultItem[] {
  const out: SearchResultItem[] = [];
  const seen = new Set<string>();
  const blocks = html.match(/<div class="result[\s\S]*?<a class="result__snippet"[\s\S]*?<\/a>/g) ?? [];
  for (const b of blocks) {
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = a[1].startsWith('//') ? `https:${a[1]}` : a[1];
    const name = stripTags(a[2]);
    if (!name || !/^https?:\/\//.test(url) || seen.has(url)) continue;
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    const s = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    seen.add(url);
    out.push({
      name: name.slice(0, 200),
      snippet: s ? stripTags(s[1]).slice(0, 500) : '',
      url,
      host_name: host,
      date: '',
    });
    if (out.length >= num) break;
  }
  return out;
}

async function webScrapeSearch(query: string, num: number): Promise<SearchResultItem[]> {
  const errors: string[] = [];
  try {
    const html = await fetchText(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(num + 2, 8)}&mkt=en-US&setlang=en-US`
    );
    const results = parseBing(html, num);
    if (results.length) return results;
    errors.push('bing: 0 results');
  } catch (e) {
    errors.push(`bing: ${(e as Error).message}`);
  }
  try {
    const html = await fetchText(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      8000
    );
    const results = parseDdg(html, num);
    if (results.length) return results;
    errors.push('ddg: 0 results');
  } catch (e) {
    errors.push(`ddg: ${(e as Error).message}`);
  }
  throw new Error(`web search unavailable (${errors.join(' | ')})`);
}

interface RestChoice {
  message?: { content?: string };
}

class RestBrain implements AgentBrain {
  constructor(private apiKey: string) {}

  private async call(body: Record<string, unknown>): Promise<{ choices?: RestChoice[] }> {
    const res = await fetch(`${REST_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI API ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as { choices?: RestChoice[] };
  }

  async chat(messages: BrainChatMessage[]): Promise<string> {
    const json = await this.call({
      model: REST_MODEL,
      messages,
      thinking: { type: 'disabled' },
    });
    return json?.choices?.[0]?.message?.content ?? '';
  }

  async search(query: string, num: number): Promise<SearchResultItem[]> {
    if (IS_ZAI_REST) return this.zaiSearch(query, num);
    // Generic OpenAI-compatible provider → scrape the web
    return webScrapeSearch(query, num);
  }

  private async zaiSearch(query: string, num: number): Promise<SearchResultItem[]> {
    const json = await this.call({
      model: REST_MODEL,
      messages: [
        {
          role: 'user',
          content:
            `Search the web for: "${query}". ` +
            `Reply with ONLY a JSON array (no prose, no markdown) of up to ${num} results: ` +
            `[{"name":"title","snippet":"short text","url":"link","host_name":"domain","date":"date or empty"}]`,
        },
      ],
      tools: [{ type: 'web_search', web_search: { enable: true, count: num } }],
    });

    const content: string = json?.choices?.[0]?.message?.content ?? '';
    const first = content.indexOf('[');
    const last = content.lastIndexOf(']');
    if (first !== -1 && last > first) {
      try {
        const arr = JSON.parse(content.slice(first, last + 1)) as unknown;
        if (Array.isArray(arr)) {
          return arr.slice(0, num).map((raw) => {
            const r = (raw ?? {}) as Record<string, unknown>;
            return {
              name: String(r?.name ?? ''),
              snippet: String(r?.snippet ?? ''),
              url: String(r?.url ?? ''),
              host_name: String(r?.host_name ?? ''),
              date: String(r?.date ?? ''),
            };
          });
        }
      } catch {
        /* fall through to raw-text fallback */
      }
    }
    if (content.trim()) {
      return [
        {
          name: query,
          snippet: content.trim().slice(0, 2000),
          url: '',
          host_name: '',
          date: '',
        },
      ];
    }
    throw new Error('web_search returned no results');
  }
}

/* ---------------- Factory ---------------- */

export async function createBrain(): Promise<AgentBrain> {
  // 1) sandbox / local: .z-ai-config exists → SDK brain
  try {
    const zai = await ZAI.create();
    return new SdkBrain(zai);
  } catch {
    // 2) deployed: Z.ai API key from environment
    const apiKey = process.env.ZAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'AI brain not configured. Add ZAI_API_KEY in your hosting environment variables (any OpenAI-compatible API key), then also set ZAI_BASE_URL and ZAI_MODEL.'
      );
    }
    return new RestBrain(apiKey);
  }
}
