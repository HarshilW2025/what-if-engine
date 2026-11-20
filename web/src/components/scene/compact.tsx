"use client";

import { useEffect, useMemo, type RefObject } from "react";
import * as THREE from "three";
import { glowTexture, kelvinToColor } from "./visuals";

export type CompactKind = "neutron" | "pulsar" | "magnetar" | "whitedwarf";

/** Compact stars are recognised by name. No photographs of them exist, so these visuals come from the physics. */
export function compactKind(name: string): CompactKind | null {
  const n = name.toLowerCase();
  if (n.includes("magnetar")) return "magnetar";
  if (n.includes("pulsar")) return "pulsar";
  if (n.includes("neutron")) return "neutron";
  if (/white\s*dwarf/.test(n)) return "whitedwarf";
  return null;
}

const BEAM_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = `uniform vec3 uColor; varying vec2 vUv; void main() { float a = pow(vUv.y, 2.5); gl_FragColor = vec4(uColor * a, a); }`;
const MAG_TILT = 0.5; // magnetic axis about 30 degrees from the spin axis: the misalignment is what makes a pulsar pulse

/** Tiny, extremely hot core. Pulsars sweep two beams along the magnetic axis like a lighthouse; magnetars also show
 * dipole field loops (r = L sin^2 theta). Everything is a child of the core mesh, so it scales and spins with it. */
export function CompactStar({ kind, meshRef, temperature }: { kind: CompactKind; meshRef: RefObject<THREE.Mesh | null>; temperature?: number }) {
  const T = temperature ?? (kind === "whitedwarf" ? 25000 : 1e6);
  const parts = useMemo(() => {
    const color = kelvinToColor(T);
    const core = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false });
    const glow = new THREE.SpriteMaterial({ map: glowTexture(), color: color.clone().multiplyScalar(2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    let beamGeo: THREE.ConeGeometry | null = null;
    let beamMat: THREE.ShaderMaterial | null = null;
    if (kind === "pulsar" || kind === "magnetar") {
      beamGeo = new THREE.ConeGeometry(3, 30, 32, 1, true);
      beamGeo.translate(0, -15, 0); // apex at the star, opening outward
      beamMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0.55, 0.75, 1.6).multiplyScalar(kind === "pulsar" ? 1.6 : 0.8) } },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    }
    let field: THREE.LineSegments | null = null;
    if (kind === "magnetar") {
      const pts: number[] = [];
      for (const L of [2.2, 3.4, 5.0, 7.0]) {
        for (let p = 0; p < 6; p++) {
          const phi = (p / 6) * Math.PI * 2;
          let prev: number[] | null = null;
          for (let k = 0; k <= 48; k++) {
            const th = 0.12 + (k / 48) * (Math.PI - 0.24);
            const r = L * Math.sin(th) ** 2;
            const cur = [r * Math.sin(th) * Math.cos(phi), r * Math.cos(th), r * Math.sin(th) * Math.sin(phi)];
            if (prev) pts.push(...prev, ...cur);
            prev = cur;
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      field = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: new THREE.Color(0.7, 0.5, 1.8), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
    }
    return { core, glow, beamGeo, beamMat, field };
  }, [kind, T]);

  useEffect(
    () => () => {
      parts.core.dispose();
      parts.glow.dispose();
      parts.beamGeo?.dispose();
      parts.beamMat?.dispose();
      if (parts.field) {
        parts.field.geometry.dispose();
        (parts.field.material as THREE.Material).dispose();
      }
    },
    [parts],
  );

  const g = kind === "whitedwarf" ? 5 : 4;
  return (
    <mesh ref={meshRef} material={parts.core}>
      <sphereGeometry args={[1, 32, 24]} />
      <sprite material={parts.glow} scale={[g, g, 1]} />
      <group rotation={[0, 0, MAG_TILT]}>
        {parts.beamGeo && parts.beamMat && (
          <>
            <mesh geometry={parts.beamGeo} material={parts.beamMat} />
            <mesh geometry={parts.beamGeo} material={parts.beamMat} rotation={[0, 0, Math.PI]} />
          </>
        )}
        {parts.field && <primitive object={parts.field} />}
      </group>
    </mesh>
  );
}
