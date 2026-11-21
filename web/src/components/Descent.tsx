"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { fmt } from "@/lib/fmt";
import { Safe, lookFor } from "./scene/looks";

export type World = {
  name: string;
  radiusKm: number;
  p0Bar: number | null; // surface pressure; for giants, null and the 1 bar level is altitude 0
  hKm: number; // pressure scale height
  tC: number | null; // mean surface temperature
  solid: boolean;
  zenith: string;
  horizon: string;
  haze: number; // how thick the air looks at the bottom
  light: number; // how much sunlight reaches the bottom
  map: string | null;
  ground: string;
  note: string;
  estimate: boolean;
};

const P = "/textures/planets/";
const GIANT = "No solid surface: the gas just gets denser and hotter until it turns liquid. A probe is crushed long before any bottom, as Galileo's was in 1995.";
const KNOWN: Record<string, Omit<World, "name" | "estimate">> = {
  earth: { radiusKm: 6371, p0Bar: 1.013, hKm: 8.5, tC: 15, solid: true, zenith: "#2f6fd6", horizon: "#b8d6f2", haze: 0.6, light: 1, map: "/textures/earth/day.jpg", ground: "#4a6a3a",
    note: "Air scatters blue sunlight far more than red (Rayleigh scattering), so the sky is blue and sunsets are red." },
  mars: { radiusKm: 3390, p0Bar: 0.006, hKm: 11.1, tC: -63, solid: true, zenith: "#c79a73", horizon: "#e6bf94", haze: 0.5, light: 0.7, map: P + "2k_mars.jpg", ground: "#9a5a35",
    note: "Fine red dust turns the daytime sky butterscotch, and Martian sunsets are blue. The air is less than 1% of Earth's pressure." },
  venus: { radiusKm: 6052, p0Bar: 92, hKm: 15.9, tC: 464, solid: true, zenith: "#7d5a24", horizon: "#c8913f", haze: 2.4, light: 0.3, map: null, ground: "#6e4a2a",
    note: "Sulphuric acid clouds let through only a dim orange light. At the surface the air presses 92 times harder than on Earth and is hot enough to melt lead." },
  titan: { radiusKm: 2575, p0Bar: 1.47, hKm: 21, tC: -179, solid: true, zenith: "#6e4f22", horizon: "#b5823e", haze: 2.2, light: 0.12, map: null, ground: "#5a4426",
    note: "A smog of organic haze hides the surface in orange gloom. It rains liquid methane into lakes and seas." },
  jupiter: { radiusKm: 69911, p0Bar: null, hKm: 27, tC: null, solid: false, zenith: "#8a6a48", horizon: "#d9b98d", haze: 1.6, light: 0.6, map: P + "2k_jupiter.jpg", ground: "#8a6a48", note: GIANT },
  saturn: { radiusKm: 58232, p0Bar: null, hKm: 59.5, tC: null, solid: false, zenith: "#9c8458", horizon: "#e3cf9e", haze: 1.6, light: 0.5, map: P + "2k_saturn.jpg", ground: "#9c8458", note: GIANT },
  uranus: { radiusKm: 25362, p0Bar: null, hKm: 27.7, tC: null, solid: false, zenith: "#5e9aa6", horizon: "#a9dde3", haze: 1.4, light: 0.35, map: P + "2k_uranus.jpg", ground: "#5e9aa6", note: GIANT },
  neptune: { radiusKm: 24622, p0Bar: null, hKm: 19.7, tC: null, solid: false, zenith: "#284e9e", horizon: "#6f9fe6", haze: 1.4, light: 0.3, map: P + "2k_neptune.jpg", ground: "#284e9e", note: GIANT },
};

/** The world to descend into: real data for real bodies, the atmosphere estimate for invented ones. */
export function worldFor(name: string, atmoColor: [number, number, number], tint: string | null | undefined, giant: boolean): World {
  const key = name.toLowerCase().replace(/\(.*?\)/g, "").replace(/^the\s+/, "").trim();
  const known = KNOWN[key];
  if (known) return { name, ...known, estimate: false };
  const c = new THREE.Color(...atmoColor);
  const zen = c.clone().multiplyScalar(0.55);
  const hor = c.clone().multiplyScalar(0.85).addScalar(0.1);
  return {
    name, radiusKm: giant ? 60000 : 6371, p0Bar: giant ? null : 1, hKm: giant ? 27 : 8.5, tC: null, solid: !giant,
    zenith: `#${zen.getHexString()}`, horizon: `#${hor.getHexString()}`, haze: 0.9, light: 0.8,
    map: lookFor(name)?.map ?? (/earth/.test(key) ? "/textures/earth/day.jpg" : null), ground: tint ?? "#8a7a6a",
    note: giant ? GIANT : "An invented world: its sky colour and air are estimates from its atmosphere, assuming Earth-like pressure.", estimate: true,
  };
}

const DUR = 14;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ease = (p: number) => 1 - Math.pow(1 - p, 2.2);

function layerName(w: World, alt: number) {
  if (!w.solid && alt < 0) return "Inside the cloud decks";
  if (w.name.toLowerCase().includes("earth") && !w.estimate) {
    if (alt > 700) return "Exosphere: the edge of space";
    if (alt > 80) return "Thermosphere: aurorae; the ISS orbits at 400 km";
    if (alt > 50) return "Mesosphere: meteors burn up here";
    if (alt > 12) return "Stratosphere: the ozone layer";
    return "Troposphere: weather and clouds";
  }
  if (alt > 12 * w.hKm) return "Space";
  if (alt > 3 * w.hKm) return "Upper atmosphere";
  return "Lower atmosphere";
}

type Tick = { alt: number; bar: number | null; layer: string; done: boolean };

const SKY_VERT = /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uZen; uniform vec3 uHor; uniform float uF;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  gl_FragColor = vec4(mix(uHor, uZen, pow(h, 0.45)) * uF, 1.0);
}`;

function PlanetSurface({ w }: { w: World }) {
  const tex = useLoader(THREE.TextureLoader, w.map as string);
  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
  }, [tex]);
  return <meshStandardMaterial map={tex} roughness={1} metalness={0} />;
}

function Flight({ w, onTick }: { w: World; onTick: MutableRefObject<(t: Tick) => void> }) {
  const { camera, scene } = useThree();
  const R = w.radiusKm;
  const planet = useRef<THREE.Group>(null);
  const t = useRef(0);
  const acc = useRef(0);
  const zen = useMemo(() => new THREE.Color(w.zenith), [w]);
  const hor = useMemo(() => new THREE.Color(w.horizon), [w]);
  const sky = useMemo(
    () => new THREE.ShaderMaterial({ uniforms: { uZen: { value: zen.clone() }, uHor: { value: hor.clone() }, uF: { value: 0 } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    [zen, hor],
  );
  const stars = useMemo(() => {
    const n = 2500;
    const a = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(200000);
      a.set([v.x, v.y, v.z], k * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    return g;
  }, []);
  const starMat = useMemo(() => new THREE.PointsMaterial({ color: "#ffffff", size: 1.6, sizeAttenuation: false, transparent: true, fog: false }), []);
  const skyMesh = useRef<THREE.Mesh>(null);
  const starPts = useRef<THREE.Points>(null);
  const fogC = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    scene.fog = new THREE.FogExp2(w.horizon, 0);
    scene.background = new THREE.Color("#000000");
    return () => {
      scene.fog = null;
      sky.dispose();
      stars.dispose();
      starMat.dispose();
    };
  }, [scene, w, sky, stars, starMat]);

  useFrame((_, delta) => {
    t.current = Math.min(DUR, t.current + Math.min(delta, 0.05));
    const p = t.current / DUR;
    const e = ease(p);
    const start = R * 1.6;
    let alt: number;
    if (w.solid) alt = Math.exp(Math.log(start) + (Math.log(2) - Math.log(start)) * e);
    else if (e < 0.85) alt = Math.exp(Math.log(start) + (Math.log(50) - Math.log(start)) * (e / 0.85));
    else alt = 50 + (-8 * w.hKm - 50) * ((e - 0.85) / 0.15);

    camera.position.set(0, alt, 0);
    camera.rotation.set(THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-89.5, -4, smooth(0.5, 0.97, p))), 0, 0, "YXZ");
    (camera as THREE.PerspectiveCamera).near = Math.max(0.01, Math.abs(alt) * 0.002);
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();

    const H = w.hKm;
    const skyF = smooth(12 * H, 1.2 * H, alt);
    const deep = w.solid ? 0 : smooth(0, -8 * H, alt);
    const u = sky.uniforms;
    u.uZen.value.copy(zen).multiplyScalar(w.light * (1 - 0.8 * deep));
    u.uHor.value.copy(hor).multiplyScalar(w.light * (1 - 0.8 * deep));
    u.uF.value = skyF;
    starMat.opacity = 1 - skyF;
    skyMesh.current?.position.copy(camera.position);
    starPts.current?.position.copy(camera.position);
    const fog = scene.fog as THREE.FogExp2;
    fogC.copy(hor).multiplyScalar(w.light * (1 - 0.8 * deep));
    fog.color.copy(fogC);
    const rel = Math.exp(-Math.max(alt, 0) / H);
    fog.density = 0.004 * w.haze * rel * skyF + (w.solid ? 0 : 0.05 * deep);
    if (planet.current) planet.current.visible = alt > 1;

    acc.current += delta;
    if (acc.current > 0.1 || p >= 1) {
      acc.current = 0;
      const bar = w.p0Bar != null ? w.p0Bar * rel : alt < 12 * H ? Math.exp(-alt / H) : null;
      onTick.current({ alt, bar: alt > 12 * H ? null : bar, layer: layerName(w, alt), done: p >= 1 });
    }
  });

  return (
    <>
      <ambientLight intensity={0.15 + 0.1 * w.light} />
      <directionalLight position={[0.6, 0.55, -0.6]} intensity={2.2 * w.light + 0.2} />
      <mesh ref={skyMesh} material={sky}>
        <sphereGeometry args={[150000, 48, 24]} />
      </mesh>
      <points ref={starPts} geometry={stars} material={starMat} />
      <group ref={planet} position={[0, -R, 0]} rotation={[0.35, 2.2, 0]}>
        <mesh>
          <sphereGeometry args={[R, 256, 128]} />
          {w.map ? (
            <Suspense fallback={<meshStandardMaterial color={w.ground} roughness={1} />}>
              <PlanetSurface w={w} />
            </Suspense>
          ) : (
            <meshStandardMaterial color={w.ground} roughness={1} metalness={0} />
          )}
        </mesh>
      </group>
    </>
  );
}

/** Fly from orbit down through a planet's atmosphere to its surface (or into a giant's clouds). */
export default function Descent({ world, onClose }: { world: World; onClose: () => void }) {
  const [run, setRun] = useState(0);
  const [tick, setTick] = useState<Tick>({ alt: world.radiusKm * 1.6, bar: null, layer: "Space", done: false });
  const onTick = useRef<(t: Tick) => void>(setTick);
  onTick.current = setTick;
  const fail = <div className="grid h-full place-items-center text-sm text-zinc-400">The descent view could not start on this device.</div>;
  return (
    <div className="absolute inset-0 z-30 bg-black">
      <Safe fallback={fail}>
        <Canvas key={run} camera={{ fov: 60, near: 0.05, far: 400000, position: [0, world.radiusKm * 1.6, 0] }} gl={{ antialias: true, logarithmicDepthBuffer: true }}>
          <Flight w={world} onTick={onTick} />
        </Canvas>
      </Safe>
      <div className="pointer-events-none absolute left-5 top-5 w-80 rounded-xl border border-white/15 bg-black/55 p-4 backdrop-blur">
        <div className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">Descending into {world.name}</div>
        <div className="mt-2 font-mono text-2xl text-white">{tick.alt >= 0 ? `${fmt(tick.alt)} km` : `${fmt(-tick.alt)} km below the cloud tops`}</div>
        <div className="mt-1 text-sm text-zinc-300">{tick.layer}</div>
        <div className="mt-1 font-mono text-sm text-zinc-400">
          {tick.bar == null ? "Air pressure: near vacuum" : `Air pressure: ${tick.bar > 1000 ? "over 1,000" : fmt(tick.bar)} bar${world.estimate ? " (estimate)" : ""}`}
        </div>
        {tick.done && (
          <div className="mt-3 border-t border-white/10 pt-3 text-[13px] leading-relaxed text-zinc-200">
            {world.solid && world.tC != null && <div className="mb-1 font-mono text-zinc-300">Surface: {fmt(world.p0Bar ?? 0)} bar, {fmt(world.tC)} °C</div>}
            {world.note}
          </div>
        )}
      </div>
      <div className="absolute right-5 top-5 flex gap-2">
        <button onClick={() => setRun((r) => r + 1)} className="rounded-lg border border-white/20 bg-black/60 px-3 py-1.5 text-sm text-white hover:bg-white/10">Replay</button>
        <button onClick={onClose} className="rounded-lg bg-amber-300 px-3 py-1.5 text-sm font-semibold text-black hover:bg-amber-200">Back to simulation</button>
      </div>
    </div>
  );
}
