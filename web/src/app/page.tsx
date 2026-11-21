"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import AmbientMusic from "@/components/AmbientMusic";
import AnswerPanel from "@/components/AnswerPanel";
import LoadingFacts from "@/components/LoadingFacts";
import DescendLauncher from "@/components/DescendLauncher";
import PhaseBadge from "@/components/PhaseBadge";
import PlayRail, { GRAVITY_SPEEDS, SCENE_SPEEDS } from "@/components/PlayRail";
import SceneTimeline from "@/components/SceneTimeline";
import Timeline from "@/components/Timeline";
import { askWithProgress } from "@/lib/api";
import { usePlayer } from "@/lib/store";

// WebGL only exists in the browser, so the scenes never render on the server
const GravityScene = dynamic(() => import("@/components/GravityScene"), { ssr: false });
const SceneView = dynamic(() => import("@/components/SceneView"), { ssr: false });

const EXAMPLES = [
  "What if the Moon were twice as close?",
  "What if a rogue planet hit Earth?",
  "What if our solar system had four suns?",
  "Could we travel back in time?",
  "What if the Sun suddenly disappeared?",
];

export default function Home() {
  const response = usePlayer((s) => s.response);
  const runId = usePlayer((s) => s.runId);
  const setResponse = usePlayer((s) => s.setResponse);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
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

  async function submit(q?: string) {
    const text = (q ?? question).trim();
    if (text.length < 3 || loading) return;
    if (q) setQuestion(q);
    setLoading(true);
    setError(null);
    try {
      setResponse(await askWithProgress(text, (steps) => console.debug("[pipeline]", steps.at(-1)?.detail)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function back() {
    usePlayer.setState({ response: null, playing: false, playhead: 0, focus: null, zoom: 1, follow: true });
    setQuestion("");
    setError(null);
  }

  const result = response?.result;
  const askBox = (big: boolean) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className={
        big
          ? "mt-10 flex w-full max-w-2xl gap-2 rounded-2xl border border-white/15 bg-black/45 p-2 shadow-2xl backdrop-blur-md"
          : "mx-auto flex min-w-0 max-w-2xl flex-1 gap-2 max-md:order-last max-md:basis-full"
      }
    >
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={500}
        autoFocus={big}
        placeholder="Ask any cosmology what if…"
        className={
          big
            ? "min-w-0 flex-1 bg-transparent px-4 py-3 text-lg text-white placeholder:text-zinc-500 focus:outline-none"
            : "min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:border-amber-300/60 focus:outline-none"
        }
      />
      <button
        type="submit"
        disabled={loading || question.trim().length < 3}
        className={`shrink-0 rounded-xl bg-amber-300 font-display font-semibold text-black hover:bg-amber-200 disabled:opacity-40 ${big ? "px-6 py-3 text-base" : "px-4 py-1.5 text-sm"}`}
      >
        {loading ? `Simulating… ${elapsed}s` : "Simulate"}
      </button>
    </form>
  );
  const loadingOverlay = loading && (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/50 backdrop-blur-sm">
      <LoadingFacts elapsed={elapsed} />
    </div>
  );

  return (
    <>
      <AmbientMusic />
      {!response ? (
        <main className="relative h-screen w-screen overflow-hidden bg-[#02030a] text-zinc-100">
          <div className="hero-bg absolute inset-0" aria-hidden />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(2,3,10,0.35)_0%,rgba(2,3,10,0.85)_70%,#02030a_100%)]" aria-hidden />
          <div className="relative z-10 flex h-full flex-col items-center justify-center px-6">
            <h1 className="font-display text-5xl font-semibold tracking-tight sm:text-6xl">Spaced Out</h1>
            <p className="mt-3 max-w-xl text-center text-base text-zinc-300/90">
              Ask the universe a what if. Exact physics where the equations exist; what scientists believe where they don&apos;t.
            </p>
            <p className="mt-2 text-center font-display text-lg font-bold text-amber-300">For all your space doubts</p>
            {askBox(true)}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => void submit(q)}
                  disabled={loading}
                  className="rounded-full border border-white/15 bg-black/30 px-4 py-1.5 text-sm text-zinc-300 backdrop-blur hover:bg-white/10 disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
            {error && <p className="mt-5 max-w-xl text-center text-sm text-rose-300">{error}</p>}
          </div>
          <p className="absolute bottom-3 left-0 right-0 z-10 text-center text-[11px] text-zinc-500">
            Background: NASA, ESA, CSA, and STScI (Webb, Cosmic Cliffs) · Planet maps: Solar System Scope, CC BY 4.0
          </p>
          {loadingOverlay}
        </main>
      ) : (
        <main className="flex min-h-[100dvh] w-full flex-col bg-[#02030a] text-zinc-100 md:h-screen md:w-screen">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-3 py-3 md:flex-nowrap md:pl-5 md:pr-36">
            <button onClick={back} className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5">
              ← Back
            </button>
            <span className="hidden shrink-0 font-display text-lg font-semibold tracking-tight md:block">Spaced Out</span>
            {askBox(false)}
          </header>

          {error && <div className="border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-sm text-rose-300">{error}</div>}

          <div className="flex min-h-0 flex-1 max-md:contents">
            <section className="relative min-w-0 flex-1 overflow-hidden max-md:order-1 max-md:h-[58dvh] max-md:flex-none">
              {result?.engine === "gravity" ? (
                <GravityScene key={runId} res={result} />
              ) : result?.engine === "scene" ? (
                <SceneView key={runId} res={result} />
              ) : result?.engine === "none" ? (
                <div className="grid h-full place-items-center p-8">
                  <div className="max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-7">
                    <div className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.16em] text-amber-300/80">Outside physics</div>
                    <h2 className="mb-3 font-display text-2xl font-semibold">{response.spec.title}</h2>
                    <p className="leading-relaxed text-zinc-300">{result.reason}</p>
                  </div>
                </div>
              ) : null}
              {result && result.engine !== "none" && (
                <PlayRail speeds={result.engine === "gravity" ? GRAVITY_SPEEDS : SCENE_SPEEDS} last={result.times.length - 1} />
              )}
              {result && result.engine !== "none" && <PhaseBadge times={result.times} change={result.change} />}
              {result && result.engine !== "none" && <DescendLauncher result={result} />}
              {loadingOverlay}
            </section>
            {result && result.engine !== "none" && (
              <aside className="w-96 shrink-0 overflow-y-auto border-l border-white/10 bg-black/30 p-6 max-md:order-3 max-md:w-full max-md:overflow-visible max-md:border-l-0 max-md:border-t max-md:p-4">
                <AnswerPanel resp={response} />
              </aside>
            )}
          </div>

          {result?.engine === "gravity" && (
            <footer className="border-t border-white/10 px-6 py-3 max-md:order-2 max-md:px-3">
              <Timeline times={result.times} />
            </footer>
          )}
          {result?.engine === "scene" && (
            <footer className="border-t border-white/10 px-6 py-3 max-md:order-2 max-md:px-3">
              <SceneTimeline res={result} />
            </footer>
          )}
        </main>
      )}
    </>
  );
}
