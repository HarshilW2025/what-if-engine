const SUP: Record<string, string> = {
  "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

/** 3.5e-14 -> "3.5 × 10⁻¹⁴" */
export function sci(x: number): string {
  if (x === 0) return "below 10⁻¹⁶";
  const exp = Math.floor(Math.log10(Math.abs(x)));
  const mant = x / 10 ** exp;
  return `${mant.toFixed(1)} × 10${String(exp).split("").map((c) => SUP[c] ?? c).join("")}`;
}

/** years -> readable duration */
export function years(yr: number): string {
  const s = yr * 365.25 * 86400;
  if (s < 120) return `${s.toFixed(2)} s`;
  if (s < 2 * 3600) return `${(s / 60).toFixed(1)} min`;
  if (s < 3 * 86400) return `${(s / 3600).toFixed(1)} h`;
  if (yr < 1) return `${(yr * 365.25).toFixed(1)} days`;
  if (yr < 10000) return `${yr.toFixed(2)} yr`;
  return `${yr.toExponential(2)} yr`;
}
