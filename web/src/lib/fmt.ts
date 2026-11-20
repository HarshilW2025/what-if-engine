const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/** readable number: 28.72, 1,393.7, 3.05 × 10⁵ */
export function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) {
    const [m, e] = v.toExponential(2).split("e");
    return `${m} × 10${String(Number(e)).split("").map((ch) => SUP[ch] ?? ch).join("")}`;
  }
  return Number(v.toPrecision(4)).toLocaleString("en-US", { maximumFractionDigits: 3 });
}
