"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { usePlayer } from "@/lib/store";
import type { GravityResult, SceneResult } from "@/lib/types";
import { worldFor } from "./Descent";
import { atmosphereFor } from "./scene/atmosphere";

const Descent = dynamic(() => import("./Descent"), { ssr: false });
const M_EARTH = 3.00349e-6;

/** Shows "Descend into X" when the camera is on a planet with an atmosphere. */
export default function DescendLauncher({ result }: { result: GravityResult | SceneResult }) {
  const focus = usePlayer((s) => s.focus);
  const [open, setOpen] = useState(false);
  const world = useMemo(() => {
    if (focus == null) return null;
    if (result.engine === "scene") {
      const b = result.bodies[focus];
      if (!b) return null;
      const kind = b.kind === "earth" ? "earth" : b.kind === "planet" ? "rocky" : "none";
      const temp = b.temperature?.find((x) => x != null) ?? null;
      const atmo = atmosphereFor(b.name, kind, b.color, temp);
      return atmo ? worldFor(b.name, atmo.color, b.color, false) : null;
    }
    const b = result.bodies[focus];
    if (!b || b.mass_msun >= 0.013) return null; // stars and brown dwarfs
    const giant = b.mass_msun >= 10 * M_EARTH;
    const kind = /earth/i.test(b.name) ? "earth" : giant ? "gas" : b.mass_msun < 0.05 * M_EARTH ? "none" : "rocky";
    const atmo = atmosphereFor(b.name, kind, b.color);
    return atmo ? worldFor(b.name, atmo.color, b.color, giant) : null;
  }, [result, focus]);

  const enabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("descent"); // hidden until it is good enough to show
  if (!world || !enabled) return null;
  return open ? (
    <Descent world={world} onClose={() => setOpen(false)} />
  ) : (
    <button
      onClick={() => {
        usePlayer.setState({ playing: false });
        setOpen(true);
      }}
      style={{ position: "absolute", right: 16, bottom: 200, zIndex: 10 }}
      className="rounded-xl border border-sky-300/40 bg-sky-400/15 px-4 py-2 text-sm font-semibold text-sky-100 backdrop-blur hover:bg-sky-400/25"
    >
      ↓ Descend into {world.name}
    </button>
  );
}
