"use client";

import { fmt } from "@/lib/fmt";
import type { SceneResult, SimResponse, Theory } from "@/lib/types";

const SUPPORT: Record<Theory["support"], { w: number; label: string }> = {
  consensus: { w: 100, label: "Consensus" },
  "mainstream-candidate": { w: 75, label: "Mainstream candidate" },
  "significant-minority": { w: 50, label: "Significant minority" },
  minority: { w: 30, label: "Minority view" },
  fringe: { w: 12, label: "Fringe" },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

export default function ScenePanel({ resp }: { resp: SimResponse }) {
  const r = resp.result as SceneResult;
  const s = resp.spec;
  const theory = s.tier === "theory";
  const checks = r.diagnostics.checks;
  const passed = checks.filter((c) => c.passed).length;

  return (
    <div className="text-sm">
      <span
        className={`mb-3 inline-block rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
          theory ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/15 text-emerald-300"
        }`}
      >
        {theory ? "Theory" : "Exact physics"}
      </span>
      <h2 className="mb-1 text-base font-semibold leading-snug">{s.title}</h2>
      <p className="mb-5 text-zinc-400">{s.question}</p>

      {theory && s.theories && s.theories.length > 0 && (
        <Section title="What scientists think">
          <div className="space-y-3">
            {s.theories.map((t) => (
              <div key={t.name} className={`rounded-md border p-2.5 ${t.simulated ? "border-amber-300/40 bg-amber-300/5" : "border-white/10"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  {t.simulated && <span className="shrink-0 rounded bg-amber-300 px-1.5 text-[10px] font-semibold text-black">SIMULATED</span>}
                </div>
                {t.proponents && <div className="text-[11px] text-zinc-500">{t.proponents}</div>}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded bg-white/10">
                    <div className="h-1.5 rounded bg-amber-300/80" style={{ width: `${SUPPORT[t.support].w}%` }} />
                  </div>
                  <span className="w-32 shrink-0 text-right text-[10px] text-zinc-400">{SUPPORT[t.support].label}</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-300">{t.summary}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {r.numbers.length > 0 && (
        <Section title="Computed results">
          <div className="space-y-2">
            {r.numbers.map((n) => (
              <div key={n.name}>
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-300">{n.name}</span>
                  <span className="shrink-0 font-mono text-zinc-100">
                    {fmt(n.value)} {n.unit}
                  </span>
                </div>
                {n.note && <div className="text-[11px] text-zinc-500">{n.note}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Self checks: ${passed} of ${checks.length} passed`}>
        <div className="space-y-1.5">
          {checks.map((c) => (
            <div key={c.name} className="flex gap-2">
              <span className={c.passed ? "text-emerald-400" : "text-rose-400"}>{c.passed ? "✓" : "✗"}</span>
              <div>
                <div className="text-zinc-300">{c.name}</div>
                <div className="font-mono text-[11px] text-zinc-500">
                  got {fmt(c.value)}, expected {fmt(c.expected)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          Numbers are computed by the model from real equations. Visual effects such as glow and debris shapes are illustrated from those numbers.
        </p>
      </Section>

      {s.assumptions && s.assumptions.length > 0 && (
        <Section title="Assumptions">
          <ul className="list-disc space-y-1 pl-4 text-zinc-400">
            {s.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="How this was made">
        <div className="space-y-1 text-[12px] text-zinc-400">
          <div>Physics model written by {resp.meta?.model ?? "Claude"}, run in a sandbox in {fmt(r.diagnostics.runtime_s)} s</div>
          {resp.meta && <div>{resp.meta.attempts} attempt{resp.meta.attempts === 1 ? "" : "s"}, {resp.meta.output_tokens.toLocaleString()} tokens</div>}
        </div>
        {typeof s.params.code === "string" && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[12px] text-amber-300/80 hover:text-amber-300">View the model code</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded bg-black/50 p-2 text-[10px] leading-relaxed text-zinc-300">{s.params.code}</pre>
          </details>
        )}
      </Section>
    </div>
  );
}
