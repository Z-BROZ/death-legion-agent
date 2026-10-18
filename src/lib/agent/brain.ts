import ZAI from 'z-ai-web-dev-sdk';
import type { SearchResultItem } from './tools';

/**
 * AgentBrain — the AI "engine" behind the agent loop.
 *
 * Two implementations:
 * 1. SdkBrain  — sandbox / local dev: uses z-ai-web-dev-sdk (.z-ai-config)
 * 2. RestBrain — deployed (Vercel etc.): direct calls to the Z.ai open API
 *                using ZAI_API_KEY (+ optional ZAI_BASE_URL, ZAI_MODEL).
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
      throw new Error(`Z.ai API ${res.status}: ${text.slice(0, 300)}`);
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
        'AI brain not configured. Add ZAI_API_KEY (a free Z.ai API key from z.ai) in your hosting environment variables.'
      );
    }
    return new RestBrain(apiKey);
  }
}
