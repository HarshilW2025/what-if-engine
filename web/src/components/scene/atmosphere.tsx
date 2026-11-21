"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/** height: shell thickness as a fraction of the radius (gently exaggerated so it reads on screen); density: glow strength */
export type AtmoSpec = { color: [number, number, number]; height: number; density: number };

const EARTH: AtmoSpec = { color: [0.35, 0.6, 1.0], height: 0.035, density: 1.0 };
const REAL: [RegExp, AtmoSpec | null][] = [
  [/^earth$/, EARTH],
  [/^venus$/, { color: [0.98, 0.86, 0.55], height: 0.05, density: 1.5 }], // 92 bar CO2 with sulphuric acid clouds
  [/^mars$/, { color: [0.95, 0.62, 0.45], height: 0.02, density: 0.35 }], // 0.6% of Earth's pressure, dusty
  [/^titan$/, { color: [0.95, 0.62, 0.28], height: 0.12, density: 1.3 }], // thick nitrogen and orange haze
  [/^jupiter$/, { color: [0.92, 0.8, 0.62], height: 0.015, density: 0.6 }],
  [/^saturn$/, { color: [0.93, 0.85, 0.62], height: 0.015, density: 0.55 }],
  [/^uranus$/, { color: [0.62, 0.88, 0.92], height: 0.02, density: 0.6 }],
  [/^neptune$/, { color: [0.38, 0.58, 1.0], height: 0.02, density: 0.7 }],
  [/^(moon|mercury|io|europa|ganymede|callisto|ceres|pluto|phobos|deimos|vesta)$/, null], // airless, or too thin to see
];

/** The atmosphere a body would have: real data for real bodies, physics-based rules for invented ones. */
export function atmosphereFor(name: string, kind: "earth" | "rocky" | "gas" | "none", tint?: string | null, temperatureK?: number | null): AtmoSpec | null {
  const key = name.toLowerCase().replace(/\(.*?\)/g, "").replace(/^the\s+/, "").trim();
  for (const [re, spec] of REAL) if (re.test(key)) return spec;
  if (kind === "none") return null;
  if (temperatureK != null && temperatureK > 1500) return { color: [1.0, 0.55, 0.25], height: 0.03, density: 0.9 }; // vapour glowing over a molten world
  if (kind === "earth") return EARTH;
  const c = new THREE.Color(tint ?? "#9fb4c8");
  if (kind === "gas") return { color: [0.6 * c.r + 0.4, 0.6 * c.g + 0.4, 0.6 * c.b + 0.4], height: 0.02, density: 0.6 };
  return { color: [0.5 * c.r + 0.3, 0.5 * c.g + 0.38, 0.5 * c.b + 0.5], height: 0.025, density: 0.55 };
}

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uH;
uniform float uDensity;
uniform vec3 uLight;
uniform float uFlux;
uniform vec3 uCam;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float r = 1.0 - max(dot(N, V), 0.0);
  float R = 1.0 + uH;
  float limb = 1.0 - sqrt(max(1.0 - 1.0 / (R * R), 0.0)); // where the planet's own edge sits on this shell
  float outside = 1.0 - smoothstep(limb, 1.0, r);           // bright just above the surface, fading to space
  float inside = pow(clamp(r / limb, 0.0, 1.0), 4.0) * 0.5; // soft haze over the disk, strongest near the edge
  float a = r < limb ? inside : outside;
  float ndl = dot(N, normalize(uLight));
  float day = smoothstep(-0.3, 0.4, ndl);
  float dusk = smoothstep(-0.3, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.45, ndl));
  vec3 col = mix(uColor, vec3(1.0, 0.5, 0.22), dusk * 0.75);  // sunset light through the long path at the terminator
  float I = a * (day + 0.04) * uDensity * clamp(uFlux, 0.3, 1.5) * 1.8;
  gl_FragColor = vec4(col * I, I);
}`;

/** A glowing shell lit by the same star as its planet. Must be a child of the planet's sphere mesh (radius 1). */
export function Atmosphere({ spec }: { spec: AtmoSpec }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(...spec.color) },
          uH: { value: spec.height },
          uDensity: { value: spec.density },
          uLight: { value: new THREE.Vector3(1, 0.3, 0.2) },
          uFlux: { value: 1 },
          uCam: { value: new THREE.Vector3() },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [spec],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const pu = ((m.parent as THREE.Mesh | null)?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    if (pu?.uStarDir && pu.uStarCount && (pu.uStarCount.value as number) > 0) {
      mat.uniforms.uLight.value.copy(pu.uStarDir.value[0]);
      mat.uniforms.uFlux.value = Math.min(1.5, (pu.uStarFlux?.value?.[0] as number) || 1);
    }
    mat.uniforms.uCam.value.copy(state.camera.position);
  });
  const s = 1 + spec.height;
  return (
    <mesh ref={ref} material={mat} scale={[s, s, s]}>
      <sphereGeometry args={[1, 64, 48]} />
    </mesh>
  );
}
