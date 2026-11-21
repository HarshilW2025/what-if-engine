"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { frameDurations } from "@/lib/pacing";
import { usePlayer } from "@/lib/store";
import type { BodyInfo, GravityResult, MergeEvent, Vec3 } from "@/lib/types";
import { BlackHoleVisual } from "./scene/blackHole";
import { CompactStar, compactKind } from "./scene/compact";
import { Atmosphere, atmosphereFor } from "./scene/atmosphere";
import { Ring, Safe, lookFor, type Look } from "./scene/looks";
import { MAX_STARS, PLANET_FRAG, PLANET_VERT } from "./scene/planetShaders";
import { SKY_FRAG, SKY_VERT, STAR_FRAG, STAR_VERT, TRAIL_FRAG, TRAIL_VERT } from "./scene/shaders";
import { glowTexture, kelvinToColor, ringTexture, starTemperature } from "./scene/visuals";

const MAX_LABELS = 12;
const M_EARTH = 3.003e-6; // solar masses
const EARTH_TEX = ["/textures/earth/day.jpg", "/textures/earth/night.jpg", "/textures/earth/data.jpg"];

type Controls = {
  target: THREE.Vector3;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
};
type Slots<T> = { current: (T | null)[] };
type Temps = { current: number[] };
type StarRef = { id: number; lum: number; color: THREE.Color };
type Kind = 0 | 1 | 2 | 3; // 3 = real imagery

const isBlackHole = (b: BodyInfo) => /black\s*hole/i.test(b.name);
const isStar = (b: BodyInfo) => b.mass_msun >= 0.08 && !isBlackHole(b) && !compactKind(b.name); // compact stars are dim in visible light
/** main sequence mass to luminosity, solar units */
const luminosity = (m: number) => (m >= 0.43 ? Math.pow(m, 3.5) : 0.23 * Math.pow(m, 2.3));
const planetKind = (b: BodyInfo): Kind => (/earth/i.test(b.name) ? 0 : b.mass_msun < 10 * M_EARTH ? 1 : 2);
const baseSizeOf = (b: BodyInfo, E0: number) => (isStar(b) ? E0 * 0.035 * Math.pow(b.mass_msun, 0.3) : E0 * 0.015);
function bodyColor(b: BodyInfo) {
  const c = new THREE.Color(b.color);
  return isStar(b) ? kelvinToColor(starTemperature(b.mass_msun)).lerp(c, 0.25) : c;
}

/** physics is z-up with orbits in the x-y plane; three.js is y-up */
function toScene(p: Vec3): [number, number, number] {
  return [p[0], p[2], -p[1]];
}

function extentOf(res: GravityResult): number {
  let m = 0;
  for (const p of res.positions[0]) if (p) m = Math.max(m, Math.hypot(p[0], p[1], p[2]));
  return m || 1;
}

function frameAt(res: GravityResult, playhead: number) {
  const last = res.positions.length - 1;
  const i = Math.min(Math.floor(playhead), last);
  return { i, t: playhead - i, last };
}

/** advances the playhead using per-frame screen time */
function Player({ durations }: { durations: Float32Array }) {
  useFrame((_, delta) => {
    const s = usePlayer.getState();
    if (!s.playing) return;
    const n = durations.length;
    const i = Math.min(Math.floor(s.playhead), n - 1);
    const next = s.playhead + (Math.min(delta, 0.1) * s.speed) / durations[i];
    if (next >= n - 1) usePlayer.setState({ playhead: n - 1, playing: false });
    else usePlayer.setState({ playhead: next });
  });
  return null;
}

/** starfield drawn as fixed size pixels, so it looks the same at any scale (Earth and Moon or a whole galaxy) */
function StarPoints() {
  const pts = useMemo(() => {
    const n = 6000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([100 * r * Math.cos(th), 100 * u, 100 * r * Math.sin(th)], i * 3);
      const b = 0.3 + 0.6 * Math.pow(Math.random(), 3);
      col.set([b, b, b * 1.05], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
    return new THREE.Points(geo, mat);
  }, []);
  useEffect(
    () => () => {
      pts.geometry.dispose();
      (pts.material as THREE.Material).dispose();
    },
    [pts],
  );
  return <primitive object={pts} />;
}

/** nebula rendered once into a cubemap background; only the star points move with the camera */
function Sky() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const stars = useRef<THREE.Group>(null);

  useEffect(() => {
    const rt = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
    const skyScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(5, 64, 64);
    const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false });
    skyScene.add(new THREE.Mesh(geo, mat));
    new THREE.CubeCamera(0.1, 100, rt).update(gl, skyScene);
    geo.dispose();
    mat.dispose();
    scene.background = rt.texture;
    return () => {
      if (scene.background === rt.texture) scene.background = null;
      rt.dispose();
    };
  }, [gl, scene]);

  useFrame(() => {
    const g = stars.current;
    if (!g) return;
    g.position.copy(camera.position);
    const d = controls ? camera.position.distanceTo(controls.target) : camera.position.length();
    g.scale.setScalar(Math.max(d, 1e-6) * 1.5);
  });

  return (
    <group ref={stars}>
      <StarPoints />
    </group>
  );
}

/** follow mode: frames the whole system, or locks onto the focused body; the user's zoom scales the distance */
function CameraRig({ res, E0, slots }: { res: GravityResult; E0: number; slots: Slots<THREE.Group> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const interacting = useRef(false);
  const lastZoom = useRef(usePlayer.getState().zoom);
  const lastFocus = useRef<number | null>(null);
  const focusSince = useRef(0);
  const center = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const before = useMemo(() => new THREE.Vector3(), []);

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

  useFrame((state, delta) => {
    if (!controls) return;
    const s = usePlayer.getState();
    const dt = Math.min(delta, 0.1);

    if (s.zoom !== lastZoom.current) {
      if (!s.follow) {
        tmp.copy(camera.position).sub(controls.target).multiplyScalar(s.zoom / lastZoom.current);
        camera.position.copy(controls.target).add(tmp);
      }
      lastZoom.current = s.zoom;
    }
    if (s.focus !== lastFocus.current) {
      lastFocus.current = s.focus;
      focusSince.current = state.clock.elapsedTime;
    }

    if (s.follow) {
      const fg = s.focus !== null ? slots.current[s.focus] : null;
      const locked = !!fg && fg.visible;
      let want = 0;
      let has = false;
      if (locked && s.focus !== null) {
        center.copy(fg!.position);
        want = ((fg!.userData.size as number | undefined) ?? baseSizeOf(res.bodies[s.focus], E0)) * 7 * s.zoom;
        has = true;
      } else {
        const { i } = frameAt(res, Math.round(s.playhead));
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        const pts: [number, number, number][] = [];
        for (const p of res.positions[i]) {
          if (!p) continue;
          const q = toScene(p);
          pts.push(q);
          minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
          minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
          minZ = Math.min(minZ, q[2]); maxZ = Math.max(maxZ, q[2]);
        }
        if (pts.length) {
          center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
          let r = E0 * 0.5;
          for (const q of pts) r = Math.max(r, Math.hypot(q[0] - center.x, q[1] - center.y, q[2] - center.z));
          want = r * 2.8 * s.zoom;
          has = true;
        }
      }
      if (has) {
        const k = 1 - Math.exp(-dt * 2.5);
        const ramp = Math.min(1, (state.clock.elapsedTime - focusSince.current) / 1.2);
        const kt = locked ? Math.max(k, ramp * ramp) : k;
        // move target and camera together so dragging still orbits a moving body
        before.copy(controls.target);
        controls.target.lerp(center, kt);
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
    camera.near = Math.max(d / 1000, 1e-9);
    camera.far = d * 1000;
    camera.updateProjectionMatrix();
  });
  return null;
}

/** mouse wheel / trackpad pinch drives our zoom while follow is on (OrbitControls handles it otherwise) */
export function ZoomInput() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      const s = usePlayer.getState();
      if (!s.follow) return;
      e.preventDefault();
      s.zoomBy(Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl]);
  return null;
}

/** plain DOM labels placed at each body's screen position; planets show their computed temperature */
function Labels({ res, groups, tags, temps }: { res: GravityResult; groups: Slots<THREE.Group>; tags: Slots<HTMLSpanElement>; temps: Temps }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const shown = useRef<string[]>([]);
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
      const b = res.bodies[k];
      const T = temps.current[k];
      const txt = !isStar(b) && Number.isFinite(T) ? `${b.name}  ${Math.round(T)} K` : b.name;
      if (shown.current[k] !== txt) {
        el.textContent = txt;
        shown.current[k] = txt;
      }
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.display = "block";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -160%)`;
    }
  });
  return null;
}

type SurfaceProps = {
  info: BodyInfo;
  kind: Kind;
  stars: StarRef[];
  slots: Slots<THREE.Group>;
  temps: Temps;
  meshRef: RefObject<THREE.Mesh | null>;
};

/** planet surface lit by the simulation's own stars; temperature is computed from their flux */
function PlanetSurface({ info, kind, stars, slots, temps, meshRef, textures, children }: SurfaceProps & { textures: THREE.Texture[] | null; children?: ReactNode }) {
  const atmo = useMemo(
    () => atmosphereFor(info.name, kind === 0 ? "earth" : kind === 2 ? "gas" : info.mass_msun < 0.05 * M_EARTH ? "none" : "rocky", info.color),
    [info, kind],
  );
  const effKind: Kind = (kind === 0 || kind === 3) && !textures ? 1 : kind;
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uKind: { value: effKind },
          uColor: { value: new THREE.Color(info.color) },
          uDay: { value: textures?.[0] ?? null },
          uNight: { value: textures?.[1] ?? null },
          uData: { value: textures?.[2] ?? null },
          uStarDir: { value: Array.from({ length: MAX_STARS }, () => new THREE.Vector3()) },
          uStarCol: { value: Array.from({ length: MAX_STARS }, () => new THREE.Color()) },
          uStarFlux: { value: new Array<number>(MAX_STARS).fill(0) },
          uStarCount: { value: 0 },
          uTemp: { value: 280 },
          uTime: { value: 0 },
          uCam: { value: new THREE.Vector3() },
        },
        vertexShader: PLANET_VERT,
        fragmentShader: PLANET_FRAG,
      }),
    [effKind, info.color, textures],
  );
  useEffect(() => () => mat.dispose(), [mat]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const temp = useRef<number | null>(null);

  useFrame((state, delta) => {
    const self = slots.current[info.id];
    if (!self) return;
    const u = mat.uniforms;
    let S = 0; // total flux in units of the solar constant (1 Lsun at 1 AU)
    let k = 0;
    for (const st of stars) {
      const g = slots.current[st.id];
      if (!g || !g.visible) continue;
      tmp.copy(g.position).sub(self.position);
      const flux = st.lum / Math.max(tmp.lengthSq(), 1e-10);
      S += flux;
      if (k < MAX_STARS) {
        u.uStarDir.value[k].copy(tmp.normalize());
        u.uStarCol.value[k].copy(st.color);
        u.uStarFlux.value[k] = flux;
        k++;
      }
    }
    if (stars.length === 0) {
      // no star in the simulation: neutral studio light from over the viewer's shoulder
      tmp.copy(state.camera.position).sub(self.position).normalize();
      tmp.x += 0.5;
      tmp.y += 0.6;
      u.uStarDir.value[0].copy(tmp.normalize());
      u.uStarCol.value[0].setRGB(1, 1, 1);
      u.uStarFlux.value[0] = 1.5;
      k = 1;
    }
    u.uStarCount.value = k;
    // blackbody equilibrium temperature (no albedo, no greenhouse), floor at the 2.7 K microwave background
    if (stars.length === 0) {
      temps.current[info.id] = NaN; // nothing to compute a temperature from, so none is shown
      u.uTemp.value = 288; // surface drawn as it looks today
    } else {
      const T = Math.max(2.7, 278.6 * Math.pow(S, 0.25));
      temp.current = temp.current === null ? T : temp.current + (T - temp.current) * Math.min(1, delta * 3);
      temps.current[info.id] = temp.current;
      u.uTemp.value = temp.current;
    }
    u.uTime.value = state.clock.elapsedTime;
    u.uCam.value.copy(state.camera.position);
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.15;
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

function EarthSurface(props: SurfaceProps) {
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
  return <PlanetSurface {...props} textures={tex} />;
}

/** a real body with its NASA-based map (and rings), falling back to the procedural surface */
function MappedSurface({ look, ...props }: SurfaceProps & { look: Look }) {
  const gl = useThree((s) => s.gl);
  const tex = useLoader(THREE.TextureLoader, look.map);
  useMemo(() => {
    tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
  }, [gl, tex]);
  return (
    <PlanetSurface {...props} kind={3} textures={[tex]}>
      {look.ring && (
        <Safe fallback={null}>
          <Suspense fallback={null}>
            <Ring {...look.ring} />
          </Suspense>
        </Safe>
      )}
    </PlanetSurface>
  );
}

function Body({ res, index, E0, slots, stars, temps }: { res: GravityResult; index: number; E0: number; slots: Slots<THREE.Group>; stars: StarRef[]; temps: Temps }) {
  const group = useRef<THREE.Group | null>(null);
  const sphere = useRef<THREE.Mesh | null>(null);
  const corona = useRef<THREE.Sprite>(null);

  const info = res.bodies[index];
  const star = isStar(info);
  const bh = isBlackHole(info);
  const bhRef = useRef<THREE.Group | null>(null);
  const look = star || bh ? null : lookFor(info.name);
  const compact = bh ? null : compactKind(info.name);
  const kind = planetKind(info);
  const baseSize = baseSizeOf(info, E0);
  const minAngular = 0.012; // never smaller than this fraction of camera distance
  const trailLen = Math.max(30, Math.floor(res.positions.length / 5));

  const color = useMemo(() => bodyColor(info), [info]);
  const starMat = useMemo(
    () => (star ? new THREE.ShaderMaterial({ uniforms: { uColor: { value: color }, uTime: { value: 0 } }, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG }) : null),
    [star, color],
  );
  const coronaMat = useMemo(
    () =>
      star
        ? new THREE.SpriteMaterial({ map: glowTexture(), color: color.clone().multiplyScalar(1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })
        : null,
    [star, color],
  );

  const { trail, trailMat, lastValid, trailExtent } = useMemo(() => {
    const n = res.positions.length;
    const pos = new Float32Array(n * 3);
    const idx = new Float32Array(n);
    let last: Vec3 | null = null;
    let lastValid = -1;
    for (let f = 0; f < n; f++) {
      const p = res.positions[f][index];
      if (p) {
        last = p;
        lastValid = f;
      }
      if (last) pos.set(toScene(last), f * 3);
      idx[f] = f;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aIndex", new THREE.BufferAttribute(idx, 1));
    const trailMat = new THREE.ShaderMaterial({
      uniforms: { uHead: { value: 0 }, uLen: { value: trailLen }, uColor: { value: new THREE.Color(info.color) }, uOpacity: { value: 1 } },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geo, trailMat);
    line.frustumCulled = false;
    let cx = 0, cy = 0, cz = 0, cnt = 0;
    for (let f = 0; f < n; f++) {
      const p = res.positions[f][index];
      if (p) { cx += p[0]; cy += p[1]; cz += p[2]; cnt++; }
    }
    let trailExtent = 0;
    if (cnt) {
      cx /= cnt; cy /= cnt; cz /= cnt;
      for (let f = 0; f < n; f++) {
        const p = res.positions[f][index];
        if (p) trailExtent = Math.max(trailExtent, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
      }
    }
    return { trail: line, trailMat, lastValid, trailExtent };
  }, [res, index, info.color, trailLen]);

  useEffect(
    () => () => {
      trail.geometry.dispose();
      trailMat.dispose();
      starMat?.dispose();
      coronaMat?.dispose();
    },
    [trail, trailMat, starMat, coronaMat],
  );

  useFrame((state, delta) => {
    const g = group.current;
    const sp = sphere.current;
    if (!g) return;
    const f = usePlayer.getState().playhead;
    const { i, t, last } = frameAt(res, f);
    const a = res.positions[i][index];
    const b = res.positions[Math.min(i + 1, last)][index];

    const end = Math.min(i + 1, lastValid);
    const start = Math.max(0, end - trailLen);
    trail.geometry.setDrawRange(start, Math.max(0, end - start + 1));
    trailMat.uniforms.uHead.value = Math.min(f, lastValid);
    trailMat.uniforms.uOpacity.value = f > lastValid ? Math.max(0, 1 - (f - lastValid) / 30) : 1;

    if (!a) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const p: Vec3 = b ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] : a;
    g.position.set(...toScene(p));

    const dist = state.camera.position.distanceTo(g.position);
    // honest size: never below the true radius, enlarged only when tiny on screen, never past 30% of the gap to the nearest body
    let near = Infinity;
    const fr = res.positions[i];
    for (let j = 0; j < fr.length; j++) {
      const q = fr[j];
      if (j === index || !q) continue;
      near = Math.min(near, Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]));
    }
    const s = Math.max(info.radius_au, Math.min(Math.max(baseSize, dist * minAngular), near * 0.3));
    g.userData.size = s;
    if (sp) sp.scale.setScalar(s);
    if (bhRef.current) bhRef.current.scale.setScalar(s / 2.598); // shadow drawn at the body's display size
    if (compact && sp) sp.rotation.y += delta * 3; // illustrative spin: real pulsars turn far too fast to show
    // a trail helps only when the motion is big next to the body; a wobble inside the body is noise
    trail.visible = trail.visible ? trailExtent > 2.5 * s : trailExtent > 3.5 * s; // hysteresis: no flicker while zooming
    if (starMat && sp) {
      starMat.uniforms.uTime.value = state.clock.elapsedTime;
      sp.rotation.y += delta * 0.05;
    }
    if (corona.current) {
      const pulse = 1 + 0.05 * Math.sin(state.clock.elapsedTime * 1.7 + index);
      corona.current.scale.setScalar(s * 5 * pulse);
    }
  });

  const surf: SurfaceProps = { info, kind, stars, slots, temps, meshRef: sphere };

  return (
    <>
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
        {bh ? (
          <BlackHoleVisual groupRef={bhRef} disk={false} />
        ) : compact ? (
          <CompactStar kind={compact} meshRef={sphere} />
        ) : starMat ? (
          <mesh ref={sphere} material={starMat}>
            <sphereGeometry args={[1, 64, 64]} />
          </mesh>
        ) : kind === 0 ? (
          <Suspense fallback={<PlanetSurface {...surf} textures={null} />}>
            <EarthSurface {...surf} />
          </Suspense>
        ) : look ? (
          <Safe fallback={<PlanetSurface {...surf} textures={null} />}>
            <Suspense fallback={<PlanetSurface {...surf} textures={null} />}>
              <MappedSurface {...surf} look={look} />
            </Suspense>
          </Safe>
        ) : (
          <PlanetSurface {...surf} textures={null} />
        )}
        {coronaMat && <sprite ref={corona} material={coronaMat} />}
      </group>
      <primitive object={trail} />
    </>
  );
}

/** flash and expanding shockwave where two bodies merged */
function MergeFlash({ res, ev }: { res: GravityResult; ev: MergeEvent }) {
  const flash = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Sprite>(null);
  const span = Math.max(20, res.times.length / 40);

  const { fm, pos } = useMemo(() => {
    let fm = res.times.findIndex((t) => t >= ev.t_yr - 1e-12);
    if (fm < 0) fm = res.times.length - 1;
    const into = ev.into ? res.bodies.findIndex((b) => b.name === ev.into) : -1;
    const gone = res.bodies.findIndex((b) => b.name === ev.body);
    const p = (into >= 0 ? res.positions[fm][into] : null) ?? (gone >= 0 ? res.positions[Math.max(0, fm - 1)][gone] : null) ?? [0, 0, 0];
    return { fm, pos: toScene(p as Vec3) };
  }, [res, ev]);

  const flashMat = useMemo(
    () => new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(4, 3.2, 2.4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    [],
  );
  const ringMat = useMemo(
    () => new THREE.SpriteMaterial({ map: ringTexture(), color: new THREE.Color(2.4, 2.2, 3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(
    () => () => {
      flashMat.dispose();
      ringMat.dispose();
    },
    [flashMat, ringMat],
  );

  const wp = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const fl = flash.current;
    const rg = ring.current;
    if (!fl || !rg) return;
    const k = (usePlayer.getState().playhead - fm) / span;
    const on = k >= 0 && k <= 1;
    fl.visible = on;
    rg.visible = on;
    if (!on) return;
    const s = state.camera.position.distanceTo(fl.getWorldPosition(wp)) * 0.04;
    fl.scale.setScalar(s * (1 + 4 * k));
    flashMat.opacity = 1 - k;
    rg.scale.setScalar(s * (1.5 + 12 * k));
    ringMat.opacity = (1 - k) * (1 - k);
  });

  return (
    <group position={pos}>
      <sprite ref={flash} material={flashMat} />
      <sprite ref={ring} material={ringMat} />
    </group>
  );
}

function ViewChips({ res }: { res: GravityResult }) {
  const focus = usePlayer((s) => s.focus);
  const setFocus = usePlayer((s) => s.setFocus);
  const items: { id: number | null; name: string }[] = [{ id: null, name: "All" }, ...res.bodies.slice(0, MAX_LABELS).map((b) => ({ id: b.id, name: b.name }))];
  return (
    <div style={{ position: "absolute", left: 12, top: 12, display: "flex", flexWrap: "wrap", gap: 6, maxWidth: "calc(100% - 330px)" }}>
      {items.map((it) => (
        <button
          key={it.id ?? "all"}
          onClick={() => setFocus(it.id)}
          className={`rounded-lg border px-3.5 py-1.5 text-sm backdrop-blur ${
            focus === it.id ? "border-white/40 bg-white/15 text-white" : "border-white/10 bg-black/40 text-white/60 hover:text-white"
          }`}
        >
          {it.name}
        </button>
      ))}
    </div>
  );
}

export function ZoomButtons() {
  const zoomBy = usePlayer((s) => s.zoomBy);
  const fit = usePlayer((s) => s.fit);
  const btn =
    "flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 bg-black/60 text-2xl text-white backdrop-blur hover:bg-white/15";
  return (
    <div style={{ position: "absolute", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <button className={btn} onClick={() => zoomBy(1 / 1.5)} title="Zoom in (+)">+</button>
      <button className={btn} onClick={() => zoomBy(1.5)} title="Zoom out (−)">−</button>
      <button className={btn.replace("text-2xl", "text-sm font-semibold")} onClick={fit} title="Fit everything (F)">Fit</button>
    </div>
  );
}

export default function GravityScene({ res }: { res: GravityResult }) {
  const E0 = useMemo(() => extentOf(res), [res]);
  const smartPace = usePlayer((s) => s.smartPace);
  const follow = usePlayer((s) => s.follow);
  const durations = useMemo(() => frameDurations(res, smartPace), [res, smartPace]);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const tags = useRef<(HTMLSpanElement | null)[]>([]);
  const temps = useRef<number[]>([]);

  const stars = useMemo<StarRef[]>(
    () =>
      res.bodies
        .filter(isStar)
        .map((b) => ({ id: b.id, lum: luminosity(b.mass_msun), color: bodyColor(b) }))
        .sort((a, b) => b.lum - a.lum),
    [res],
  );

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
      <Canvas camera={{ position: [0, E0 * 1.6, E0 * 2.4], fov: 50, near: E0 * 0.001, far: E0 * 1000 }} dpr={[1, 1.5]} gl={{ antialias: false, powerPreference: "high-performance" }}>
        <Sky />
        <Player durations={durations} />
        {res.bodies.map((b) => (
          <Body key={b.id} res={res} index={b.id} E0={E0} slots={groups} stars={stars} temps={temps} />
        ))}
        {res.events.map((ev, k) => (
          <MergeFlash key={k} res={res} ev={ev} />
        ))}
        <OrbitControls makeDefault enableDamping enableZoom={!follow} />
        <CameraRig res={res} E0={E0} slots={groups} />
        <ZoomInput />
        <Labels res={res} groups={groups} tags={tags} temps={temps} />
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={1} intensity={1.6} radius={0.75} />
          <Vignette eskil={false} offset={0.25} darkness={0.7} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>

      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {res.bodies.slice(0, MAX_LABELS).map((b) => (
          <span
            key={b.id}
            ref={(el) => {
              tags.current[b.id] = el;
            }}
            style={{ position: "absolute", left: 0, top: 0, display: "none" }}
            className="select-none whitespace-nowrap text-[13px] font-medium text-white/85 [text-shadow:0_0_6px_rgba(0,0,0,0.9)]"
          />
        ))}
      </div>

      <ViewChips res={res} />
      <ZoomButtons />
    </div>
  );
}
