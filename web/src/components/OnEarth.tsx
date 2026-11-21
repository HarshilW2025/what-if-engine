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
        <span className="text-zinc-300">{s.name}</span>
        <span className={`shrink-0 font-mono ${far ? "text-amber-300" : "text-zinc-100"}`}>
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
        <div className="mt-0.5 text-[11px] text-zinc-500">
          today: {fmt(ref)} {s.unit}
        </div>
      )}
    </div>
  );
}

/** What people on Earth feel and see, as a side panel section synced to the playhead. */
export default function OnEarth({ earth, times, unit }: { earth: EarthPanel; times: number[]; unit: string }) {
  const playhead = usePlayer((s) => s.playhead);
  if (!earth.series.length && !earth.events.length) return null;
  const i = Math.min(times.length - 1, Math.max(0, Math.round(playhead)));
  const now = times[i];
  const eps = 1e-9 * Math.max(1, Math.abs(now));
  const curIdx = earth.events.reduce((k, e, j) => (e.t <= now + eps ? j : k), -1);
  return (
    <div className="space-y-4">
      {earth.events.length > 0 && (
        <ol className="space-y-1.5">
          {earth.events.map((e, j) => (
            <li
              key={`${e.t}-${j}`}
              className={`rounded-md px-2.5 py-1.5 leading-snug transition-colors ${
                j === curIdx ? "bg-sky-400/15 text-white" : j < curIdx ? "text-zinc-300" : "text-zinc-500"
              }`}
            >
              <span className={`mr-1.5 font-mono text-[11px] ${j <= curIdx ? "text-sky-300" : "text-zinc-600"}`}>{when(e.t, unit)}</span>
              {e.text}
            </li>
          ))}
        </ol>
      )}
      {earth.series.length > 0 && (
        <div className="space-y-3">
          {earth.series.slice(0, 4).map((s) => (
            <Gauge key={s.name} s={s} i={i} />
          ))}
        </div>
      )}
      {earth.note && <p className="text-[11px] leading-snug text-zinc-500">{earth.note}</p>}
    </div>
  );
}
