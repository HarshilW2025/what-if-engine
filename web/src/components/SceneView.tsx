"use client";

import { useCompact } from "@/lib/useCompact";
import "./scene/nanSafe";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { fmt } from "@/lib/fmt";
import { usePlayer } from "@/lib/store";
import type { Num, SceneBody, SceneCloud, SceneCurve, SceneResult } from "@/lib/types";
import { ZoomButtons, ZoomInput } from "./GravityScene";
import { BlackHoleVisual } from "./scene/blackHole";
import { CompactStar, compactKind } from "./scene/compact";
import { Atmosphere, atmosphereFor } from "./scene/atmosphere";
import { Person, Shuttle, craftFor } from "./scene/craft";
import { Ring, Safe, lookFor, type Look } from "./scene/looks";
import { MAX_STARS, PLANET_FRAG, PLANET_VERT } from "./scene/planetShaders";
import { SKY_FRAG, SKY_VERT, STAR_FRAG, STAR_VERT } from "./scene/shaders";
import { glowTexture, kelvinToColor, ringTexture } from "./scene/visuals";

type Slots<T> = { current: (T | null)[] };
type Controls = {
  target: THREE.Vector3;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
};

const MAX_LABELS = 12;
const EARTH_TEX = ["/textures/earth/day.jpg", "/textures/earth/night.jpg", "/textures/earth/data.jpg"];
const KIND_COLOR: Record<string, string> = {
  planet: "#c79a6b", moon: "#a3a3a3", rock: "#8c7b6b", generic: "#9fb4c8", earth: "#3b6fb6",
  ship: "#d8dde6", particle: "#ffd9a0", light: "#fff6d8", star: "#ffcc80", blackhole: "#000000",
};
const SURFACE_KINDS = new Set(["earth", "planet", "moon", "rock", "generic"]);
const POINTLIKE = new Set(["particle", "light"]);

// ---------- sampling helpers (physics z-up -> three y-up) ----------
export function cursor(F: number, playhead: number) {
  const i = Math.min(Math.max(0, Math.floor(playhead)), F - 1);
  return { i, j: Math.min(i + 1, F - 1), t: Math.min(1, Math.max(0, playhead - i)) };
}
function sampleVec(rows: Num[][] | Num[][][] | undefined, i: number, j: number, t: number, out: THREE.Vector3): boolean {
  if (!rows) return false;
  const a = rows[i] as Num[] | undefined;
  if (!a) return false;
  const [ax, ay, az] = a;
  if (ax == null || ay == null || az == null) return false;
  let x = ax, y = ay, z = az;
  const b = rows[j] as Num[] | undefined;
  if (b && t > 0) {
    const [bx, by, bz] = b;
    if (bx != null && by != null && bz != null) {
      x += (bx - x) * t;
      y += (by - y) * t;
      z += (bz - z) * t;
    }
  }
  out.set(x, z, -y);
  return true;
}
function sampleNum(arr: Num[] | undefined, i: number, j: number, t: number, fb: number): number {
  if (!arr) return fb;
  const a = arr[i];
  if (a == null) return fb;
  const b = arr[j];
  return b == null ? a : a + (b - a) * t;
}
function sampleComp(rows: Num[][] | undefined, i: number, j: number, t: number, k: number, fb: number): number {
  if (!rows) return fb;
  const a = rows[i]?.[k];
  if (a == null) return fb;
  const b = rows[j]?.[k];
  return b == null ? a : a + (b - a) * t;
}
export function sceneTime(res: SceneResult, playhead: number) {
  const { i, j, t } = cursor(res.times.length, playhead);
  return res.times[i] + (res.times[j] - res.times[i]) * t;
}

// ---------- playback: every frame gets equal screen time (the model chose its time sampling) ----------
function Player({ F }: { F: number }) {
  const per = Math.min(25, Math.max(12, F / 12)) / F;
  useFrame((_, delta) => {
    const s = usePlayer.getState();
    if (!s.playing) return;
    const next = s.playhead + (Math.min(delta, 0.1) * s.speed) / per;
    if (next >= F - 1) usePlayer.setState({ playhead: F - 1, playing: false });
    else usePlayer.setState({ playhead: next });
  });
  return null;
}

/** nebula plus stars baked once into a cubemap; also the sky that black holes lens */
function Sky() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const rt = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
    const skyScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(5, 64, 64);
    const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false });
    skyScene.add(new THREE.Mesh(geo, mat));
    const N = 7000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const tint = new THREE.Color();
    for (let k = 0; k < N; k++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * 4;
      pos.set([r * Math.cos(th), u * 4, r * Math.sin(th)], k * 3);
      const m = Math.pow(Math.random(), 4) * 2.2 + 0.25;
      tint.setHSL(Math.random() < 0.7 ? 0.6 : 0.08, 0.35, 0.75).multiplyScalar(m);
      col.set([tint.r, tint.g, tint.b], k * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const sm = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
    skyScene.add(new THREE.Points(sg, sm));
    new THREE.CubeCamera(0.1, 100, rt).update(gl, skyScene);
    geo.dispose();
    mat.dispose();
    sg.dispose();
    sm.dispose();
    scene.background = rt.texture;
    return () => {
      if (scene.background === rt.texture) scene.background = null;
      rt.dispose();
    };
  }, [gl, scene]);
  return null;
}

// ---------- relativistic aberration: the sky as seen from a ship moving near light speed ----------
const LEN_M: Record<string, number> = {
  m: 1, meter: 1, metre: 1, km: 1e3, au: 1.495978707e11, ly: 9.4607e15, "light year": 9.4607e15, "light-year": 9.4607e15,
  pc: 3.0857e16, parsec: 3.0857e16, "earth radius": 6.371e6, "earth radii": 6.371e6, "solar radius": 6.957e8, "solar radii": 6.957e8,
  "light second": 299792458, "light-second": 299792458, ls: 299792458,
};
const TIME_S: Record<string, number> = {
  s: 1, sec: 1, second: 1, ms: 1e-3, min: 60, minute: 60, h: 3600, hr: 3600, hour: 3600, d: 86400, day: 86400, yr: 3.15576e7, y: 3.15576e7, year: 3.15576e7,
};
function unitScale(u: string, table: Record<string, number>): number | null {
  const k = u.trim().toLowerCase();
  if (k in table) return table[k];
  if (k.endsWith("s") && k.slice(0, -1) in table) return table[k.slice(0, -1)];
  return null;
}
const ABER_VERT = `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ABER_FRAG = `
uniform samplerCube uEnv;
uniform vec3 uBeta; // ship velocity / c, world space
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);            // direction a star is SEEN in, from the ship
  float b = length(uBeta);
  vec3 n = uBeta / b;
  float cp = clamp(dot(d, n), -1.0, 1.0);
  float c0 = (cp - b) / (1.0 - b * cp); // where that star really is (aberration undone)
  vec3 perp = d - n * cp;
  float pl = length(perp);
  vec3 src = pl > 1e-5 ? n * c0 + perp / pl * sqrt(max(0.0, 1.0 - c0 * c0)) : n * sign(cp);
  float g = 1.0 / sqrt(1.0 - b * b);
  float D = 1.0 / (g * (1.0 - b * cp)); // Doppler factor: blue ahead, red behind
  vec3 col = textureCube(uEnv, src).rgb;
  vec3 tint = D >= 1.0 ? mix(vec3(1.0), vec3(0.55, 0.75, 1.5), clamp(log2(D) / 3.0, 0.0, 1.0))
                       : mix(vec3(1.0), vec3(1.5, 0.45, 0.2), clamp(-log2(D) / 3.0, 0.0, 1.0));
  gl_FragColor = vec4(col * tint * clamp(pow(D, 3.0), 0.0, 30.0), 1.0); // brightness ~ D^3 (relativistic beaming)
}
`;

/** Only active when the camera follows a ship or particle moving faster than 5% of light speed. */
function AberrationSky({ res }: { res: SceneResult }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const mesh = useRef<THREE.Mesh>(null);
  const a = useMemo(() => new THREE.Vector3(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const autoFocus = res.camera.focus ? res.bodies.findIndex((b) => b.name === res.camera.focus) : -1;
  const cScene = useMemo(() => {
    const L = unitScale(res.length_unit, LEN_M);
    const T = unitScale(res.time_unit, TIME_S);
    return L && T ? (299792458 * T) / L : null;
  }, [res.length_unit, res.time_unit]);
  const mat = useMemo(
    () => new THREE.ShaderMaterial({ uniforms: { uEnv: { value: null }, uBeta: { value: new THREE.Vector3() } }, vertexShader: ABER_VERT, fragmentShader: ABER_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const s = usePlayer.getState();
    const fi = s.focus ?? autoFocus;
    const body = fi >= 0 ? res.bodies[fi] : undefined;
    const bg = scene.background as THREE.Texture | null;
    let on = false;
    if (cScene && bg && s.follow && body && (body.kind === "ship" || body.kind === "particle")) {
      const F = res.times.length;
      const i0 = Math.max(0, Math.min(cursor(F, s.playhead).i, F - 2));
      const dt = res.times[i0 + 1] - res.times[i0];
      if (dt > 0 && sampleVec(body.positions, i0, i0, 0, a) && sampleVec(body.positions, i0 + 1, i0 + 1, 0, v)) {
        v.sub(a).divideScalar(dt * cScene);
        const beta = v.length();
        if (beta > 0.05 && beta < 1) {
          if (beta > 0.99995) v.multiplyScalar(0.99995 / beta);
          mat.uniforms.uBeta.value.copy(v);
          mat.uniforms.uEnv.value = bg;
          on = true;
        }
      }
    }
    m.visible = on;
    if (on) {
      m.position.copy(camera.position);
      m.scale.setScalar((camera as THREE.PerspectiveCamera).far * 0.4);
    }
  });

  return (
    <mesh ref={mesh} material={mat} renderOrder={-2} frustumCulled={false} visible={false}>
      <sphereGeometry args={[1, 64, 32]} />
    </mesh>
  );
}

// ---------- bodies ----------
type PlanetProps = { res: SceneResult; index: number; slots: Slots<THREE.Group>; starIdx: number[]; meshRef: RefObject<THREE.Mesh | null> };

function PlanetBody({ res, index, slots, starIdx, meshRef, textures, children }: PlanetProps & { textures: THREE.Texture[] | null; children?: ReactNode }) {
  const b = res.bodies[index];
  const F = res.times.length;
  const atmo = useMemo(
    () => atmosphereFor(b.name, b.kind === "earth" ? "earth" : b.kind === "planet" ? "rocky" : "none", b.color, b.temperature?.find((x) => x != null)),
    [b],
  );
  const kind = textures ? (textures.length === 1 ? 3 : 0) : 1; // 0 Earth maps, 3 real imagery, 1 procedural
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uKind: { value: kind },
          uColor: { value: new THREE.Color(b.color ?? KIND_COLOR[b.kind] ?? "#aaaaaa") },
          uDay: { value: textures?.[0] ?? null },
          uNight: { value: textures?.[1] ?? null },
          uData: { value: textures?.[2] ?? null },
          uStarDir: { value: Array.from({ length: MAX_STARS }, () => new THREE.Vector3()) },
          uStarCol: { value: Array.from({ length: MAX_STARS }, () => new THREE.Color()) },
          uStarFlux: { value: new Array<number>(MAX_STARS).fill(0) },
          uStarCount: { value: 0 },
          uTemp: { value: 288 },
          uTime: { value: 0 },
          uCam: { value: new THREE.Vector3() },
        },
        vertexShader: PLANET_VERT,
        fragmentShader: PLANET_FRAG,
      }),
    [kind, textures, b.color, b.kind],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const self = slots.current[index];
    if (!self) return;
    const u = mat.uniforms;
    let k = 0;
    for (const si of starIdx) {
      const g = slots.current[si];
      if (!g || !g.visible || k >= MAX_STARS) continue;
      tmp.copy(g.position).sub(self.position);
      if (tmp.lengthSq() === 0) continue;
      u.uStarDir.value[k].copy(tmp.normalize());
      u.uStarCol.value[k].set(1, 0.97, 0.92);
      u.uStarFlux.value[k] = 3;
      k++;
    }
    if (k === 0) {
      // no star in the scene: soft light from the viewer's side, so no invisible Sun makes a day and night side
      tmp.copy(state.camera.position).sub(self.position).normalize();
      tmp.y += 0.25;
      u.uStarDir.value[0].copy(tmp.normalize());
      u.uStarCol.value[0].set(1, 1, 1);
      u.uStarFlux.value[0] = 1.2;
      k = 1;
    }
    u.uStarCount.value = k;
    const { i, j, t } = cursor(F, usePlayer.getState().playhead);
    u.uTemp.value = sampleNum(b.temperature, i, j, t, 288);
    u.uTime.value = state.clock.elapsedTime;
    u.uCam.value.copy(state.camera.position);
  });

  return (
    <mesh ref={meshRef} material={mat}>
      <sphereGeometry args={[1, 96, 64]} />
      {atmo && (
        <Safe fallback={null}>
          <Atmosphere spec={atmo} />
        </Safe>
      )}
      {children}
    </mesh>
  );
}

function EarthBody(props: PlanetProps) {
  const gl = useThree((s) => s.gl);
  const tex = useLoader(THREE.TextureLoader, EARTH_TEX);
  useMemo(() => {
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    tex.forEach((t, i) => {
      t.anisotropy = aniso;
      t.wrapS = THREE.RepeatWrapping;
      t.colorSpace = i < 2 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
    });
  }, [gl, tex]);
  return <PlanetBody {...props} textures={tex} />;
}

/** a real body with its NASA-based map (and rings), falling back to the procedural surface */
function MappedBody({ look, ...props }: PlanetProps & { look: Look }) {
  const gl = useThree((s) => s.gl);
  const tex = useLoader(THREE.TextureLoader, look.map);
  useMemo(() => {
    tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
  }, [gl, tex]);
  return (
    <PlanetBody {...props} textures={[tex]}>
      {look.ring && (
        <Safe fallback={null}>
          <Suspense fallback={null}>
            <Ring {...look.ring} />
          </Suspense>
        </Safe>
      )}
    </PlanetBody>
  );
}

function BodyView({ res, index, slots, starIdx }: { res: SceneResult; index: number; slots: Slots<THREE.Group>; starIdx: number[] }) {
  const b: SceneBody = res.bodies[index];
  const F = res.times.length;
  const group = useRef<THREE.Group | null>(null);
  const mesh = useRef<THREE.Mesh | null>(null);
  const halo = useRef<THREE.Sprite>(null);
  const bh = useRef<THREE.Group | null>(null);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);
  const minAngular = POINTLIKE.has(b.kind) || b.kind === "ship" ? 0.006 : 0.003;
  const look = useMemo(() => lookFor(b.name), [b.name]);
  const craft = useMemo(() => craftFor(b.name, b.kind), [b.name, b.kind]);
  const compact = ["star", "generic", "particle", "planet", "rock"].includes(b.kind) ? compactKind(b.name) : null;

  const starColor = useMemo(() => {
    const T = b.temperature?.find((x) => x != null) ?? 5778;
    return kelvinToColor(T).lerp(new THREE.Color(b.color ?? "#ffffff"), b.color ? 0.25 : 0);
  }, [b]);
  const starMat = useMemo(
    () => (b.kind === "star" ? new THREE.ShaderMaterial({ uniforms: { uColor: { value: starColor }, uTime: { value: 0 } }, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG }) : null),
    [b.kind, starColor],
  );
  const haloMat = useMemo(() => {
    if (compact) return null; // compact stars draw their own glow
    const base = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false } as const;
    if (b.kind === "star") return new THREE.SpriteMaterial({ ...base, map: glowTexture(), color: starColor.clone().multiplyScalar(1.6) });
    if (b.kind === "light") return new THREE.SpriteMaterial({ ...base, map: glowTexture(), color: new THREE.Color(b.color ?? "#fff6d8").multiplyScalar(3) });
    if (b.kind === "particle") return new THREE.SpriteMaterial({ ...base, map: glowTexture(), color: new THREE.Color(b.color ?? KIND_COLOR.particle).multiplyScalar(2) });
    if (b.kind === "ship" && craft !== "person") return new THREE.SpriteMaterial({ ...base, map: glowTexture(), color: new THREE.Color(0.6, 1.2, 3) });
    return null;
  }, [b.kind, b.color, starColor, compact, craft]);
  const haloMul = b.kind === "star" ? 5 : b.kind === "blackhole" ? 3.2 : b.kind === "ship" ? 1.2 : 4;

  useEffect(
    () => () => {
      starMat?.dispose();
      haloMat?.dispose();
    },
    [starMat, haloMat],
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const { i, j, t } = cursor(F, usePlayer.getState().playhead);
    if (!sampleVec(b.positions, i, j, t, pos)) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.copy(pos);
    const r = sampleNum(b.radius, i, j, t, 0);
    const s = Math.max(r, state.camera.position.distanceTo(pos) * minAngular);
    const sx = sampleComp(b.scale, i, j, t, 0, 1);
    const sy = sampleComp(b.scale, i, j, t, 1, 1);
    const sz = sampleComp(b.scale, i, j, t, 2, 1);
    if (mesh.current) {
      mesh.current.scale.set(s * sx, s * sz, s * sy);
      const now = res.times[i] + (res.times[j] - res.times[i]) * t;
      const spinsFast = (compact === "pulsar" || compact === "magnetar") && (b.spin === 0 || Math.abs(b.spin) * ((res.times[F - 1] - res.times[0]) / Math.max(1, F - 1)) > 0.6);
      mesh.current.rotation.y = spinsFast ? state.clock.elapsedTime * 3 : b.spin * now; // too fast to show: illustrative rate
    }
    if (starMat) starMat.uniforms.uTime.value = state.clock.elapsedTime;
    if (halo.current) halo.current.scale.setScalar(s * haloMul);
    if (bh.current) bh.current.scale.setScalar(s);
    if (b.kind === "ship" && sampleVec(b.positions, j, Math.min(j + 1, F - 1), 0, ahead) && ahead.distanceToSquared(pos) > 0) g.lookAt(ahead);
  });

  const surfaceProps: PlanetProps = { res, index, slots, starIdx, meshRef: mesh };

  return (
    <group
      ref={(g) => {
        group.current = g;
        slots.current[index] = g;
      }}
      onClick={(e) => {
        if (e.delta > 6) return;
        e.stopPropagation();
        usePlayer.getState().setFocus(index);
      }}
    >
      {b.kind === "star" && starMat && !compact && (
        <mesh ref={mesh} material={starMat}>
          <sphereGeometry args={[1, 64, 64]} />
        </mesh>
      )}
      {compact && <CompactStar kind={compact} meshRef={mesh} temperature={b.temperature?.find((x) => x != null) ?? undefined} />}
      {b.kind === "blackhole" && <BlackHoleVisual groupRef={bh} disk={!!b.disk} />}
      {craft && (
        <mesh ref={mesh} rotation={[Math.PI / 2, 0, 0]}>
          {craft === "person" ? <Person /> : <Shuttle />}
        </mesh>
      )}
      {b.kind === "earth" && (
        <Suspense fallback={<PlanetBody {...surfaceProps} textures={null} />}>
          <EarthBody {...surfaceProps} />
        </Suspense>
      )}
      {SURFACE_KINDS.has(b.kind) && b.kind !== "earth" && !compact && !craft &&
        (look ? (
          <Safe fallback={<PlanetBody {...surfaceProps} textures={null} />}>
            <Suspense fallback={<PlanetBody {...surfaceProps} textures={null} />}>
              <MappedBody {...surfaceProps} look={look} />
            </Suspense>
          </Safe>
        ) : (
          <PlanetBody {...surfaceProps} textures={null} />
        ))}
      {haloMat && <sprite ref={halo} material={haloMat} />}
    </group>
  );
}

// ---------- clouds and curves ----------
const LUT_N = 96;
const T_LO = 500;
const T_HI = 40000;
let LUT: THREE.Color[] | null = null;
/** blackbody colour plus glow strength for a temperature, from a small lookup table */
function tempColor(T: number, out: THREE.Color) {
  if (!LUT) LUT = Array.from({ length: LUT_N }, (_, k) => kelvinToColor(Math.max(1000, T_LO * Math.pow(T_HI / T_LO, k / (LUT_N - 1)))).clone());
  const x = Math.log(Math.min(T_HI, Math.max(T_LO, T)) / T_LO) / Math.log(T_HI / T_LO);
  const glow = T > 800 ? 1 + Math.min(3, (T - 800) / 1200) : 0.5;
  return out.copy(LUT[Math.round(x * (LUT_N - 1))]).multiplyScalar(glow);
}

function CloudView({ res, cloud, slot, geoms }: { res: SceneResult; cloud: SceneCloud; slot: number; geoms: Slots<THREE.BufferGeometry> }) {
  const F = res.times.length;
  const N = cloud.points[0]?.length ?? 0;
  const each = !!cloud.temperature_each;
  const { points, geo, mat } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    if (each) geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const mat = new THREE.PointsMaterial({
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      sizeAttenuation: true,
      vertexColors: each,
      color: each ? new THREE.Color(1, 1, 1) : new THREE.Color(cloud.color ?? "#ffb070"),
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return { points, geo, mat };
  }, [N, cloud.color, each]);
  useEffect(() => {
    geoms.current[slot] = geo;
    return () => {
      geoms.current[slot] = null;
      geo.dispose();
      mat.dispose();
    };
  }, [geo, mat, geoms, slot]);
  const base = useMemo(() => new THREE.Color(cloud.color ?? "#ffb070"), [cloud.color]);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const { i, j, t } = cursor(F, usePlayer.getState().playhead);
    const arr = geo.attributes.position.array as Float32Array;
    const A = cloud.points[i];
    const B = cloud.points[j];
    for (let k = 0; k < N; k++) {
      const a = A[k];
      const b = B?.[k];
      const ax = a?.[0], ay = a?.[1], az = a?.[2];
      if (ax == null || ay == null || az == null) {
        arr[k * 3] = arr[k * 3 + 1] = arr[k * 3 + 2] = NaN;
        continue;
      }
      let x = ax, y = ay, z = az;
      const bx = b?.[0], by = b?.[1], bz = b?.[2];
      if (t > 0 && bx != null && by != null && bz != null) {
        x += (bx - x) * t;
        y += (by - y) * t;
        z += (bz - z) * t;
      }
      arr[k * 3] = x;
      arr[k * 3 + 1] = z;
      arr[k * 3 + 2] = -y;
    }
    geo.attributes.position.needsUpdate = true;

    if (each && cloud.temperature_each) {
      const carr = geo.attributes.color.array as Float32Array;
      const TA = cloud.temperature_each[i];
      const TB = cloud.temperature_each[j];
      for (let k = 0; k < N; k++) {
        const ta = TA?.[k];
        const tb = TB?.[k];
        const T = ta == null ? 300 : tb == null ? ta : ta + (tb - ta) * t;
        tempColor(T, col);
        carr[k * 3] = col.r;
        carr[k * 3 + 1] = col.g;
        carr[k * 3 + 2] = col.b;
      }
      geo.attributes.color.needsUpdate = true;
    } else {
      const T = sampleNum(cloud.temperature, i, j, t, NaN);
      if (Number.isFinite(T)) tempColor(T, mat.color);
      else mat.color.copy(base);
    }
    const controls = state.controls as unknown as Controls | null;
    const d = controls ? state.camera.position.distanceTo(controls.target) : state.camera.position.length();
    mat.size = cloud.size * d * 0.012;
  });

  return <primitive object={points} />;
}

function CurveView({ res, curve }: { res: SceneResult; curve: SceneCurve }) {
  const F = res.times.length;
  const P = curve.static ? (curve.points as Num[][]).length : ((curve.points as Num[][][])[0]?.length ?? 0);
  const { line, geo, mat } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(P * 3);
    if (curve.static) {
      (curve.points as Num[][]).forEach((p, k) => {
        arr[k * 3] = p[0] ?? NaN;
        arr[k * 3 + 1] = p[2] ?? NaN;
        arr[k * 3 + 2] = p[1] == null ? NaN : -p[1];
      });
    }
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(curve.color ?? "#7dd3fc").multiplyScalar(1.4), transparent: true, opacity: 0.9, toneMapped: false });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    return { line, geo, mat };
  }, [P, curve]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame(() => {
    if (curve.static) return;
    const { i, j, t } = cursor(F, usePlayer.getState().playhead);
    const pts = curve.points as Num[][][];
    const arr = geo.attributes.position.array as Float32Array;
    for (let k = 0; k < P; k++) {
      const a = pts[i]?.[k];
      const b = pts[j]?.[k];
      const ax = a?.[0], ay = a?.[1], az = a?.[2];
      if (ax == null || ay == null || az == null) {
        arr[k * 3] = arr[k * 3 + 1] = arr[k * 3 + 2] = NaN;
        continue;
      }
      let x = ax, y = ay, z = az;
      const bx = b?.[0], by = b?.[1], bz = b?.[2];
      if (t > 0 && bx != null && by != null && bz != null) {
        x += (bx - x) * t;
        y += (by - y) * t;
        z += (bz - z) * t;
      }
      arr[k * 3] = x;
      arr[k * 3 + 1] = z;
      arr[k * 3 + 2] = -y;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return <primitive object={line} />;
}

// ---------- camera: frames the focus body (or everything) and the debris around it ----------
const SAMPLE_N = 1500; // particles sampled per frame to frame the debris; plenty, and cheap
function SceneCamera({ res, slots, geoms }: { res: SceneResult; slots: Slots<THREE.Group>; geoms: Slots<THREE.BufferGeometry> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const F = res.times.length;
  const interacting = useRef(false);
  const started = useRef(false);
  const lastZoom = useRef(usePlayer.getState().zoom);
  const target = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const before = useMemo(() => new THREE.Vector3(), []);
  const dbuf = useMemo(() => new Float32Array(SAMPLE_N), []); // reused every frame: no allocation, no GC stutter
  const autoFocus = res.camera.focus ? res.bodies.findIndex((b) => b.name === res.camera.focus) : -1;
  const viewDir = useMemo(() => {
    const v = res.camera.view === "top" ? new THREE.Vector3(0.001, 1, 0.08) : res.camera.view === "side" ? new THREE.Vector3(0, 0.12, 1) : new THREE.Vector3(0.55, 0.45, 1);
    return v.normalize();
  }, [res.camera.view]);

  useEffect(() => {
    if (!controls) return;
    const on = () => (interacting.current = true);
    const off = () => (interacting.current = false);
    controls.addEventListener("start", on);
    controls.addEventListener("end", off);
    return () => {
      controls.removeEventListener("start", on);
      controls.removeEventListener("end", off);
    };
  }, [controls]);

  useFrame((_, delta) => {
    if (!controls) return;
    const s = usePlayer.getState();
    const { i, j, t } = cursor(F, s.playhead);

    if (s.zoom !== lastZoom.current) {
      if (!s.follow) {
        tmp.copy(camera.position).sub(controls.target).multiplyScalar(s.zoom / lastZoom.current);
        camera.position.copy(controls.target).add(tmp);
      }
      lastZoom.current = s.zoom;
    }

    if (s.follow || !started.current) {
      const fi = s.focus ?? autoFocus;
      const fg = fi >= 0 ? slots.current[fi] : null;
      const locked = !!fg && fg.visible;
      if (locked) target.copy(fg!.position);
      else {
        let n = 0;
        target.set(0, 0, 0);
        slots.current.forEach((g) => {
          if (g && g.visible) {
            target.add(g.position);
            n++;
          }
        });
        if (n) target.divideScalar(n);
      }

      let r = 0;
      slots.current.forEach((g, k) => {
        if (!g || !g.visible) return;
        r = Math.max(r, g.position.distanceTo(target) + sampleNum(res.bodies[k]?.radius, i, j, t, 0) * 1.3);
      });
      for (const geo of geoms.current) {
        if (!geo) continue;
        const arr = geo.attributes.position.array as Float32Array;
        const n = arr.length / 3;
        const step = Math.max(1, Math.floor(n / SAMPLE_N));
        let m = 0;
        for (let k = 0; k < n && m < SAMPLE_N; k += step) {
          const x = arr[k * 3] - target.x, y = arr[k * 3 + 1] - target.y, z = arr[k * 3 + 2] - target.z;
          const dd = Math.sqrt(x * x + y * y + z * z);
          if (Number.isFinite(dd)) dbuf[m++] = dd;
        }
        if (m) {
          const sorted = dbuf.subarray(0, m).sort();
          r = Math.max(r, sorted[Math.floor(m * 0.85)]);
        }
      }
      if (locked && fi >= 0) {
        const fr = sampleNum(res.bodies[fi].radius, i, j, t, 0);
        if (fr > 0) r = s.focus != null ? fr * 1.6 : Math.min(Math.max(r, fr * 2.5), fr * 60); // a chip click frames that body; the model's own focus keeps context
      }
      if (!(r > 0)) r = 1;
      const want = r * 2.4 * s.zoom;

      if (!started.current) {
        controls.target.copy(target);
        camera.position.copy(target).addScaledVector(viewDir, want);
        started.current = true;
      } else {
        const k = 1 - Math.exp(-Math.min(delta, 0.1) * 2.5);
        before.copy(controls.target);
        controls.target.lerp(target, locked ? Math.max(k, 0.5) : k);
        camera.position.add(tmp.subVectors(controls.target, before));
        if (!interacting.current) {
          tmp.copy(camera.position).sub(controls.target);
          const cur = tmp.length() || 1;
          tmp.multiplyScalar((cur + (want - cur) * k) / cur);
          camera.position.copy(controls.target).add(tmp);
        }
      }
    }
    const d = camera.position.distanceTo(controls.target);
    camera.near = Math.max(d / 2000, 1e-12);
    camera.far = d * 2000;
    camera.updateProjectionMatrix();
  });
  return null;
}

function Labels({ res, groups, tags }: { res: SceneResult; groups: Slots<THREE.Group>; tags: Slots<HTMLSpanElement> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    for (let k = 0; k < tags.current.length; k++) {
      const el = tags.current[k];
      if (!el) continue;
      const g = groups.current[k];
      if (!g || !g.visible) {
        el.style.display = "none";
        continue;
      }
      v.copy(g.position).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "block";
      el.style.transform = `translate(${((v.x * 0.5 + 0.5) * size.width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * size.height).toFixed(1)}px) translate(-50%, -160%)`;
    }
  });
  return null;
}

// ---------- DOM overlays ----------
function CaptionBar({ res }: { res: SceneResult }) {
  const playhead = usePlayer((s) => s.playhead);
  const compact = useCompact();
  const now = sceneTime(res, playhead);
  let cap: { t: number; text: string } | null = null;
  for (const c of res.captions) if (c.t <= now + 1e-12 * Math.max(1, Math.abs(now))) cap = c;
  if (!cap) return null;
  return (
    <div style={{ position: "absolute", left: "50%", bottom: compact ? 60 : 24, transform: "translateX(-50%)", maxWidth: compact ? "94%" : "78%", width: compact ? "max-content" : undefined }}>
      <div key={cap.text} className={`rounded-lg border border-white/10 bg-black/65 text-center font-medium leading-snug text-white backdrop-blur ${compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-[15px]"}`}>
        {cap.text}
      </div>
    </div>
  );
}

function Spark({ s, i }: { s: SceneResult["series"][number]; i: number }) {
  const { path, cx, cy } = useMemo(() => {
    const vals = s.values.map((v) => (v == null || !Number.isFinite(v) ? null : v));
    const fin = vals.filter((v): v is number => v != null);
    const pos = fin.length > 0 && fin.every((v) => v > 0);
    const lo = Math.min(...fin), hi = Math.max(...fin);
    const useLog = pos && hi / lo > 1e3;
    const tr = (v: number) => (useLog ? Math.log10(v) : v);
    const a = fin.length ? tr(lo) : 0, b = fin.length ? tr(hi) : 1;
    const span = b - a || 1;
    const n = vals.length;
    const X = (k: number) => (n > 1 ? (k / (n - 1)) * 196 + 2 : 100);
    const Y = (v: number) => 36 - ((tr(v) - a) / span) * 32;
    let d = "";
    vals.forEach((v, k) => {
      if (v == null) return;
      d += `${d ? "L" : "M"}${X(k).toFixed(1)},${Y(v).toFixed(1)}`;
    });
    const cur = vals[i];
    return { path: d, cx: X(i), cy: cur == null ? null : Y(cur) };
  }, [s, i]);
  const v = s.values[i];
  return (
    <div className="rounded-md border border-white/10 bg-black/55 px-2.5 py-1.5 backdrop-blur">
      <div className="flex justify-between gap-2 text-[10px] text-zinc-400">
        <span className="truncate">{s.name}</span>
        <span className="shrink-0 font-mono text-zinc-100">
          {fmt(v)} {s.unit}
        </span>
      </div>
      <svg viewBox="0 0 200 40" className="mt-1 h-8 w-full">
        <path d={path} fill="none" stroke="rgb(252 211 77 / 0.8)" strokeWidth="1.5" />
        {cy != null && <circle cx={cx} cy={cy} r="3" fill="#fde68a" />}
      </svg>
    </div>
  );
}

function SeriesPanel({ res }: { res: SceneResult }) {
  const playhead = usePlayer((s) => s.playhead);
  const compact = useCompact();
  if (!res.series.length || compact) return null; // phones: the numbers are in the panel below
  const { i } = cursor(res.times.length, Math.round(playhead));
  return (
    <div style={{ position: "absolute", right: 12, top: 12, width: 288, maxHeight: "calc(100% - 200px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
      {res.series.slice(0, 4).map((s) => (
        <Spark key={s.name} s={s} i={i} />
      ))}
    </div>
  );
}

function ViewChips({ res }: { res: SceneResult }) {
  const focus = usePlayer((s) => s.focus);
  const setFocus = usePlayer((s) => s.setFocus);
  const compact = useCompact();
  const items = [{ id: null as number | null, name: "All" }, ...res.bodies.map((b, k) => ({ id: k as number | null, name: b.name, kind: b.kind })).filter((x) => !("kind" in x) || !POINTLIKE.has(x.kind as string)).slice(0, MAX_LABELS)];
  return (
    <div style={{ position: "absolute", left: compact ? 8 : 12, top: compact ? 8 : 12, display: "flex", flexWrap: compact ? "nowrap" : "wrap", overflowX: compact ? "auto" : undefined, gap: 6, maxWidth: compact ? "calc(100% - 16px)" : "calc(100% - 330px)" }}>
      {items.map((it) => (
        <button
          key={it.id ?? "all"}
          onClick={() => setFocus(it.id)}
          className={`shrink-0 whitespace-nowrap rounded-lg border backdrop-blur ${compact ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm"} ${focus === it.id ? "border-white/40 bg-white/15 text-white" : "border-white/10 bg-black/40 text-white/60 hover:text-white"}`}
        >
          {it.name}
        </button>
      ))}
    </div>
  );
}

export default function SceneView({ res }: { res: SceneResult }) {
  const follow = usePlayer((s) => s.follow);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const geoms = useRef<(THREE.BufferGeometry | null)[]>([]);
  const tags = useRef<(HTMLSpanElement | null)[]>([]);
  const starIdx = useMemo(() => res.bodies.map((b, k) => (b.kind === "star" && !compactKind(b.name) ? k : -1)).filter((k) => k >= 0), [res]);
  const labelled = res.bodies.map((b, k) => ({ b, k })).filter(({ b }) => !POINTLIKE.has(b.kind)).slice(0, MAX_LABELS);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const s = usePlayer.getState();
      if (e.key === "=" || e.key === "+") s.zoomBy(1 / 1.5);
      else if (e.key === "-" || e.key === "_") s.zoomBy(1.5);
      else if (e.key === "f" || e.key === "F" || e.key === "0" || e.key === "Escape") s.fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas camera={{ position: [0, 1, 3], fov: 50, near: 0.001, far: 1e6 }} dpr={[1, 1.5]} gl={{ antialias: false, powerPreference: "high-performance" }}>
        <Sky />
        <AberrationSky res={res} />
        <Player F={res.times.length} />
        {res.bodies.map((b, k) => (
          <BodyView key={`${k}-${b.name}`} res={res} index={k} slots={groups} starIdx={starIdx} />
        ))}
        {res.clouds.map((c, k) => (
          <CloudView key={`c${k}`} res={res} cloud={c} slot={k} geoms={geoms} />
        ))}
        {res.curves.map((c, k) => (
          <CurveView key={`l${k}`} res={res} curve={c} />
        ))}
        <OrbitControls makeDefault enableDamping enableZoom={!follow} />
        <SceneCamera res={res} slots={groups} geoms={geoms} />
        <ZoomInput />
        <Labels res={res} groups={groups} tags={tags} />
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={1} intensity={1.6} radius={0.75} />
          <Vignette eskil={false} offset={0.25} darkness={0.7} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>

      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {labelled.map(({ b, k }) => (
          <span
            key={k}
            ref={(el) => {
              tags.current[k] = el;
            }}
            style={{ position: "absolute", left: 0, top: 0, display: "none" }}
            className="select-none whitespace-nowrap text-[13px] font-medium text-white/85 [text-shadow:0_0_6px_rgba(0,0,0,0.9)]"
          >
            {b.name}
          </span>
        ))}
      </div>
      <ViewChips res={res} />
      <SeriesPanel res={res} />
      <CaptionBar res={res} />
      <ZoomButtons />
    </div>
  );
}
