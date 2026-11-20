"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, type RefObject } from "react";
import * as THREE from "three";

/** All sizes are in units of the Schwarzschild radius r_s; the parent group is scaled to r_s. */
const LENS_R = 12; // lensing region, in r_s
const SHADOW_R = 2.598; // critical impact parameter 3*sqrt(3)/2 r_s
const DISK_IN = 3; // innermost stable circular orbit, in r_s
const DISK_OUT = 14;

const LENS_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/** Bends each view ray by the Schwarzschild deflection angle and samples the sky in the bent direction. */
const LENS_FRAG = /* glsl */ `
uniform vec3 uCenter;
uniform float uRs;
uniform float uR;
uniform samplerCube uEnv;
uniform float uHasEnv;
varying vec3 vWorld;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec3 oc = uCenter - ro;
  float tc = dot(oc, rd);
  vec3 perp = oc - rd * tc;        // from the ray's closest point to the hole
  float b = length(perp);          // impact parameter
  float bc = ${SHADOW_R.toFixed(3)} * uRs;
  if (b < bc && tc > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float x = max(b / bc, 1.0001);
  float weak = 2.0 * uRs / b + 15.0 * 3.14159265 * uRs * uRs / (16.0 * b * b); // 2nd order weak field
  float strong = -log(x - 1.0) - 0.4002;                                         // Bozza strong field limit
  float alpha = max(weak, strong) * smoothstep(uR, 0.65 * uR, b) * step(0.0, tc);
  vec3 k = normalize(perp);
  vec3 bent = rd * cos(alpha) + k * sin(alpha);
  vec3 col = uHasEnv > 0.5 ? textureCube(uEnv, bent).rgb : vec3(0.0);
  float ring = exp(-pow((x - 1.0) / 0.035, 2.0));   // photon ring
  col += vec3(1.0, 0.72, 0.42) * ring * 2.5;
  gl_FragColor = vec4(col, 1.0);
}
`;

const DISK_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/** Thin disk: T ~ r^-3/4 (1 - sqrt(r_in/r))^1/4, Keplerian speed, Doppler boost g^3 (illustrated streaks). */
const DISK_FRAG = /* glsl */ `
uniform vec3 uCenter;
uniform float uRs;
uniform float uTime;
varying vec3 vWorld;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n3(p); p *= 2.07; a *= 0.5; } return s; }
void main() {
  vec3 rel = vWorld - uCenter;
  float r = length(rel.xz) / uRs;
  if (r < ${DISK_IN.toFixed(1)} || r > ${DISK_OUT.toFixed(1)}) discard;
  float rin = ${DISK_IN.toFixed(1)};
  float T = pow(rin / r, 0.75) * pow(max(1.0 - sqrt(rin / r), 0.0), 0.25) * 2.3;
  float beta = sqrt(0.5 / r);
  vec3 tang = normalize(vec3(-rel.z, 0.0, rel.x));
  vec3 toCam = normalize(cameraPosition - vWorld);
  float g = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(tang, toCam));
  float boost = g * g * g;
  float a = atan(rel.z, rel.x) - uTime * 4.0 * pow(r, -1.5);
  float streak = 0.55 + 0.9 * fbm3(vec3(cos(a) * 3.0, sin(a) * 3.0, r * 0.9));
  float hotness = clamp(T * g, 0.0, 1.6);
  vec3 col = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.82, 0.6), clamp(hotness, 0.0, 1.0));
  col = mix(col, vec3(0.75, 0.85, 1.0), clamp(hotness - 1.0, 0.0, 1.0));
  float edge = smoothstep(rin, rin + 0.4, r) * (1.0 - smoothstep(${(DISK_OUT * 0.65).toFixed(2)}, ${DISK_OUT.toFixed(1)}, r));
  gl_FragColor = vec4(col * T * boost * streak * edge * 3.0, 1.0);
}
`;

export function BlackHoleVisual({ groupRef, disk }: { groupRef: RefObject<THREE.Group | null>; disk: boolean }) {
  const scene = useThree((s) => s.scene);
  const { lensMat, diskMat } = useMemo(() => {
    const lensMat = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uRs: { value: 1 },
        uR: { value: LENS_R },
        uEnv: { value: null },
        uHasEnv: { value: 0 },
      },
      vertexShader: LENS_VERT,
      fragmentShader: LENS_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const diskMat = disk
      ? new THREE.ShaderMaterial({
          uniforms: { uCenter: { value: new THREE.Vector3() }, uRs: { value: 1 }, uTime: { value: 0 } },
          vertexShader: DISK_VERT,
          fragmentShader: DISK_FRAG,
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      : null;
    return { lensMat, diskMat };
  }, [disk]);

  useEffect(
    () => () => {
      lensMat.dispose();
      diskMat?.dispose();
    },
    [lensMat, diskMat],
  );

  const c = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    g.getWorldPosition(c);
    const rs = g.scale.x;
    lensMat.uniforms.uCenter.value.copy(c);
    lensMat.uniforms.uRs.value = rs;
    lensMat.uniforms.uR.value = LENS_R * rs;
    const bg = scene.background as THREE.Texture | null;
    if (bg && bg.isTexture) {
      lensMat.uniforms.uEnv.value = bg;
      lensMat.uniforms.uHasEnv.value = 1;
    }
    if (diskMat) {
      diskMat.uniforms.uCenter.value.copy(c);
      diskMat.uniforms.uRs.value = rs;
      diskMat.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh material={lensMat} renderOrder={-1}>
        <sphereGeometry args={[LENS_R, 64, 48]} />
      </mesh>
      <mesh>
        <sphereGeometry args={[SHADOW_R, 48, 32]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      {diskMat && (
        <mesh material={diskMat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
          <ringGeometry args={[DISK_IN, DISK_OUT, 256, 8]} />
        </mesh>
      )}
    </group>
  );
}
