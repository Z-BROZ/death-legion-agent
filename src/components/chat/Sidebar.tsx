'use client';

import { Flame, MessageSquare, Plus, Skull, Trash2, X } from 'lucide-react';

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  msgCount: number;
}

export function Sidebar({
  sessions,
  activeId,
  open,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: {
  sessions: SessionMeta[];
  activeId: string;
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* mobile backdrop */}
      {open && (
        <div
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-red-950/50 bg-[#0c0808] transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Chat sessions"
      >
        {/* brand */}
        <div className="flex items-center gap-2.5 border-b border-red-950/40 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-800 shadow-lg shadow-red-900/40">
            <Skull className="h-5 w-5 text-zinc-100" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-black uppercase tracking-wide text-zinc-100">
              DL <span className="text-red-500">Agent</span>
            </h1>
            <p className="truncate text-[10px] text-zinc-600">DEATH LEGION squad AI</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* new chat */}
        <div className="px-3 pt-3">
          <button
            onClick={onNew}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 text-sm font-semibold text-white shadow-lg shadow-red-950/50 transition hover:from-red-500 hover:to-red-600 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
        </div>

        {/* sessions */}
        <nav className="mt-3 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {sessions.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-zinc-700">No chats yet</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex min-h-[44px] items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
                s.id === activeId
                  ? 'bg-red-950/40 text-red-100'
                  : 'text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200'
              }`}
            >
              <button
                onClick={() => onSelect(s.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <MessageSquare
                  className={`h-3.5 w-3.5 shrink-0 ${s.id === activeId ? 'text-red-400' : 'text-zinc-600'}`}
                />
                <span className="truncate">{s.title}</span>
              </button>
              <button
                onClick={() => onDelete(s.id)}
                aria-label={`Delete chat: ${s.title}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-600 opacity-0 transition hover:bg-red-950/60 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </nav>

        {/* footer */}
        <div className="space-y-2 border-t border-red-950/40 px-3 py-3">
          <a
            href="/day90"
            className="flex min-h-[44px] items-center gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 text-xs font-semibold text-amber-300 transition hover:bg-amber-950/40"
          >
            <Flame className="h-4 w-4" />
            DAY 90 — Legends Never Die
          </a>
          <p className="text-center text-[10px] text-zinc-700">
            built by <span className="text-red-500/80">Kaviz88</span> · DEATH LEGION
          </p>
        </div>
      </aside>
    </>
  );
}
