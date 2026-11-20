import * as THREE from "three";

let glow: THREE.CanvasTexture | null = null;
let ring: THREE.CanvasTexture | null = null;

function radial(stops: [number, string][]): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** soft round glow for coronas and flashes */
export function glowTexture(): THREE.CanvasTexture {
  glow ??= radial([
    [0, "rgba(255,255,255,1)"],
    [0.15, "rgba(255,255,255,0.55)"],
    [0.45, "rgba(255,255,255,0.12)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  return glow;
}

/** thin bright ring for merge shockwaves */
export function ringTexture(): THREE.CanvasTexture {
  ring ??= radial([
    [0, "rgba(255,255,255,0)"],
    [0.72, "rgba(255,255,255,0)"],
    [0.86, "rgba(255,255,255,0.9)"],
    [0.93, "rgba(255,255,255,0.15)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  return ring;
}

/** main sequence estimate: L ~ M^3.5 and R ~ M^0.8 give T ~ M^0.5 roughly, anchored on the Sun */
export function starTemperature(massMsun: number): number {
  return 5778 * Math.sqrt(Math.max(massMsun, 0.08));
}

/** blackbody colour for a temperature in kelvin (Tanner Helland fit) */
export function kelvinToColor(kelvin: number): THREE.Color {
  const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}
