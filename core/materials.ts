// Ferrite core loss. Steinmetz for sinusoidal flux, the improved generalised
// Steinmetz equation (iGSE, Venkatachalam et al. 2002) for any other shape:
//   Pv = (1/T)·∫ k_i·|dB/dt|^α·(ΔB)^(β−α) dt
//   k_i = k / ( (2π)^(α−1) · ∫₀^2π |cos θ|^α · 2^(β−α) dθ )
// which reduces exactly to k·f^α·B̂^β for a sine.

import { C, LIB } from "./constants.ts";
import { minmax } from "./waveform.ts";

export type Material = (typeof LIB.materials)[number];

export const MATERIALS: Material[] = LIB.materials;

export function material(id: string): Material {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown ferrite "${id}".`);
  return m;
}

/** Ferrites whose rated range contains fsw; all of them if none does. */
export function materialsFor(fsw: number): Material[] {
  const ok = MATERIALS.filter((m) => fsw >= m.f_min && fsw <= m.f_max);
  return ok.length ? ok : MATERIALS;
}

/** Steinmetz volume loss, W/m³, for a sinusoid of peak flux bPk (T) at f (Hz). */
export function steinmetz(m: Material, f: number, bPk: number): number {
  return m.k * f ** m.alpha * Math.abs(bPk) ** m.beta;
}

const kiCache = new Map<string, number>();

export function igseKi(m: Material): number {
  const key = `${m.k}|${m.alpha}|${m.beta}`;
  const hit = kiCache.get(key);
  if (hit !== undefined) return hit;
  const n = C.magnetics.igse_quad_points;
  let integral = 0;
  for (let i = 0; i < n; i++) {
    const th = ((i + 0.5) * 2 * Math.PI) / n;
    integral += Math.abs(Math.cos(th)) ** m.alpha;
  }
  integral *= ((2 * Math.PI) / n) * 2 ** (m.beta - m.alpha);
  const ki = m.k / ((2 * Math.PI) ** (m.alpha - 1) * integral);
  kiCache.set(key, ki);
  return ki;
}

/** iGSE volume loss, W/m³, for one period of a sampled flux waveform b (T) of period T (s). */
export function igse(m: Material, b: Float64Array, period: number): number {
  const n = b.length;
  const dt = period / n;
  const [lo, hi] = minmax(b);
  const dB = hi - lo;
  if (dB <= 0) return 0;
  const ki = igseKi(m);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const db = b[(i + 1) % n] - b[i];
    s += Math.abs(db / dt) ** m.alpha;
  }
  return (ki * dB ** (m.beta - m.alpha) * s * dt) / period;
}
