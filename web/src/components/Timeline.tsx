"use client";

import { useEffect } from "react";
import { years } from "@/lib/format";
import { usePlayer } from "@/lib/store";

const SPEEDS = [0.1, 0.2, 0.5, 1, 2, 3, 5];

export default function Timeline({ times }: { times: number[] }) {
  const playhead = usePlayer((s) => s.playhead);
  const playing = usePlayer((s) => s.playing);
  const speed = usePlayer((s) => s.speed);
  const smartPace = usePlayer((s) => s.smartPace);
  const follow = usePlayer((s) => s.follow);
  const { setPlayhead, togglePlay, setSpeed, setSmartPace, setFollow } = usePlayer.getState();

  // spacebar plays and pauses, unless you're typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code !== "Space" || el?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      usePlayer.getState().togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const last = times.length - 1;
  const i = Math.min(Math.floor(playhead), last);
  const frac = playhead - i;
  const yr = times[i] + ((times[Math.min(i + 1, last)] - times[i]) * frac || 0);
  const label = playing ? "Pause" : playhead >= last ? "Replay" : "Play";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <button onClick={togglePlay} className="w-20 rounded-md border border-white/20 px-3 py-1 text-sm hover:bg-white/10">
          {label}
        </button>
        <input
          type="range"
          min={0}
          max={last}
          step={0.01}
          value={playhead}
          onChange={(e) => {
            usePlayer.setState({ playing: false });
            setPlayhead(Number(e.target.value));
          }}
          className="flex-1 accent-amber-300"
        />
        <span className="w-28 text-right text-sm tabular-nums text-zinc-300">{years(yr)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-zinc-500">Speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded px-2 py-0.5 text-xs tabular-nums ${speed === s ? "bg-amber-300 font-medium text-black" : "text-zinc-300 hover:bg-white/10"}`}
            >
              {s}×
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300" title="Spends more screen time on close passes and merges, less on empty drift. The physics is unchanged.">
          <input type="checkbox" checked={smartPace} onChange={(e) => setSmartPace(e.target.checked)} className="accent-amber-300" />
          Smart pace
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300" title="Camera zooms to keep every body in view. Drag any time to look around.">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-amber-300" />
          Follow
        </label>
        <span className="text-xs text-zinc-500">Space to play or pause</span>
      </div>
    </div>
  );
}
