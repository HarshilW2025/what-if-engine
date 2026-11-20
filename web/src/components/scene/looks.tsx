"use client";

import { useLoader } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

/** Real imagery: Solar System Scope maps (CC BY 4.0), based on NASA data. See public/textures/planets/CREDITS.txt */
const T = "/textures/planets/";
export type RingSpec = { url: string; inner: number; outer: number; tilt: number };
export type Look = { map: string; ring?: RingSpec };
const LOOKS: [RegExp, Look][] = [
  [/^moon$/, { map: T + "2k_moon.jpg" }],
  [/^mercury$/, { map: T + "2k_mercury.jpg" }],
  [/^venus$/, { map: T + "2k_venus_atmosphere.jpg" }],
  [/^mars$/, { map: T + "2k_mars.jpg" }],
  [/^jupiter$/, { map: T + "2k_jupiter.jpg" }],
  [/^saturn$/, { map: T + "2k_saturn.jpg", ring: { url: T + "2k_saturn_ring_alpha.png", inner: 1.24, outer: 2.27, tilt: 0.466 } }],
  [/^uranus$/, { map: T + "2k_uranus.jpg" }],
  [/^neptune$/, { map: T + "2k_neptune.jpg" }],
];

/** Real imagery only for a body named exactly after a real one ("Moon", "the Moon", "Mars (half distance)").
 * "Cheese Moon" or "Second Moon" keep their own procedural look. */
export function lookFor(name: string): Look | null {
  const key = name.toLowerCase().replace(/\(.*?\)/g, "").replace(/^the\s+/, "").trim();
  for (const [re, look] of LOOKS) if (re.test(key)) return look;
  return null;
}

/** Renders the fallback if anything inside fails (a missing texture never breaks the scene). */
export class Safe extends Component<{ fallback: ReactNode; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Planetary ring in the planet's equatorial plane; tilts the parent planet mesh by the axial tilt.
 * Must be a child of the planet's sphere mesh (radius 1), so it scales with it. */
export function Ring({ url, inner, outer, tilt }: RingSpec) {
  const tex = useLoader(THREE.TextureLoader, url);
  const ref = useRef<THREE.Mesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.RingGeometry(inner, outer, 160, 1);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      const r = Math.hypot(pos.getX(k), pos.getY(k));
      uv.setXY(k, (r - inner) / (outer - inner), 0.5);
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: new THREE.Color(0.85, 0.82, 0.78) });
    return { geo, mat };
  }, [tex, inner, outer]);
  useEffect(() => {
    const planet = ref.current?.parent;
    if (planet) {
      planet.rotation.order = "ZYX"; // spin about the planet's own tilted axis
      planet.rotation.z = tilt;
    }
    return () => {
      geo.dispose();
      mat.dispose();
    };
  }, [geo, mat, tilt]);
  return <mesh ref={ref} geometry={geo} material={mat} rotation={[-Math.PI / 2, 0, 0]} />;
}
