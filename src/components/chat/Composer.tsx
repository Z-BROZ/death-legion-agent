'use client';

import { useRef } from 'react';
import { Attachment, humanSize } from './attachments';
import { ArrowUp, FileText, Film, ImagePlus, Loader2, X } from 'lucide-react';

const ACCEPT =
  'image/*,video/*,.txt,.md,.markdown,.json,.csv,.tsv,.log,.xml,.yml,.yaml,.js,.jsx,.ts,.tsx,.py,.java,.kt,.c,.cpp,.h,.cs,.go,.rb,.rs,.php,.sh,.sql,.html,.htm,.css,.scss,.ini,.toml';

export function Composer({
  input,
  onInputChange,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  processingFiles,
  busy,
  onSend,
}: {
  input: string;
  onInputChange: (v: string) => void;
  attachments: Attachment[];
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  processingFiles: boolean;
  busy: boolean;
  onSend: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const canSend = (input.trim().length > 0 || attachments.some((a) => !a.error)) && !busy;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
      <div className="mx-auto w-full max-w-3xl">
        {/* attachment chips */}
        {(attachments.length > 0 || processingFiles) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {processingFiles && (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-red-400" />
                processing…
              </div>
            )}
            {attachments.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${
                  a.error
                    ? 'border-red-900/70 bg-red-950/40 text-red-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300'
                }`}
              >
                {a.kind === 'image' && a.dataUrl ? (
                  <img src={a.dataUrl} alt={a.name} className="h-8 w-8 rounded object-cover" />
                ) : a.kind === 'video' ? (
                  <Film className="h-4 w-4 text-red-300" />
                ) : (
                  <FileText className="h-4 w-4 text-red-300" />
                )}
                <div className="min-w-0 max-w-[150px]">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="truncate text-[10px] text-zinc-500">
                    {a.error ?? humanSize(a.size)}
                  </p>
                </div>
                <button
                  onClick={() => onRemoveAttachment(a.id)}
                  aria-label={`Remove ${a.name}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* input row — DeepSeek style pill */}
        <div className="flex items-end gap-2 rounded-3xl border border-zinc-800 bg-zinc-900/80 p-2 shadow-lg shadow-black/30 focus-within:border-red-500/50">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy || attachments.length >= 3}
            aria-label="Attach photo, video, or file"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-800 hover:text-red-400 disabled:opacity-40"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              onAddFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => {
              onInputChange(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="DL AGENT ට අහන්න… (Sinhala / English)"
            aria-label="Message input"
            className="max-h-[140px] min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <button
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send message"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-600 to-red-800 text-white shadow-lg shadow-red-950/50 transition hover:from-red-500 hover:to-red-700 disabled:opacity-35"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>

        <p className="mt-1.5 text-center text-[10px] text-zinc-700">
          DL AGENT v2 · 10 tools · photo/video/file upload · සිංහල / English
        </p>
      </div>
    </div>
  );
}
