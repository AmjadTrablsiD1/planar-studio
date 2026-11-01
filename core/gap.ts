// Air gap for a target inductance, with McLyman's fringing factor
//   F = 1 + (lg/√Ae)·ln(2G/lg)
//   L = μ0·N²·Ae·F / (lg + le/μi)
// solved for lg by bisection (L falls monotonically with lg).

import { C, MU0, MM } from "./constants.ts";

export function fringing(lgMm: number, aeMm2: number, windowHeightMm: number): number {
  if (lgMm <= 0) return 1;
  return 1 + (lgMm / Math.sqrt(aeMm2)) * Math.log((2 * windowHeightMm) / lgMm);
}

/** Inductance (H) of N turns on a core with a centre-leg gap lg (mm). */
export function inductance(n: number, aeMm2: number, leMm: number, mu: number, lgMm: number, hwMm: number): number {
  const F = fringing(lgMm, aeMm2, hwMm);
  return (MU0 * n * n * aeMm2 * MM * MM * F) / ((lgMm + leMm / mu) * MM);
}

/** Gap (mm) giving inductance L; null when even the residual gap gives too little. */
export function gapFor(L: number, n: number, aeMm2: number, leMm: number, mu: number, hwMm: number): number | null {
  const lo0 = C.magnetics.residual_gap_mm;
  if (inductance(n, aeMm2, leMm, mu, lo0, hwMm) < L) return null;
  let lo = lo0, hi = C.magnetics.gap_max_mm;
  if (inductance(n, aeMm2, leMm, mu, hi, hwMm) > L) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (inductance(n, aeMm2, leMm, mu, mid, hwMm) > L) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}
