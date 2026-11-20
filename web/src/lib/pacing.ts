import type { GravityResult } from "./types";

/** At 1x, a whole run plays in about this many seconds. */
export const TARGET_SECONDS = 20;
const MAX_SLOWDOWN = 20; // the busiest frame lasts at most 20x the quietest
const SMOOTH = 6; // frames either side, so slow-downs ease in and out

/**
 * Seconds of screen time per frame step at 1x.
 * Smart pacing measures how sharply bodies turn each frame (|change in velocity| / |velocity|)
 * and gives sharp moments, like close passes and merges, more screen time.
 * The physics is untouched; only the playback clock changes.
 */
export function frameDurations(res: GravityResult, smart: boolean): Float32Array {
  const n = res.positions.length;
  const d = new Float32Array(n);
  if (!smart || n < 3) {
    d.fill(TARGET_SECONDS / n);
    return d;
  }

  const act = new Float32Array(n);
  for (let f = 1; f < n - 1; f++) {
    let m = 0;
    for (let b = 0; b < res.bodies.length; b++) {
      const p0 = res.positions[f - 1][b];
      const p1 = res.positions[f][b];
      const p2 = res.positions[f + 1][b];
      if (p1 && !p2) {
        m = Math.max(m, 0.5); // a merge happens here
        continue;
      }
      if (!p0 || !p1 || !p2) continue;
      const ax = p2[0] - 2 * p1[0] + p0[0];
      const ay = p2[1] - 2 * p1[1] + p0[1];
      const az = p2[2] - 2 * p1[2] + p0[2];
      const vx = (p2[0] - p0[0]) / 2;
      const vy = (p2[1] - p0[1]) / 2;
      const vz = (p2[2] - p0[2]) / 2;
      const turn = Math.hypot(ax, ay, az) / (Math.hypot(vx, vy, vz) + 1e-12);
      if (turn > m) m = turn;
    }
    act[f] = m;
  }
  act[0] = act[1];
  act[n - 1] = act[n - 2];

  const smooth = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, f - SMOOTH); k <= Math.min(n - 1, f + SMOOTH); k++) {
      s += act[k];
      c++;
    }
    smooth[f] = s / c;
  }

  const sorted = Array.from(smooth).sort((a, b) => a - b);
  const p90 = sorted[Math.floor(0.9 * (n - 1))] || 1e-9;
  const floor = p90 * 0.05 + 1e-12;

  let maxD = 0;
  for (let f = 0; f < n; f++) {
    d[f] = Math.sqrt(smooth[f] + floor);
    if (d[f] > maxD) maxD = d[f];
  }
  let total = 0;
  for (let f = 0; f < n; f++) {
    d[f] = Math.max(d[f], maxD / MAX_SLOWDOWN);
    total += d[f];
  }
  const scale = TARGET_SECONDS / total;
  for (let f = 0; f < n; f++) d[f] *= scale;
  return d;
}
