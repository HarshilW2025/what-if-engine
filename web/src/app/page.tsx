"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import AccuracyPanel from "@/components/AccuracyPanel";
import Timeline from "@/components/Timeline";
import { simulate } from "@/lib/api";
import { FOUR_SUNS } from "@/lib/demoSpecs";
import { usePlayer } from "@/lib/store";

// WebGL only exists in the browser, so the scene never renders on the server
const GravityScene = dynamic(() => import("@/components/GravityScene"), { ssr: false });

export default function Home() {
  const response = usePlayer((s) => s.response);
  const runId = usePlayer((s) => s.runId);
  const setResponse = usePlayer((s) => s.setResponse);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setResponse(await simulate(FOUR_SUNS));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const result = response?.result;

  return (
    <main className="flex h-screen w-screen flex-col bg-[#02030a] text-zinc-100">
      <header className="flex items-center gap-4 border-b border-white/10 px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">What If Engine</h1>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md bg-amber-300 px-4 py-1.5 text-sm font-medium text-black hover:bg-amber-200 disabled:opacity-50"
        >
          {loading ? "Simulating..." : "Run: four suns"}
        </button>
        {error && <span className="text-sm text-rose-400">{error}</span>}
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1 overflow-hidden">
          {result?.engine === "gravity" ? (
            <GravityScene key={runId} res={result} />
          ) : (
            <div className="grid h-full place-items-center text-zinc-500">Press Run to start a simulation.</div>
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
