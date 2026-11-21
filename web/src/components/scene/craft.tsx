"use client";

import { useMemo } from "react";
import * as THREE from "three";

const PERSON = /\b(you|me|person|people|human|astronaut|jumper|skydiver|diver|twin|friend|observer|passenger|crew|traveller|traveler)\b/i;

/** Which small model to draw: people get an astronaut, every other ship a space shuttle. */
export function craftFor(name: string, kind: string): "person" | "shuttle" | null {
  if (kind === "ship") return PERSON.test(name) ? "person" : "shuttle";
  if (kind === "generic" && PERSON.test(name)) return "person";
  return null;
}

const WHITE = "#f1f1f1";
const GREY = "#c4c4c4";
const DARK = "#2a2f36";

/** Space shuttle, nose along +Y, about 1.6 long (the parent turns +Y into the direction of travel). */
export function Shuttle() {
  const wing = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.62, -0.45);
    s.lineTo(0.62, -0.45);
    s.lineTo(0, 0.28);
    s.closePath();
    return s;
  }, []);
  const fin = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0.15, -0.52);
    s.lineTo(0.15, -0.12);
    s.lineTo(0.5, -0.52);
    s.closePath();
    return s;
  }, []);
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[0.16, 0.18, 1.0, 20]} />
        <meshBasicMaterial color={WHITE} />
      </mesh>
      <mesh position={[0, 0.675, 0]}>
        <coneGeometry args={[0.16, 0.35, 20]} />
        <meshBasicMaterial color={WHITE} />
      </mesh>
      <mesh position={[0, 0.52, 0.14]}>
        <boxGeometry args={[0.14, 0.07, 0.05]} />
        <meshBasicMaterial color={DARK} />
      </mesh>
      <mesh position={[0, 0, -0.06]}>
        <extrudeGeometry args={[wing, { depth: 0.03, bevelEnabled: false }]} />
        <meshBasicMaterial color={GREY} />
      </mesh>
      <mesh rotation={[0, -Math.PI / 2, 0]}>
        <extrudeGeometry args={[fin, { depth: 0.03, bevelEnabled: false }]} />
        <meshBasicMaterial color={GREY} />
      </mesh>
      {[[-0.07, 0.03], [0.07, 0.03], [0, 0.12]].map(([x, z], k) => (
        <mesh key={k} position={[x, -0.56, z]}>
          <cylinderGeometry args={[0.045, 0.065, 0.12, 12]} />
          <meshBasicMaterial color={DARK} />
        </mesh>
      ))}
    </group>
  );
}

/** Astronaut, head along +Y, about 1.5 tall. */
export function Person() {
  return (
    <group>
      <mesh position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.17, 20, 16]} />
        <meshBasicMaterial color={WHITE} />
      </mesh>
      <mesh position={[0, 0.6, 0.08]}>
        <sphereGeometry args={[0.125, 20, 16]} />
        <meshBasicMaterial color="#c8961e" />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <capsuleGeometry args={[0.17, 0.33, 4, 14]} />
        <meshBasicMaterial color={WHITE} />
      </mesh>
      <mesh position={[0, 0.24, -0.19]}>
        <boxGeometry args={[0.3, 0.38, 0.12]} />
        <meshBasicMaterial color={GREY} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.26, 0.16, 0]} rotation={[0, 0, side * 0.25]}>
            <capsuleGeometry args={[0.06, 0.36, 4, 10]} />
            <meshBasicMaterial color={WHITE} />
          </mesh>
          <mesh position={[side * 0.09, -0.38, 0]}>
            <capsuleGeometry args={[0.075, 0.44, 4, 10]} />
            <meshBasicMaterial color={GREY} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
