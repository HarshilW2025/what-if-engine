"use client";

import { useCompact } from "@/lib/useCompact";
import { usePlayer } from "@/lib/store";

/** Before the change: today's reality. After it: the what if. */
export default function PhaseBadge({ times, change }: { times: number[]; change?: { t: number; label: string } | null }) {
  const compact = useCompact();
  const playhead = usePlayer((s) => s.playhead);
  if (!change || !times.length) return null;
  const last = times.length - 1;
  const i = Math.min(Math.floor(playhead), last);
  const j = Math.min(i + 1, last);
  const now = times[i] + (times[j] - times[i]) * (playhead - i);
  const after = now >= change.t - 1e-12 * Math.max(1, Math.abs(change.t));
  return (
    <div style={{ position: "absolute", left: "50%", top: compact ? 46 : 64, transform: "translateX(-50%)", zIndex: 10, pointerEvents: "none", maxWidth: compact ? "92%" : undefined }}>
      <div
        className={`rounded-full border font-semibold backdrop-blur ${compact ? "px-3 py-1 text-center text-xs" : "whitespace-nowrap px-4 py-1.5 text-sm"} ${
          after ? "border-amber-300/50 bg-amber-300/15 text-amber-200" : "border-sky-300/40 bg-sky-400/10 text-sky-200"
        }`}
      >
        {after ? `What if: ${change.label}` : "Today: reality as it is"}
      </div>
    </div>
  );
}
