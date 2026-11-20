import { create } from "zustand";
import type { SimResponse } from "./types";

const ZOOM_MIN = 0.01;
const ZOOM_MAX = 50;

interface PlayerState {
  response: SimResponse | null;
  runId: number;
  playhead: number; // fractional frame index
  playing: boolean;
  speed: number; // playback multiplier
  smartPace: boolean; // spend screen time where the action is
  follow: boolean; // camera frames automatically
  zoom: number; // 1 = auto distance, below 1 = closer
  focus: number | null; // body id the camera locks onto, null = whole system
  setResponse: (r: SimResponse) => void;
  setPlayhead: (f: number) => void;
  togglePlay: () => void;
  setSpeed: (s: number) => void;
  setSmartPace: (on: boolean) => void;
  setFollow: (on: boolean) => void;
  zoomBy: (factor: number) => void;
  fit: () => void;
  setFocus: (id: number | null) => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  response: null,
  runId: 0,
  playhead: 0,
  playing: false,
  speed: 1,
  smartPace: true,
  follow: true,
  zoom: 1,
  focus: null,
  setResponse: (r) => set({ response: r, runId: get().runId + 1, playhead: 0, playing: true, zoom: 1, follow: true, focus: null }),
  setPlayhead: (f) => set({ playhead: f }),
  togglePlay: () => {
    const s = get();
    const last = s.response?.result.engine === "gravity" ? s.response.result.times.length - 1 : 0;
    if (!s.playing && s.playhead >= last) set({ playhead: 0, playing: true });
    else set({ playing: !s.playing });
  },
  setSpeed: (speed) => set({ speed }),
  setSmartPace: (smartPace) => set({ smartPace }),
  setFollow: (follow) => set({ follow }),
  zoomBy: (factor) => set({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, get().zoom * factor)) }),
  fit: () => set({ zoom: 1, follow: true, focus: null }),
  setFocus: (focus) => set({ focus, follow: true, zoom: 1 }),
}));
