"use client";

import { useCompact } from "@/lib/useCompact";
import { usePlayer } from "@/lib/store";

export const GRAVITY_SPEEDS = [0.1, 0.2, 0.5, 1, 2, 3, 5];
export const SCENE_SPEEDS = [0.25, 0.5, 1, 2, 4];

const ICON = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  replay: "M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z",
};

/** Big play and slow motion controls on the left edge of the simulation; a compact bar along the bottom on phones. */
export default function PlayRail({ speeds, last }: { speeds: number[]; last: number }) {
  const compact = useCompact();
  const playing = usePlayer((s) => s.playing);
  const playhead = usePlayer((s) => s.playhead);
  const speed = usePlayer((s) => s.speed);
  const { togglePlay, setSpeed } = usePlayer.getState();
  const mode = playing ? "pause" : playhead >= last ? "replay" : "play";
  const label = mode === "pause" ? "Pause" : mode === "replay" ? "Replay" : "Play";
  const icon = (cls: string) => (
    <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
      <path d={ICON[mode]} />
    </svg>
  );

  if (compact) {
    const shown = speeds.filter((s) => [0.2, 0.25, 0.5, 1, 2].includes(s));
    return (
      <div style={{ position: "absolute", left: 8, bottom: 8, zIndex: 10 }} className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-black/60 p-1.5 backdrop-blur">
        <button onClick={togglePlay} aria-label={label} className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-300 text-black">
          {icon("h-5 w-5")}
        </button>
        {shown.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`h-9 w-10 rounded-lg text-xs font-medium tabular-nums ${speed === s ? "bg-white text-black" : "border border-white/15 text-zinc-200"}`}
          >
            {s}×
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", zIndex: 10 }}
      className="flex flex-col items-center gap-2 rounded-2xl border border-white/15 bg-black/60 p-2 backdrop-blur"
    >
      <button
        onClick={togglePlay}
        title={`${label} (Space)`}
        aria-label={label}
        className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-300 text-black hover:bg-amber-200"
      >
        {icon("h-7 w-7")}
      </button>
      <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Speed</span>
      {speeds.map((s) => (
        <button
          key={s}
          onClick={() => setSpeed(s)}
          className={`h-10 w-14 rounded-lg text-sm font-medium tabular-nums ${
            speed === s ? "bg-white text-black" : "border border-white/15 text-zinc-200 hover:bg-white/10"
          }`}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}
