'use client';

import { Attachment } from './attachments';
import { Markdown } from './Markdown';
import {
  Brain,
  Calculator,
  Braces,
  Check,
  ChevronDown,
  Clock,
  CloudSun,
  Download,
  Eye,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Palette,
  Terminal,
  X,
} from 'lucide-react';

/* ---------------- types ---------------- */

export interface Step {
  kind: 'status' | 'tool_start' | 'tool_result';
  tool?: string;
  text: string;
  ok?: boolean;
}

export interface VideoMeta {
  name: string;
  durationSec?: number;
}

export interface FileMeta {
  name: string;
  size: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[]; // data URLs shown in the bubble
  video?: VideoMeta;
  files?: FileMeta[];
  steps: Step[];
  streaming?: boolean;
  failed?: boolean;
}

const TOOL_META: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  web_search: { icon: Globe, label: 'Web Search' },
  web_fetch: { icon: FileText, label: 'Web Reader' },
  download_file: { icon: Download, label: 'File Download' },
  calc: { icon: Calculator, label: 'Calculator' },
  json_parse: { icon: Braces, label: 'JSON Parse' },
  run_js: { icon: Terminal, label: 'JS Sandbox' },
  get_datetime: { icon: Clock, label: 'Date & Time' },
  weather: { icon: CloudSun, label: 'Weather' },
  generate_image: { icon: ImageIcon, label: 'Image Gen' },
  see_image: { icon: Eye, label: 'See Image' },
  generate_image_alt: { icon: Palette, label: 'Image Gen' },
};

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

/* ---------------- user attachments render ---------------- */

function UserAttachments({ m }: { m: Message }) {
  const images = m.images ?? [];
  const hasVisuals = images.length > 0 || m.video || (m.files && m.files.length > 0);
  if (!hasVisuals) return null;

  return (
    <div className="mb-2 space-y-2">
      {images.length > 0 && (
        <div className={`grid gap-1.5 ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`attachment ${i + 1}`}
              className="max-h-64 w-full rounded-xl border border-red-900/40 object-cover"
            />
          ))}
        </div>
      )}
      {m.video && (
        <div className="flex items-center gap-2 rounded-xl border border-red-900/40 bg-black/30 px-3 py-2 text-xs text-zinc-200">
          {m.images?.length ? (
            <img src={m.images[0]} alt="video frame" className="h-10 w-16 rounded-md object-cover" />
          ) : (
            <Film className="h-5 w-5 shrink-0 text-red-300" />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{m.video.name}</p>
            <p className="text-[10px] text-zinc-500">
              video{m.video.durationSec ? ` · ${m.video.durationSec}s` : ''} · frame analyzed by AI
            </p>
          </div>
        </div>
      )}
      {m.files?.map((f, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-xl border border-red-900/40 bg-black/30 px-3 py-2 text-xs text-zinc-200"
        >
          <FileText className="h-4 w-4 shrink-0 text-red-300" />
          <span className="truncate">{f.name}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- list ---------------- */

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-3 py-5 pb-10">
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[88%] rounded-2xl rounded-br-md bg-gradient-to-br from-red-700 to-red-900 px-4 py-3 text-sm text-white shadow-md shadow-red-950/40">
              <UserAttachments m={m} />
              {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex justify-start">
            <div className={`w-full ${m.failed ? 'rounded-2xl border border-red-900/60 bg-red-950/20 p-3' : ''}`}>
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
  );
}

export type { Attachment };
