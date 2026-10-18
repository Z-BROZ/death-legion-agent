import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Crown, Flame, Skull, Swords, Users } from 'lucide-react';
import { Countdown } from '@/components/day90/Countdown';
import { Day90Chat } from '@/components/day90/Day90Chat';

export const metadata: Metadata = {
  title: 'DAY 90 — DEATH LEGION',
  description: 'DEATH LEGION squad Day 90 special — දින 90ක ගමන. Agent එකත් මේ page එකේම.',
};

/* Day 100 finale target — date එක වෙනස් කරන්න ඕන නම් මෙතන විතරයි change කරන්නේ */
const DAY_100_TARGET = '2026-10-29T00:00:00+05:30';

const LEGENDS = [
  { name: 'Kaviz88', tag: 'LEADER', crown: true },
  { name: 'HEXA', tag: 'LEGEND', crown: false },
];

const STATS = [
  { icon: Swords, value: '90', label: 'දිනක සටන' },
  { icon: Skull, value: '1', label: 'AI AGENT' },
  { icon: Flame, value: '∞', label: 'LEGEND VIBES' },
];

export default function Day90() {
  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* ambient glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgba(220,38,38,0.16),transparent_65%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(ellipse_at_bottom,rgba(217,119,6,0.10),transparent_65%)]"
      />

      <main className="relative mx-auto w-full max-w-2xl flex-1 px-4">
        {/* ---------- hero ---------- */}
        <header className="flex flex-col items-center pt-12 text-center sm:pt-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-red-500 to-red-800 shadow-xl shadow-red-500/30">
            <Skull className="h-8 w-8 text-zinc-100" />
          </div>
          <p className="mt-4 text-xs font-black uppercase tracking-[0.35em] text-red-500">
            Death Legion
          </p>
          <h1 className="mt-2 bg-gradient-to-b from-amber-200 via-yellow-400 to-amber-600 bg-clip-text text-7xl font-black leading-none tracking-tight text-transparent drop-shadow-[0_0_25px_rgba(250,204,21,0.25)] sm:text-8xl">
            DAY 90
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            දින 90ක ගමන · <span className="font-bold text-amber-400">LEGENDS NEVER DIE</span>
          </p>
          <div className="mt-4 h-px w-40 bg-gradient-to-r from-transparent via-red-700/70 to-transparent" />
        </header>

        {/* ---------- countdown ---------- */}
        <section className="mt-10" aria-label="Day 100 countdown">
          <div className="flex items-center justify-center gap-2">
            <Flame className="h-4 w-4 text-amber-400" />
            <h2 className="text-center text-sm font-black uppercase tracking-[0.25em] text-zinc-300">
              Day 100 Finale
            </h2>
            <Flame className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-1 text-center text-xs text-zinc-500">තව දින කීයක් තියෙනවද බලන්න</p>
          <div className="mt-4">
            <Countdown target={DAY_100_TARGET} />
          </div>
        </section>

        {/* ---------- stats ---------- */}
        <section className="mt-10 grid grid-cols-3 gap-2" aria-label="Day 90 stats">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 px-2 py-4 text-center"
            >
              <s.icon className="mx-auto h-4 w-4 text-red-400" />
              <p className="mt-2 text-2xl font-black text-amber-300">{s.value}</p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                {s.label}
              </p>
            </div>
          ))}
        </section>

        {/* ---------- squad wall ---------- */}
        <section className="mt-10" aria-label="Squad legends">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-red-400" />
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-zinc-300">
              Squad Legends
            </h2>
          </div>
          <p className="mt-1 text-xs text-zinc-500">මේ දින 90 එක්කම ඇවිද්ද අය</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LEGENDS.map((l) => (
              <div
                key={l.name}
                className={`relative rounded-2xl border bg-zinc-900/70 px-3 py-5 text-center ${
                  l.crown ? 'border-amber-500/50 shadow-lg shadow-amber-950/30' : 'border-red-900/50'
                }`}
              >
                {l.crown && (
                  <Crown className="absolute -top-2.5 left-1/2 h-5 w-5 -translate-x-1/2 text-amber-400" />
                )}
                <div
                  className={`mx-auto flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-black ${
                    l.crown
                      ? 'bg-gradient-to-br from-amber-400 to-amber-700 text-zinc-950'
                      : 'bg-gradient-to-br from-red-500 to-red-800 text-zinc-100'
                  }`}
                >
                  {l.name.charAt(0)}
                </div>
                <p className="mt-2 text-sm font-black">{l.name}</p>
                <p
                  className={`text-[10px] font-bold uppercase tracking-widest ${
                    l.crown ? 'text-amber-400' : 'text-red-400'
                  }`}
                >
                  {l.tag}
                </p>
              </div>
            ))}
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-dashed border-zinc-700/80 px-3 py-5 text-center"
              >
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-zinc-700 text-lg text-zinc-600">
                  +
                </div>
                <p className="mt-2 text-sm font-bold text-zinc-600">JOIN US</p>
                <p className="text-[10px] uppercase tracking-widest text-zinc-700">slot open</p>
              </div>
            ))}
            <div className="col-span-2 rounded-2xl border border-dashed border-zinc-700/80 px-3 py-3 text-center sm:col-span-1">
              <p className="pt-3 text-[10px] uppercase tracking-widest text-zinc-600">
                ඔයාගේ නමත් මෙතනට ඕනද?
              </p>
            </div>
          </div>
        </section>

        {/* ---------- agent ---------- */}
        <section className="mt-10" aria-label="Day 90 agent">
          <div className="flex items-center gap-2">
            <Skull className="h-4 w-4 text-red-400" />
            <h2 className="text-sm font-black uppercase tracking-[0.25em] text-zinc-300">
              Day 90 Special — Agent
            </h2>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            ඔයාගේම AI agent එක මේ page එකේම — search, code, උත්තර ඔක්කොම
          </p>
          <div className="mt-4">
            <Day90Chat />
          </div>
          <Link
            href="/"
            className="group mt-4 flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-red-900/60 bg-gradient-to-r from-red-600/20 to-red-900/20 px-4 text-sm font-bold text-red-300 transition hover:border-red-500/60 hover:text-red-200"
          >
            FULL AGENT එක open කරන්න
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </section>
      </main>

      {/* ---------- footer ---------- */}
      <footer className="relative mt-12 border-t border-zinc-800/80">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
            <Skull className="h-3 w-3 text-red-500" />
            Death Legion · Day 90 Special
          </p>
          <p className="text-[10px] text-zinc-600">built by Kaviz88 · දින 90 · legends never die</p>
        </div>
      </footer>
    </div>
  );
}
