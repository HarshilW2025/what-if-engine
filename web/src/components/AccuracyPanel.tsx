"use client";

import { sci, years } from "@/lib/format";
import type { SimResponse, Tier } from "@/lib/types";

const BADGE: Record<Tier, { label: string; cls: string }> = {
  exact: { label: "Exact", cls: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/40" },
  theory: { label: "Theory", cls: "bg-amber-400/15 text-amber-300 ring-amber-400/40" },
  unknown: { label: "Unknown", cls: "bg-rose-400/15 text-rose-300 ring-rose-400/40" },
};

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5" title={hint}>
      <span className="text-sm text-zinc-400">{k}</span>
      <span className="text-right text-sm tabular-nums text-zinc-100">{v}</span>
    </div>
  );
}

export default function AccuracyPanel({ resp }: { resp: SimResponse }) {
  const { spec, result } = resp;
  const badge = BADGE[spec.tier];

  return (
    <div className="space-y-5">
      <div>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${badge.cls}`}>
          {badge.label}
        </span>
        <h2 className="mt-2 text-lg font-semibold">{spec.title}</h2>
        <p className="text-sm text-zinc-400">{spec.question}</p>
      </div>

      {result.engine === "none" && <p className="text-sm text-zinc-300">{result.reason}</p>}

      {result.engine === "gravity" && (
        <>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Accuracy</h3>
            <div className="divide-y divide-white/5">
              <Row
                k="Energy drift"
                v={sci(result.diagnostics.energy_error_rel)}
                hint={result.diagnostics.conservative ? "Total energy should stay constant; this is how far it moved." : "Energy leaves this system by design, so drift here is physics, not error."}
              />
              <Row k="Angular momentum drift" v={sci(result.diagnostics.angular_momentum_error_rel)} />
              <Row
                k="Prediction horizon"
                v={
                  !result.diagnostics.horizon_checked
                    ? "not chaotic"
                    : result.diagnostics.prediction_horizon_yr != null
                      ? years(result.diagnostics.prediction_horizon_yr)
                      : `beyond ${years(result.times[result.times.length - 1])}`
                }
                hint={result.diagnostics.horizon_definition}
              />
              <Row k="Integrator" v={result.diagnostics.integrator} />
              <Row k="Compute time" v={`${result.diagnostics.wall_time_s.toFixed(2)} s`} />
            </div>
          </section>

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Physics used</h3>
            <ul className="space-y-1 text-sm text-zinc-300">
              {result.diagnostics.physics.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>

          {result.events.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Events</h3>
              <ul className="space-y-1 text-sm text-zinc-300">
                {result.events.map((e, k) => (
                  <li key={k}>
                    {years(e.t_yr)}: {e.body} merged{e.into ? ` into ${e.into}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {spec.assumptions && spec.assumptions.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Assumptions</h3>
              <ul className="space-y-1 text-sm text-zinc-400">
                {spec.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
