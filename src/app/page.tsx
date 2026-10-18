'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/chat/Markdown';
import {
  Brain,
  Check,
  ChevronDown,
  Clock,
  Crosshair,
  Globe,
  Send,
  Skull,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';

/* ---------------- types ---------------- */

interface Step {
  kind: 'status' | 'tool_start' | 'tool_result';
  tool?: string;
  text: string;
  ok?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  steps: Step[];
  streaming?: boolean;
  failed?: boolean;
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const TOOL_META: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  web_search: { icon: Globe, label: 'Web Search' },
  run_js: { icon: Terminal, label: 'JS Sandbox' },
  get_datetime: { icon: Clock, label: 'Date & Time' },
};

const SUGGESTIONS = [
  { icon: Globe, label: 'අද Bitcoin price එක කීයද?', prompt: 'අද Bitcoin price එක කීයද? search කරලා කියන්න' },
  { icon: Crosshair, label: 'Free Fire pro tips හොයාගන්න', prompt: 'Free Fire වලට pro tips සහ meta characters ටිකක් search කරලා කියන්න' },
  { icon: Terminal, label: 'FizzBuzz run කරලා පෙන්නන්න', prompt: 'FizzBuzz code එක ලියලා run_js tool එකෙන් run කරලා output එක පෙන්නන්න' },
  { icon: Clock, label: 'දැන් වෙලාව මොකක්ද?', prompt: 'දැන් වෙලාව සහ දිනය මොකක්ද?' },
];

/* ---------------- SSE parsing ---------------- */

async function streamAgent(
  history: { role: 'user' | 'assistant'; content: string }[],
  onEvent: (ev: Record<string, unknown>) => void
) {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: history }),
  });

  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    onEvent({ type: 'error', message: msg });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        /* ignore malformed */
      }
    }
  }
}

/* ---------------- step timeline ---------------- */

function StepTimeline({ steps, streaming }: { steps: Step[]; streaming: boolean }) {
  if (steps.length === 0) return null;
  const visible = steps.filter((s) => s.kind !== 'status' || streaming);
  if (visible.length === 0) return null;

  return (
    <div className="mb-2 space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5">
      {visible.map((s, i) => {
        const meta = s.tool ? TOOL_META[s.tool] : null;
        const Icon = meta?.icon ?? Brain;
        return (
          <div key={i} className="flex items-start gap-2 text-xs">
            {s.kind === 'status' && (
              <>
                <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse text-red-400" />
                <span className="text-red-300/90">{s.text}</span>
              </>
            )}
            {s.kind === 'tool_start' && (
              <>
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse text-amber-400" />
                <span className="text-zinc-300">
                  <b className="text-amber-300">{meta?.label ?? s.tool}</b>
                  <span className="ml-1 text-zinc-500">{s.text}</span>
                </span>
              </>
            )}
            {s.kind === 'tool_result' && (
              <details className="w-full">
                <summary className="flex cursor-pointer list-none items-center gap-2">
                  {s.ok ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-red-400" />
                  )}
                  <span className={s.ok ? 'text-zinc-400' : 'text-red-300'}>
                    {meta?.label ?? s.tool} {s.ok ? '✓' : 'failed'}
                    <ChevronDown className="ml-1 inline h-3 w-3 text-zinc-600" />
                  </span>
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                  {s.text}
                </pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-400"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

/* ---------------- page ---------------- */

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  const updateAssistant = useCallback((fn: (m: Message) => Message) => {
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.role === 'assistant');
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      const next = [...prev];
      next[realIdx] = fn(next[realIdx]);
      return next;
    });
  }, []);

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;

      const userMsg: Message = { id: uid(), role: 'user', content: text, steps: [] };
      const agentMsg: Message = {
        id: uid(),
        role: 'assistant',
        content: '',
        steps: [],
        streaming: true,
      };

      const history = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: text },
      ];

      setInput('');
      if (taRef.current) taRef.current.style.height = 'auto';
      setBusy(true);
      setMessages((prev) => [...prev, userMsg, agentMsg]);

      let stepCounter = 0;

      await streamAgent(history, (ev) => {
        const type = ev.type as string;
        if (type === 'status') {
          updateAssistant((m) => {
            const steps = [...m.steps.filter((s) => s.kind !== 'status')];
            steps.push({ kind: 'status', text: String(ev.text ?? 'Thinking…') });
            return { ...m, steps };
          });
        } else if (type === 'tool_start') {
          stepCounter++;
          const args = (ev.args ?? {}) as Record<string, unknown>;
          const argText =
            ev.tool === 'web_search'
              ? `"${String(args.query ?? '')}"`
              : ev.tool === 'run_js'
                ? `code · ${String(args.code ?? '').length} chars`
                : '';
          updateAssistant((m) => {
            const steps = [...m.steps.filter((s) => s.kind !== 'status')];
            steps.push({ kind: 'tool_start', tool: String(ev.tool), text: argText });
            return { ...m, steps };
          });
        } else if (type === 'tool_result') {
          updateAssistant((m) => {
            const steps = m.steps.filter((s) => s.kind !== 'status');
            steps.push({
              kind: 'tool_result',
              tool: String(ev.tool),
              ok: Boolean(ev.ok),
              text: String(ev.preview ?? ''),
            });
            return { ...m, steps };
          });
        } else if (type === 'answer') {
          updateAssistant((m) => ({
            ...m,
            content: String(ev.content ?? ''),
            streaming: false,
            steps: m.steps.filter((s) => s.kind !== 'status'),
          }));
        } else if (type === 'error') {
          updateAssistant((m) => ({
            ...m,
            content: `⚠️ ${String(ev.message ?? 'Unknown error')}`,
            streaming: false,
            failed: true,
          }));
        }
        void stepCounter;
      });

      // safety: ensure streaming flag cleared
      updateAssistant((m) => (m.streaming ? { ...m, streaming: false } : m));
      setBusy(false);
    },
    [busy, messages, updateAssistant]
  );

  const clearChat = useCallback(() => {
    if (busy) return;
    setMessages([]);
  }, [busy]);

  return (
    <div className="relative flex h-[100dvh] flex-col bg-zinc-950 text-zinc-100">
      {/* ambient red glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(220,38,38,0.13),transparent_65%)]"
      />
      {/* header */}
      <header className="relative shrink-0 border-b border-zinc-800/80 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-red-800 shadow-lg shadow-red-500/25">
            <Skull className="h-5.5 w-5.5 text-zinc-100" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-black uppercase leading-tight tracking-wide">
              Death Legion <span className="text-red-500">Agent</span>
            </h1>
            <p className="truncate text-xs text-zinc-500">elite squad AI · සිංහල / English</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={clearChat}
            disabled={busy || messages.length === 0}
            aria-label="Clear chat"
            className="h-10 w-10 text-zinc-400 hover:text-red-400"
          >
            <Trash2 className="h-4.5 w-4.5" />
          </Button>
        </div>
      </header>

      {/* messages */}
      <main ref={scrollRef} className="relative flex-1 overflow-y-auto" aria-label="Chat messages">
        <div className="mx-auto w-full max-w-2xl space-y-4 px-3 py-4 pb-8">
          {messages.length === 0 && (
            <div className="flex flex-col items-center px-4 pt-10 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-red-500 to-red-800 shadow-xl shadow-red-500/30">
                <Skull className="h-11 w-11 text-zinc-100" />
              </div>
              <h2 className="mt-4 text-xl font-black uppercase tracking-wide">
                Death Legion <span className="text-red-500">Agent</span> එකට සාදරයෙන් පිළිගන්නවා ☠️
              </h2>
              <p className="mt-2 max-w-sm text-sm text-zinc-400">
                මම DEATH LEGION squad එකේ AI agent — <b className="text-red-400">web search</b> කරනවා,{' '}
                <b className="text-red-400">code ලියලා run</b> කරනවා, ඕනම ප්‍රශ්නයකට උත්තර දෙනවා.
                සිංහලෙන්වත් English වලින්වත් කතා කරන්න!
              </p>
              <div className="mt-5 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s.prompt)}
                    className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 text-left text-xs text-zinc-300 transition hover:border-red-500/50 hover:bg-zinc-900 active:scale-[0.98]"
                  >
                    <s.icon className="h-4 w-4 shrink-0 text-red-400" />
                    <span className="truncate">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-br from-red-600 to-red-800 px-4 py-2.5 text-sm text-white shadow-md shadow-red-950/50">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex justify-start">
                <div
                  className={`max-w-[95%] rounded-2xl rounded-bl-md border px-3.5 py-3 ${
                    m.failed
                      ? 'border-red-900/60 bg-red-950/30'
                      : 'border-zinc-800 bg-zinc-900/80'
                  }`}
                >
                  <StepTimeline steps={m.steps} streaming={Boolean(m.streaming)} />
                  {m.content ? (
                    <Markdown>{m.content}</Markdown>
                  ) : m.streaming ? (
                    <TypingDots />
                  ) : null}
                </div>
              </div>
            )
          )}
        </div>
      </main>

      {/* input bar */}
      <footer className="shrink-0 border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-end gap-2">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              rows={1}
              placeholder="පණිවිඩයක් ලියන්න… (Sinhala / English)"
              aria-label="Message input"
              className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-red-500/60 focus:outline-none focus:ring-1 focus:ring-red-500/40"
            />
            {busy ? (
              <Button
                size="icon"
                disabled
                aria-label="Thinking"
                className="h-11 w-11 shrink-0 rounded-2xl bg-red-600/40 text-red-200"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                aria-label="Send message"
                className="h-11 w-11 shrink-0 rounded-2xl bg-red-600 text-white shadow-lg shadow-red-950/50 hover:bg-red-500 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mt-2 text-center text-[10px] text-zinc-600">
            DEATH LEGION AGENT · tools: web search, JS sandbox, date/time
          </p>
        </div>
      </footer>
    </div>
  );
}
