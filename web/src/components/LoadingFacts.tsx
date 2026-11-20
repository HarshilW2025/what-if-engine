"use client";

import { useEffect, useMemo, useState } from "react";
import { FACTS } from "@/lib/facts";

const ROTATE_MS = 6500;
const FADE_MS = 400;

/** "Did you know?" card shown while a simulation builds. Order is shuffled per question. */
export default function LoadingFacts({ elapsed }: { elapsed: number }) {
  const order = useMemo(() => {
    const idx = FACTS.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }, []);
  const [k, setK] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setK((x) => (x + 1) % order.length);
        setVisible(true);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [order.length]);

  return (
    <div className="w-[28rem] max-w-[85vw] rounded-xl border border-white/10 bg-black/75 px-6 py-5 text-center shadow-2xl">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300/80">Did you know?</div>
      <p
        className="min-h-[4.5rem] text-[15px] leading-relaxed text-zinc-100 transition-opacity"
        style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      >
        {FACTS[order[k]]}
      </p>
      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-zinc-500">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
        Building your simulation · {elapsed}s
      </div>
    </div>
  );
}
