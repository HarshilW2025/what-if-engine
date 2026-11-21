"use client";

import { fmt } from "@/lib/fmt";
import { usePlayer } from "@/lib/store";
import type { EarthPanel, EarthSeries } from "@/lib/types";

function when(t: number, unit: string) {
  const u = unit.toLowerCase();
  if (u === "yr" || u.startsWith("year")) return t < 1 ? `Day ${Math.round(t * 365.25)}` : `Year ${fmt(t)}`;
  if (u === "d" || u.startsWith("day")) return `Day ${fmt(t)}`;
  return `${fmt(t)} ${unit}`;
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

function Gauge({ s, i }: { s: EarthSeries; i: number }) {
  const fin = s.values.filter((v): v is number => v != null && Number.isFinite(v));
  const ref = s.today != null && Number.isFinite(s.today) ? s.today : null;
  const all = ref != null ? [...fin, ref] : fin;
  const useLog = all.length > 0 && all.every((v) => v > 0) && Math.max(...all) / Math.min(...all) > 1e3;
  const tr = (v: number) => (useLog ? Math.log10(v) : v);
  const a = all.length ? tr(Math.min(...all)) : 0;
  const b = all.length ? tr(Math.max(...all)) : 1;
  const span = b - a || 1;
  const raw = s.values[Math.min(i, s.values.length - 1)];
  const cur = raw != null && Number.isFinite(raw) ? raw : null;
  const far = cur != null && ref != null && Math.abs(cur - ref) > 0.25 * Math.max(Math.abs(ref), 1);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-zinc-300">{s.name}</span>
        <span className={`shrink-0 font-mono text-sm ${far ? "text-amber-300" : "text-white"}`}>
          {cur == null ? "n/a" : fmt(cur)} {s.unit}
        </span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-white/10">
        {cur != null && (
          <div className={`absolute inset-y-0 left-0 rounded-full ${far ? "bg-amber-400" : "bg-sky-400"}`} style={{ width: `${clamp((tr(cur) - a) / span) * 100}%` }} />
        )}
        {ref != null && <div className="absolute -top-1 h-3.5 w-0.5 bg-white/80" style={{ left: `${clamp((tr(ref) - a) / span) * 100}%` }} title="today" />}
      </div>
      {ref != null && (
        <div className="mt-0.5 text-[10px] text-zinc-500">
          today: {fmt(ref)} {s.unit}
        </div>
      )}
    </div>
  );
}

/** What people on Earth feel and see, synced to the playhead. */
export default function OnEarth({ earth, times, unit }: { earth: EarthPanel; times: number[]; unit: string }) {
  const playhead = usePlayer((s) => s.playhead);
  if (!earth.series.length && !earth.events.length) return null;
  const i = Math.min(times.length - 1, Math.max(0, Math.round(playhead)));
  const now = times[i];
  const cur = earth.events.filter((e) => e.t <= now + 1e-9 * Math.max(1, Math.abs(now))).at(-1);
  return (
    <div className="w-72 rounded-xl border border-sky-300/25 bg-black/65 p-3 backdrop-blur">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.9)]" />
        <span className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">On Earth</span>
      </div>
      {cur && (
        <div key={cur.text} className="mb-3 rounded-lg bg-sky-400/10 px-2.5 py-2 text-[13px] leading-snug text-white">
          <span className="mr-1.5 font-mono text-[11px] text-sky-300">{when(cur.t, unit)}</span>
          {cur.text}
        </div>
      )}
      <div className="space-y-2.5">
        {earth.series.slice(0, 4).map((s) => (
          <Gauge key={s.name} s={s} i={i} />
        ))}
      </div>
      {earth.note && <p className="mt-2 text-[10px] leading-snug text-zinc-500">{earth.note}</p>}
    </div>
  );
}
