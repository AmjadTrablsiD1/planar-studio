// Rule 16: only as many digits as the number deserves. Every value the UI or
// the report shows passes through fmt() or fmtSI(); nothing rounds on its own.

const PREFIXES: [number, string][] = [
  [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""],
  [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"],
];

/** Units that must never take an SI prefix (they already carry one, or a prefix reads wrong). */
const NO_PREFIX = new Set(["", "°C", "K", "%", "mm", "mm²", "µm", "A/mm²", "turns", "×", "W/cm³"]);

function trimZeros(s: string): string {
  return s.includes(".") && !s.includes("e") ? s.replace(/\.?0+$/, "") : s;
}

/** Plain number: exponent for huge/tiny, else 3 significant digits at most. */
export function fmt(x: number, sig = 3): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "—" : x > 0 ? "∞" : "−∞";
  if (x === 0) return "0";
  const a = Math.abs(x);
  let s: string;
  if (a >= 1e6 || a < 1e-4) s = x.toExponential(sig - 1).replace(/\.?0+e/, "e").replace("e+", "e");
  else if (a >= 10 ** sig) s = x.toFixed(0);
  else s = trimZeros(x.toPrecision(sig));
  return s.replace(/^-/, "−");
}

/** Value with an SI prefix: 1.2e-7 H → { num: "120", unit: "nH" }. Three significant digits. */
export function fmtSI(x: number, unit: string, sig = 3): { num: string; unit: string } {
  if (!Number.isFinite(x) || x === 0 || NO_PREFIX.has(unit)) return { num: fmt(x, sig), unit };
  const a = Math.abs(x);
  for (const [f, p] of PREFIXES) {
    if (a >= f * 0.9995) return { num: fmt(x / f, sig), unit: p + unit };
  }
  return { num: fmt(x, sig), unit };
}

/** One string: "120 nH". */
export function si(x: number, unit: string, sig = 3): string {
  const r = fmtSI(x, unit, sig);
  return r.unit ? `${r.num} ${r.unit}` : r.num;
}

/** Percent from a fraction: 0.9734 → "97.3 %". */
export function pct(x: number, sig = 3): string {
  return `${fmt(x * 100, sig)} %`;
}
