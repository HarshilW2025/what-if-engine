"use client";

import type { ReactNode } from "react";
import { fmt } from "@/lib/fmt";
import type { SimResponse, Theory } from "@/lib/types";

const SUPPORT: Record<Theory["support"], string> = {
  consensus: "Consensus",
  "mainstream-candidate": "Mainstream candidate",
  "significant-minority": "Significant minority",
  minority: "Minority view",
  fringe: "Fringe",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300/80">{title}</h3>
      {children}
    </section>
  );
}

/** Exactly three sections, every time: the answer, the computed results with their calculations, the assumptions. */
export default function AnswerPanel({ resp }: { resp: SimResponse }) {
  const { spec, result } = resp;
  if (result.engine === "none") return null;
  const theory = spec.tier === "theory";
  const numbers = result.numbers ?? [];
  const checks = result.diagnostics.checks ?? [];
  const review = checks.find((c) => c.name.startsWith("Independent review"));
  const grounding = result.diagnostics.grounding;
  const assumptions = spec.assumptions ?? [];

  return (
    <div className="space-y-6 text-sm">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${theory ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/15 text-emerald-300"}`}>
            {theory ? "Theory" : "Exact physics"}
          </span>
          {review && (
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${review.passed ? "bg-sky-400/10 text-sky-300" : "bg-rose-400/10 text-rose-300"}`} title={review.name}>
              {review.passed ? "✓ Independently reviewed" : "⚠ Review flagged a problem"}
            </span>
          )}
        </div>
        <h2 className="font-display text-xl font-semibold leading-snug">{spec.title}</h2>
        <p className="mt-1 text-zinc-400">{spec.question}</p>
      </div>

      <Section title="Answer">
        <p className="leading-relaxed text-zinc-100">{result.answer || "The simulation ran; the computed results are below."}</p>
        {grounding && grounding.numbers > 0 && (
          <p className={`mt-2 text-[11px] ${grounding.ungrounded.length ? "text-amber-300" : "text-emerald-400"}`}>
            {grounding.ungrounded.length ? `⚠ ${grounding.ungrounded.length} number(s) not traced to the computation` : "✓ Every number here is traced to the computation"}
          </p>
        )}
        {theory && spec.theories && spec.theories.length > 0 && (
          <ul className="mt-3 space-y-2">
            {spec.theories.map((t) => (
              <li key={t.name} className={`rounded-md border px-2.5 py-2 ${t.simulated ? "border-amber-300/40 bg-amber-300/5" : "border-white/10"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-zinc-100">{t.name}</span>
                  <span className="shrink-0 text-[10px] text-zinc-400">
                    {SUPPORT[t.support]}
                    {t.simulated ? " · shown" : ""}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{t.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Computed results">
        {numbers.length ? (
          <div className="space-y-3">
            {numbers.map((n) => (
              <div key={n.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-zinc-300">{n.name}</span>
                  <span className="shrink-0 font-mono text-zinc-100">
                    {fmt(n.value)} {n.unit}
                  </span>
                </div>
                {n.note && <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{n.note}</div>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-zinc-500">No headline numbers for this one.</p>
        )}
      </Section>

      <Section title="Assumptions">
        {assumptions.length ? (
          <ul className="list-disc space-y-1 pl-4 text-zinc-400">
            {assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : (
          <p className="text-zinc-500">Standard physics, nothing extra assumed.</p>
        )}
      </Section>
    </div>
  );
}
