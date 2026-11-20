"use client";

import { usePlayer } from "@/lib/store";
import { years } from "@/lib/format";

export default function Timeline({ times }: { times: number[] }) {
  const playhead = usePlayer((s) => s.playhead);
  const playing = usePlayer((s) => s.playing);
  const setPlayhead = usePlayer((s) => s.setPlayhead);
  const togglePlay = usePlayer((s) => s.togglePlay);

  const last = times.length - 1;
  const i = Math.min(Math.floor(playhead), last);
  const t = playhead - i;
  const yr = times[i] + ((times[Math.min(i + 1, last)] - times[i]) * t || 0);
  const label = playing ? "Pause" : playhead >= last ? "Replay" : "Play";

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={togglePlay}
        className="w-20 rounded-md border border-white/20 px-3 py-1 text-sm hover:bg-white/10"
      >
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
  );
}
