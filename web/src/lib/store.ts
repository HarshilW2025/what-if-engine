import { create } from "zustand";
import type { SimResponse } from "./types";

interface PlayerState {
  response: SimResponse | null;
  runId: number;
  playhead: number; // fractional frame index
  playing: boolean;
  fps: number; // frames advanced per second of real time
  setResponse: (r: SimResponse) => void;
  setPlayhead: (f: number) => void;
  togglePlay: () => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  response: null,
  runId: 0,
  playhead: 0,
  playing: false,
  fps: 25,
  setResponse: (r) =>
    set({
      response: r,
      runId: get().runId + 1,
      playhead: 0,
      playing: true,
      // every run plays back in about 12 seconds, however many frames it has
      fps: r.result.engine === "gravity" ? Math.max(10, r.result.times.length / 12) : 25,
    }),
  setPlayhead: (f) => set({ playhead: f }),
  togglePlay: () => {
    const s = get();
    const last = s.response?.result.engine === "gravity" ? s.response.result.times.length - 1 : 0;
    if (!s.playing && s.playhead >= last) set({ playhead: 0, playing: true });
    else set({ playing: !s.playing });
  },
}));
