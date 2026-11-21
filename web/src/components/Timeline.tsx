"use client";

import { useEffect } from "react";
import { years } from "@/lib/format";
import { usePlayer } from "@/lib/store";

export default function Timeline({ times }: { times: number[] }) {
  const playhead = usePlayer((s) => s.playhead);
  const smartPace = usePlayer((s) => s.smartPace);
  const follow = usePlayer((s) => s.follow);
  const { setPlayhead, setSmartPace, setFollow } = usePlayer.getState();

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

  return (
    <div className="flex items-center gap-5">
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
        className="min-w-0 flex-1 accent-amber-300"
      />
      <span className="w-32 shrink-0 text-right text-base tabular-nums text-zinc-200">{years(yr)}</span>
      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-zinc-300" title="Spends more screen time on close passes and merges, less on empty drift. The physics is unchanged.">
        <input type="checkbox" checked={smartPace} onChange={(e) => setSmartPace(e.target.checked)} className="h-4 w-4 accent-amber-300" />
        Smart pace
      </label>
      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-zinc-300" title="Camera zooms to keep every body in view. Drag any time to look around.">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="h-4 w-4 accent-amber-300" />
        Follow
      </label>
    </div>
  );
}
