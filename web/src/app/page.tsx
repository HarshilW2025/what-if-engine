"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import AccuracyPanel from "@/components/AccuracyPanel";
import Timeline from "@/components/Timeline";
import { ask, simulate } from "@/lib/api";
import { FOUR_SUNS } from "@/lib/demoSpecs";
import { usePlayer } from "@/lib/store";
import type { SimResponse } from "@/lib/types";

// WebGL only exists in the browser, so the scene never renders on the server
const GravityScene = dynamic(() => import("@/components/GravityScene"), { ssr: false });

const EXAMPLES = [
  "What if Jupiter were 1000 times heavier?",
  "What if a black hole flew through the solar system?",
  "What if gravity were twice as strong?",
  "What if Earth had a second moon as big as Mars?",
  "What happens inside a black hole?",
];

export default function Home() {
  const response = usePlayer((s) => s.response);
  const runId = usePlayer((s) => s.runId);
  const setResponse = usePlayer((s) => s.setResponse);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState<null | "ask" | "demo">(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [loading]);

  async function go(kind: "ask" | "demo", fn: () => Promise<SimResponse>) {
    setLoading(kind);
    setError(null);
    try {
      setResponse(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  function submit(q?: string) {
    const text = (q ?? question).trim();
    if (text.length < 3 || loading) return;
    if (q) setQuestion(q);
    go("ask", () => ask(text));
  }

  const result = response?.result;

  return (
    <main className="flex h-screen w-screen flex-col bg-[#02030a] text-zinc-100">
      <header className="flex items-center gap-4 border-b border-white/10 px-6 py-3">
        <h1 className="shrink-0 text-lg font-semibold tracking-tight">What If Engine</h1>
        <form
          className="flex min-w-0 max-w-3xl flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            placeholder="Ask any what if… e.g. What if the Sun suddenly vanished?"
            className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:border-amber-300/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!!loading || question.trim().length < 3}
            className="shrink-0 rounded-md bg-amber-300 px-4 py-1.5 text-sm font-medium text-black hover:bg-amber-200 disabled:opacity-40"
          >
            {loading === "ask" ? `Thinking… ${elapsed}s` : "Simulate"}
          </button>
        </form>
        <button
          onClick={() => go("demo", () => simulate(FOUR_SUNS))}
          disabled={!!loading}
          className="shrink-0 rounded-md border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-40"
        >
          {loading === "demo" ? "Running…" : "Demo: four suns"}
        </button>
      </header>

      {error && <div className="border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-sm text-rose-300">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1 overflow-hidden">
          {result?.engine === "gravity" ? (
            <GravityScene key={runId} res={result} />
          ) : result?.engine === "none" ? (
            <div className="grid h-full place-items-center p-8">
              <div className="max-w-xl rounded-xl border border-rose-400/30 bg-rose-400/5 p-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-rose-300">Unknown to physics</div>
                <h2 className="mb-3 text-xl font-semibold">{response?.spec.title}</h2>
                <p className="leading-relaxed text-zinc-300">{result.reason}</p>
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center p-8">
              <div className="max-w-2xl text-center">
                <h2 className="mb-2 text-2xl font-semibold">Ask the universe a what if.</h2>
                <p className="mb-6 text-zinc-400">Exact physics where the equations exist, honest uncertainty where they don&apos;t.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map((q) => (
                    <button
                      key={q}
                      onClick={() => submit(q)}
                      disabled={!!loading}
                      className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10 disabled:opacity-40"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {loading === "ask" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[2px]">
              <div className="rounded-lg border border-white/10 bg-black/70 px-5 py-3 text-sm text-zinc-200">
                Claude is setting up the physics, then the engine runs it · {elapsed}s
              </div>
            </div>
          )}
        </section>
        {response && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 p-5">
            <AccuracyPanel resp={response} />
          </aside>
        )}
      </div>

      {result?.engine === "gravity" && (
        <footer className="border-t border-white/10 px-6 py-3">
          <Timeline times={result.times} />
        </footer>
      )}
    </main>
  );
}
