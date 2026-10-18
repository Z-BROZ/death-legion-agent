'use client';

import { useEffect, useState } from 'react';

interface Parts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

function diffParts(target: number): Parts {
  const ms = target - Date.now();
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  return {
    days: Math.floor(ms / 86400000),
    hours: Math.floor(ms / 3600000) % 24,
    minutes: Math.floor(ms / 60000) % 60,
    seconds: Math.floor(ms / 1000) % 60,
    done: false,
  };
}

export function Countdown({ target }: { target: string }) {
  const [parts, setParts] = useState<Parts | null>(null);

  useEffect(() => {
    const t = new Date(target).getTime();
    const tick = () => setParts(diffParts(t));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const cells = [
    { label: 'DAYS', value: parts?.days },
    { label: 'HOURS', value: parts?.hours },
    { label: 'MINS', value: parts?.minutes },
    { label: 'SECS', value: parts?.seconds },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-2xl border border-red-900/50 bg-zinc-900/80 px-1 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          <div className="font-mono text-2xl font-black tabular-nums text-amber-300 sm:text-3xl">
            {c.value === undefined ? '--' : String(c.value).padStart(2, '0')}
          </div>
          <div className="mt-1 text-[10px] font-bold tracking-[0.2em] text-zinc-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
