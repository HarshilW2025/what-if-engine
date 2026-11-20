"use client";

import { useEffect } from "react";
import { fmt } from "@/lib/fmt";
import { usePlayer } from "@/lib/store";
import type { SceneResult } from "@/lib/types";

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export default function SceneTimeline({ res }: { res: SceneResult }) {
  const F = res.times.length;
  const playhead = usePlayer((s) => s.playhead);
  const playing = usePlayer((s) => s.playing);
  const speed = usePlayer((s) => s.speed);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const setPlayhead = usePlayer((s) => s.setPlayhead);
  const setSpeed = usePlayer((s) => s.setSpeed);

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
    <div className="flex items-center gap-4">
      <button onClick={togglePlay} className="w-20 rounded-md border border-white/15 px-3 py-1 text-sm hover:bg-white/5">
        {playing ? "Pause" : playhead >= F - 1 ? "Replay" : "Play"}
      </button>
      <input
        type="range"
        min={0}
        max={F - 1}
        step={0.01}
        value={playhead}
        onChange={(e) => setPlayhead(Number(e.target.value))}
        className="min-w-0 flex-1 accent-amber-300"
      />
      <span className="w-48 shrink-0 text-right font-mono text-xs text-zinc-300">
        t = {fmt(now)} {res.time_unit}
      </span>
      <div className="flex shrink-0 gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`rounded px-2 py-0.5 text-xs ${speed === s ? "bg-amber-300 text-black" : "text-zinc-400 hover:bg-white/5"}`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
