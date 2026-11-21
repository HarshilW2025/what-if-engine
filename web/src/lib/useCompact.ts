"use client";

import { useEffect, useState } from "react";

/** True on phones: narrow (portrait) or short (landscape). Desktop layouts never see it. */
export function useCompact() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 767px), (max-height: 520px)");
    const on = () => setCompact(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return compact;
}
