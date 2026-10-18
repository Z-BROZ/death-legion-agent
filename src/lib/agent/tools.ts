import vm from 'node:vm';
import type { AgentBrain } from './brain';

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

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

/* ---------------- JavaScript Sandbox ---------------- */

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

export function runJs(code: string): ToolResult {
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, error: 'code is required' };
  }
  const lower = code;
  for (const bad of BLACKLIST) {
    if (lower.includes(bad)) {
      return {
        ok: false,
        error: `Sandbox blocked pattern "${bad}" — no system access allowed. Use pure JS (Math, JSON, arrays, loops).`,
      };
    }
  }

  const logs: string[] = [];
  const push = (...args: unknown[]) => {
    if (logs.length < 200) logs.push(args.map(fmtVal).join(' '));
  };

  const sandbox: Record<string, unknown> = {
    console: { log: push, info: push, warn: push, error: push },
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
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    NaN,
    Infinity,
  };

  try {
    const context = vm.createContext(sandbox);
    const script = new vm.Script(code, { filename: 'agent-sandbox.js' });
    script.runInContext(context, { timeout: 2000, displayErrors: true });
    const output = logs.length > 0 ? logs.join('\n') : '(code ran, but no console.log output)';
    return { ok: true, data: { output } };
  } catch (e: unknown) {
    const err = e as Error;
    return { ok: false, error: `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}` };
  }
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

/* ---------------- Tool Registry ---------------- */

export type ToolName = 'web_search' | 'run_js' | 'get_datetime';

export const TOOL_NAMES: ToolName[] = ['web_search', 'run_js', 'get_datetime'];

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
    case 'run_js':
      return runJs(String(call.args?.code ?? ''));
    case 'get_datetime':
      return getDatetime();
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
