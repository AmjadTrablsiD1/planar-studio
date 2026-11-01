// Isolation and thermal screening rules. These are first-pass engineering
// estimates with the source of each rule in shared/constants.json — not a
// safety certification, and the inspector says so next to every result.

import { C } from "./constants.ts";
import type { Insulation } from "./types.ts";

export type Isolation = {
  testVrms: number;      // hipot voltage the barrier must hold
  strengthMm: number;    // thickness for that voltage at derated breakdown
  dtiMm: number;         // distance-through-insulation floor of the class
  layerMm: number;       // required P–S dielectric = max(strength, DTI)
  creepMm: number;       // required surface distance (via the core counts)
};

/** Linear interpolation in a table, clamped at both ends. */
export function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1] * (x / xs[xs.length - 1]);
}

export function isolation(cls: Insulation, vWork: number): Isolation {
  const I = C.isolation;
  const testVrms = Math.max(I.test_vrms_base[cls], I.test_vrms_per_vwork[cls] * vWork + I.test_vrms_offset[cls]);
  const strengthMm = (testVrms * Math.SQRT2) / (C.pcb.breakdown_kV_per_mm * 1000 * I.breakdown_derating);
  const dtiMm = I.dti_min_mm[cls];
  const basic = interp(I.creepage_table_vrms, I.creepage_table_mm, vWork);
  return {
    testVrms, strengthMm, dtiMm,
    layerMm: Math.max(strengthMm, dtiMm),
    creepMm: cls === "reinforced" ? basic * I.reinforced_factor : basic,
  };
}

/** Natural-convection temperature rise (°C) for a loss P (W) over a surface A (mm²). */
export function tempRise(pW: number, areaMm2: number): number {
  if (pW <= 0) return 0;
  return ((pW * 1000) / (areaMm2 / 100)) ** C.thermal.exponent;
}
