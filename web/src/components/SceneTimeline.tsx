"use client";

import { useEffect } from "react";
import { fmt } from "@/lib/fmt";
import { usePlayer } from "@/lib/store";
import type { SceneResult } from "@/lib/types";

export default function SceneTimeline({ res }: { res: SceneResult }) {
  const F = res.times.length;
  const playhead = usePlayer((s) => s.playhead);
  const setPlayhead = usePlayer((s) => s.setPlayhead);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        usePlayer.getState().togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const i = Math.min(Math.floor(playhead), F - 1);
  const j = Math.min(i + 1, F - 1);
  const now = res.times[i] + (res.times[j] - res.times[i]) * (playhead - i);

  return (
    <div className="flex items-center gap-5">
      <input
        type="range"
        min={0}
        max={F - 1}
        step={0.01}
        value={playhead}
        onChange={(e) => setPlayhead(Number(e.target.value))}
        className="min-w-0 flex-1 accent-amber-300"
      />
      <span className="w-56 shrink-0 text-right font-mono text-sm text-zinc-200">
        t = {fmt(now)} {res.time_unit}
      </span>
    </div>
  );
}
