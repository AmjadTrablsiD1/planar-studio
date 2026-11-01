import type { Operation, Spec, WindingDef } from "../types.ts";

/** A row of the design-steps view: what is computed, how, and the number. */
export type Step = { title: string; formula: string; result: string; note?: string };

export type Topology = {
  id: Spec["topology"];
  label: string;
  short: string;
  description: string;
  /** Spec fields this topology reads, beyond the common ones; the input rail shows only these. */
  fields: (keyof Spec)[];
  /** Gapped: Lm is a design target met by the gap. Ungapped: Lm is whatever the core gives. */
  gapped: boolean;
  windings: (s: Spec) => WindingDef[];
  /** Target turns ratio n = Np/Ns. */
  ratio: (s: Spec) => number;
  /** Target magnetising inductance (H) for a gapped topology; Infinity for an ungapped one. */
  lmTarget: (s: Spec, np: number, ns: number) => number;
  operate: (s: Spec, np: number, ns: number, lm: number, vin: number, samples: number) => Operation;
  /** Topology-specific design steps (ratio, inductance, duty) for the design path. */
  steps: (s: Spec, np: number, ns: number, lm: number) => Step[];
};

export const vo = (s: Spec): number => s.vout + s.vf;
export const pin = (s: Spec): number => (s.vout * s.iout) / s.eta;
