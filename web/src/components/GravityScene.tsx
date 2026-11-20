"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { usePlayer } from "@/lib/store";
import type { GravityResult, Vec3 } from "@/lib/types";

const TRAIL_FRAMES = 120;

/** physics uses z-up with the orbital plane in x-y; three.js uses y-up */
function toScene(p: Vec3): [number, number, number] {
  return [p[0], p[2], -p[1]];
}

function extentOf(res: GravityResult): number {
  let m = 0;
  for (const p of res.positions[0]) if (p) m = Math.max(m, Math.hypot(p[0], p[1], p[2]));
  return m || 1;
}

/** advances the shared playhead every rendered frame */
function Player({ frames }: { frames: number }) {
  useFrame((_, delta) => {
    const s = usePlayer.getState();
    if (!s.playing) return;
    const next = s.playhead + delta * s.fps;
    if (next >= frames - 1) usePlayer.setState({ playhead: frames - 1, playing: false });
    else usePlayer.setState({ playhead: next });
  });
  return null;
}

function Body({ res, index, size }: { res: GravityResult; index: number; size: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const info = res.bodies[index];
  const isStar = info.mass_msun >= 0.08;

  const color = useMemo(
    () => new THREE.Color(info.color).multiplyScalar(isStar ? 3 : 1.5), // >1 so bloom makes it glow
    [info.color, isStar],
  );

  const { trail, lastValid } = useMemo(() => {
    const n = res.positions.length;
    const arr = new Float32Array(n * 3);
    let last: Vec3 | null = null;
    let lastValid = -1;
    for (let f = 0; f < n; f++) {
      const p = res.positions[f][index];
      if (p) {
        last = p;
        lastValid = f;
      }
      if (last) arr.set(toScene(last), f * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.LineBasicMaterial({ color: info.color, transparent: true, opacity: 0.6 });
    return { trail: new THREE.Line(geo, mat), lastValid };
  }, [res, index, info.color]);

  useEffect(
    () => () => {
      trail.geometry.dispose();
      (trail.material as THREE.Material).dispose();
    },
    [trail],
  );

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const f = usePlayer.getState().playhead;
    const i = Math.floor(f);
    const t = f - i;
    const a = res.positions[i]?.[index] ?? null;
    const b = res.positions[Math.min(i + 1, res.positions.length - 1)]?.[index] ?? null;

    const end = Math.min(i, lastValid);
    const start = Math.max(0, end - TRAIL_FRAMES);
    trail.geometry.setDrawRange(start, Math.max(0, end - start + 1));

    if (!a) {
      m.visible = false; // merged away
      return;
    }
    m.visible = true;
    const p: Vec3 = b ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] : a;
    m.position.set(...toScene(p));
  });

  return (
    <>
      <mesh ref={mesh} scale={size}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <primitive object={trail} />
    </>
  );
}

export default function GravityScene({ res }: { res: GravityResult }) {
  const E = useMemo(() => extentOf(res), [res]);
  return (
    <Canvas camera={{ position: [0, E * 1.6, E * 2.4], fov: 50, near: E * 0.001, far: E * 5000 }} dpr={[1, 2]}>
      <color attach="background" args={["#02030a"]} />
      <Stars radius={E * 200} depth={E * 40} count={5000} factor={4} fade />
      <Player frames={res.positions.length} />
      {res.bodies.map((b) => (
        <Body key={b.id} res={res} index={b.id} size={b.mass_msun >= 0.08 ? E * 0.05 : E * 0.02} />
      ))}
      <OrbitControls makeDefault enableDamping />
      <EffectComposer>
        <Bloom mipmapBlur luminanceThreshold={1} intensity={1.4} />
      </EffectComposer>
    </Canvas>
  );
}
