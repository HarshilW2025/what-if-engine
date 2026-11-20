"use client";

import { useEffect, useRef, useState } from "react";

const KEY = "wie-music";
const VOLUME = 0.2;
const CHORDS = [
  [220.0, 261.63, 329.63], // A minor
  [174.61, 220.0, 261.63], // F major
  [196.0, 246.94, 293.66], // G major
  [164.81, 207.65, 246.94], // E major
];
const STARS = [880, 987.77, 1174.66, 1318.51, 1567.98, 1760];

/** Ambient space music made live in the browser: no audio file, no licence. It starts on the first click or key press
 * (browsers block sound until then); the button mutes it, and the choice is remembered. Render once per page. */
export default function AmbientMusic() {
  const [on, setOn] = useState(true);
  const ctx = useRef<AudioContext | null>(null);
  const out = useRef<GainNode | null>(null);
  const onRef = useRef(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "off") {
        setOn(false);
        onRef.current = false;
      }
    } catch {
      /* storage unavailable: default on */
    }
  }, []);

  useEffect(() => {
    let chordTimer = 0;
    let pingTimer = 0;
    function build() {
      if (ctx.current) return;
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = new AC();
      ctx.current = c;
      const master = c.createGain();
      master.gain.value = 0;
      out.current = master;
      master.connect(c.createDynamicsCompressor()).connect(c.destination);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      lp.Q.value = 0.6;
      lp.connect(master);
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.035;
      const lfoAmt = c.createGain();
      lfoAmt.gain.value = 350;
      lfo.connect(lfoAmt).connect(lp.frequency);
      lfo.start();
      const delay = c.createDelay(3);
      delay.delayTime.value = 1.1;
      const fb = c.createGain();
      fb.gain.value = 0.42;
      const wet = c.createGain();
      wet.gain.value = 0.5;
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(master);
      for (const f of [55, 82.41]) {
        for (const det of [-5, 5]) {
          const o = c.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = f;
          o.detune.value = det;
          const g = c.createGain();
          g.gain.value = 0.035;
          o.connect(g).connect(lp);
          o.start();
        }
      }
      const pad = CHORDS[0].map((f) => {
        const o = c.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.value = 0.03;
        o.connect(g);
        g.connect(lp);
        g.connect(delay);
        o.start();
        return o;
      });
      let k = 0;
      chordTimer = window.setInterval(() => {
        k = (k + 1) % CHORDS.length;
        pad.forEach((o, n) => o.frequency.setTargetAtTime(CHORDS[k][n], c.currentTime, 3));
      }, 14000);
      const ping = () => {
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.value = STARS[Math.floor(Math.random() * STARS.length)];
        const g = c.createGain();
        const t = c.currentTime;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.025, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
        o.connect(g);
        g.connect(delay);
        g.connect(master);
        o.start(t);
        o.stop(t + 5.2);
        pingTimer = window.setTimeout(ping, 2500 + Math.random() * 4500);
      };
      ping();
      if (onRef.current) master.gain.linearRampToValueAtTime(VOLUME, c.currentTime + 4);
    }
    const start = () => {
      build();
      void ctx.current?.resume();
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      clearInterval(chordTimer);
      clearTimeout(pingTimer);
      void ctx.current?.close();
      ctx.current = null;
    };
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    onRef.current = next;
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      /* ignore */
    }
    const c = ctx.current;
    const g = out.current;
    if (c && g) {
      void c.resume();
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setTargetAtTime(next ? VOLUME : 0, c.currentTime, 0.4);
    }
  }

  return (
    <button
      onClick={toggle}
      title={on ? "Mute music" : "Play music"}
      className="fixed right-4 top-3 z-50 rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur hover:bg-white/10"
    >
      {on ? "♪ Music on" : "♪ Music off"}
    </button>
  );
}
