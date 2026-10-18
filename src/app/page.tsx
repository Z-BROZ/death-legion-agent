'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageList, type Message } from '@/components/chat/MessageList';
import { Sidebar, type SessionMeta } from '@/components/chat/Sidebar';
import { Composer } from '@/components/chat/Composer';
import {
  Attachment,
  processFile,
  uid,
} from '@/components/chat/attachments';
import { Globe, CloudSun, Terminal, ImageIcon, Menu, Plus, Eye } from 'lucide-react';

/* ---------------- sessions + persistence ---------------- */

interface Session {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
}

const STORAGE_KEY = 'dl_sessions_v2';

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages))
      .map((s) => ({
        ...s,
        messages: s.messages.map((m) => ({ ...m, steps: m.steps ?? [], streaming: false })),
      }));
  } catch {
    return [];
  }
}

function stripImages(sessions: Session[], all: boolean): Session[] {
  return sessions.map((s, idx) => ({
    ...s,
    messages: s.messages.map((m) => {
      if (m.role !== 'user') return m;
      const keep = !all && s.id === sessions[sessions.length - 1]?.id && idx === sessions.length - 1;
      return {
        ...m,
        images: keep ? m.images : undefined,
        video: keep ? m.video : m.video ? { name: m.video.name } : undefined,
      };
    }),
  }));
}

function persistSessions(sessions: Session[]) {
  const attempt = (data: Session[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  try {
    attempt(sessions);
  } catch {
    try {
      attempt(stripImages(sessions, false));
    } catch {
      try {
        attempt(stripImages(sessions.slice(-10), true));
      } catch {
        /* storage full — give up silently */
      }
    }
  }
}

/* ---------------- SSE ---------------- */

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
}

async function streamAgent(
  history: ApiMessage[],
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

/* ---------------- suggestions ---------------- */

const SUGGESTIONS = [
  { icon: Globe, label: 'අද Bitcoin price එක කීයද?', prompt: 'අද Bitcoin price එක search කරලා කියන්න' },
  { icon: CloudSun, label: 'Colombo weather', prompt: 'Colombo weather එක කියන්න — අද සහ ඊළඟ දවස් ටිකේ' },
  { icon: ImageIcon, label: 'Gaming logo එකක් හදන්න', prompt: 'මට red skull gaming logo එකක් AI එකෙන් හදලා දෙන්න' },
  { icon: Terminal, label: 'JS code run කරලා පෙන්නන්න', prompt: 'Prime numbers 1-50 ලියලා JS වලින් run කරලා output එක පෙන්නන්න' },
  { icon: Eye, label: 'Image එකක් බලන්න', prompt: 'මේ image එකේ මොකද තියෙන්නේ බලන්න: https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Example.png/320px-Example.png' },
  { icon: Globe, label: 'Web page එකක් කියවන්න', prompt: 'https://en.wikipedia.org/wiki/Sri_Lanka කියවලා කෙටි summary එකක් දෙන්න' },
];

/* ---------------- page ---------------- */

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [processingFiles, setProcessingFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = sessions.find((s) => s.id === activeId)?.messages ?? [];

  /* hydrate from localStorage */
  useEffect(() => {
    const t = setTimeout(() => {
      const loaded = loadSessions();
      if (loaded.length > 0) {
        setSessions(loaded);
        setActiveId(loaded[loaded.length - 1].id);
      } else {
        const s: Session = { id: uid(), title: 'New chat', createdAt: Date.now(), messages: [] };
        setSessions([s]);
        setActiveId(s.id);
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  /* persist */
  useEffect(() => {
    if (hydrated && sessions.length > 0) persistSessions(sessions);
  }, [sessions, hydrated]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  /* session ops */
  const newChat = useCallback(() => {
    const empty = sessions.find((s) => s.messages.length === 0);
    if (empty) {
      setActiveId(empty.id);
      setSidebarOpen(false);
      return;
    }
    const s: Session = { id: uid(), title: 'New chat', createdAt: Date.now(), messages: [] };
    setSessions((prev) => [...prev, s]);
    setActiveId(s.id);
    setSidebarOpen(false);
  }, [sessions]);

  const deleteSession = useCallback(
    (id: string) => {
      const next = sessions.filter((s) => s.id !== id);
      if (next.length === 0) {
        const s: Session = { id: uid(), title: 'New chat', createdAt: Date.now(), messages: [] };
        setSessions([s]);
        setActiveId(s.id);
        return;
      }
      setSessions(next);
      if (id === activeId) setActiveId(next[next.length - 1].id);
    },
    [sessions, activeId]
  );

  const updateSessionMessages = useCallback(
    (fn: (msgs: Message[]) => Message[]) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === activeId ? { ...s, messages: fn(s.messages) } : s))
      );
    },
    [activeId]
  );

  /* attachments */
  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setProcessingFiles(true);
    const incoming = Array.from(files).slice(0, 3);
    for (const file of incoming) {
      const att = await processFile(file);
      setAttachments((prev) => [...prev, att]);
    }
    setProcessingFiles(false);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /* send */
  const sendMessage = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      const validAtts = attachments.filter((a) => !a.error);
      if ((!text && validAtts.length === 0) || busy) return;

      const imageAtts = validAtts.filter((a) => a.kind === 'image' && a.dataUrl);
      const videoAtt = validAtts.find((a) => a.kind === 'video');
      const imageUrls = [...imageAtts.map((a) => a.dataUrl as string)];
      if (videoAtt?.dataUrl) imageUrls.push(videoAtt.dataUrl);

      // Text-file contents go into the message content (context for the agent).
      let content = text;
      for (const f of validAtts.filter((a) => a.kind === 'text' && a.text)) {
        content += `\n\n[FILE: ${f.name}]\n\`\`\`\n${(f.text as string).slice(0, 100_000)}\n\`\`\``;
      }
      content = content.trim();

      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: text || (videoAtt ? '🎬 ' + videoAtt.name : '📷 attachment'),
        images: imageUrls.length > 0 ? imageUrls : undefined,
        video: videoAtt
          ? { name: videoAtt.name, durationSec: videoAtt.durationSec }
          : undefined,
        files: validAtts
          .filter((a) => a.kind === 'text')
          .map((a) => ({ name: a.name, size: a.size })),
        steps: [],
      };
      const agentMsg: Message = {
        id: uid(),
        role: 'assistant',
        content: '',
        steps: [],
        streaming: true,
      };

      const apiHistory: ApiMessage[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content, images: imageUrls.length > 0 ? imageUrls : undefined },
      ];

      setInput('');
      if (attachments.some((a) => a.kind === 'text')) {
        // keep textarea height reset consistent
      }
      setAttachments([]);
      setBusy(true);

      // append messages + set session title in ONE atomic update
      const autoTitle =
        text.slice(0, 42) ||
        (videoAtt ? '🎬 ' + videoAtt.name : imageUrls.length ? '📷 Photo chat' : 'New chat');
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeId) return s;
          const title = s.messages.length === 0 ? autoTitle : s.title;
          return { ...s, title, messages: [...s.messages, userMsg, agentMsg] };
        })
      );

      const updateAssistant = (fn: (m: Message) => Message) => {
        updateSessionMessages((prev) => {
          const idx = [...prev].reverse().findIndex((m) => m.role === 'assistant');
          if (idx === -1) return prev;
          const realIdx = prev.length - 1 - idx;
          const next = [...prev];
          next[realIdx] = fn(next[realIdx]);
          return next;
        });
      };

      await streamAgent(apiHistory, (ev) => {
        const type = ev.type as string;
        if (type === 'status') {
          updateAssistant((m) => {
            const steps = [...m.steps.filter((s) => s.kind !== 'status')];
            steps.push({ kind: 'status', text: String(ev.text ?? 'Thinking…') });
            return { ...m, steps };
          });
        } else if (type === 'tool_start') {
          const args = (ev.args ?? {}) as Record<string, unknown>;
          const argText =
            ev.tool === 'web_search'
              ? `"${String(args.query ?? '')}"`
              : ev.tool === 'run_js'
                ? `code · ${String(args.code ?? '').length} chars`
                : ev.tool === 'web_fetch' || ev.tool === 'download_file' || ev.tool === 'see_image'
                  ? String(args.url ?? '')
                  : ev.tool === 'calc'
                    ? String(args.expression ?? '')
                    : ev.tool === 'weather'
                      ? String(args.place ?? '')
                      : ev.tool === 'generate_image'
                        ? String(args.prompt ?? '').slice(0, 60)
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
      });

      updateAssistant((m) => (m.streaming ? { ...m, streaming: false } : m));
      setBusy(false);
    },
    [attachments, busy, input, messages, activeId, updateSessionMessages]
  );

  /* session metas for sidebar */
  const sessionMetas: SessionMeta[] = [...sessions]
    .reverse()
    .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, msgCount: s.messages.length }));

  return (
    <div className="relative flex h-[100dvh] overflow-hidden bg-[#0f0b0b] text-zinc-100">
      {/* ambient red glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-72 bg-[radial-gradient(ellipse_at_top,rgba(220,38,38,0.10),transparent_65%)]"
      />

      <Sidebar
        sessions={sessionMetas}
        activeId={activeId}
        open={sidebarOpen}
        onSelect={(id) => {
          setActiveId(id);
          setSidebarOpen(false);
        }}
        onNew={newChat}
        onDelete={deleteSession}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* mobile header */}
        <header className="flex shrink-0 items-center gap-2 border-b border-zinc-900 bg-[#0f0b0b]/95 px-3 py-2 backdrop-blur lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-bold uppercase tracking-wide">
            DL <span className="text-red-500">Agent</span>
          </p>
          <button
            onClick={newChat}
            aria-label="New chat"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-900 hover:text-red-400"
          >
            <Plus className="h-5 w-5" />
          </button>
        </header>

        {/* messages */}
        <main ref={scrollRef} className="relative flex-1 overflow-y-auto" aria-label="Chat messages">
          {messages.length === 0 && (
            <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-4 pb-6 pt-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-red-500 to-red-800 shadow-xl shadow-red-900/40">
                <span className="text-3xl">☠️</span>
              </div>
              <h2 className="mt-4 text-2xl font-black tracking-tight">
                හාය, මම <span className="text-red-500">DL AGENT</span>
              </h2>
              <p className="mt-2 max-w-md text-sm text-zinc-400">
                DEATH LEGION squad එකේ AI — <b className="text-red-400">web search</b>,{' '}
                <b className="text-red-400">code run</b>, <b className="text-red-400">image හදනවා</b>,{' '}
                <b className="text-red-400">weather</b>, <b className="text-red-400">file download</b>…
                photo/video/file එකක් attach කරලා එවන්න, මම බලනවා! 📎
              </p>
              <div className="mt-6 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s.prompt)}
                    className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-left text-xs text-zinc-300 transition hover:border-red-500/50 hover:bg-zinc-900 active:scale-[0.98]"
                  >
                    <s.icon className="h-4 w-4 shrink-0 text-red-400" />
                    <span className="truncate">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <MessageList messages={messages} />
        </main>

        {/* composer */}
        <footer className="shrink-0 border-t border-zinc-900 bg-[#0f0b0b]/95 backdrop-blur">
          <Composer
            input={input}
            onInputChange={setInput}
            attachments={attachments}
            onAddFiles={addFiles}
            onRemoveAttachment={removeAttachment}
            processingFiles={processingFiles}
            busy={busy}
            onSend={() => sendMessage()}
          />
        </footer>
      </div>
    </div>
  );
}
