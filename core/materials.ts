// Ferrite core loss. The material sheets give typical loss at a few
// (f, B̂) points; one global Steinmetz fit misses them badly (N87: −48 % at
// 500 kHz), because the frequency exponent rises with frequency. So the
// parameters are local: every point is normalised to B_REF with the
// material's flux exponent β, the curve is interpolated log-log in frequency,
// and α is the slope of the segment that contains fsw. Within the datasheet
// range the model passes through every published point.
//
// For any flux shape the improved generalised Steinmetz equation is used
// (iGSE, Venkatachalam et al. 2002):
//   Pv = (1/T)·∫ k_i·|dB/dt|^α·(ΔB)^(β−α) dt
//   k_i = k / ( (2π)^(α−1) · ∫₀^2π |cos θ|^α · 2^(β−α) dθ )
// which reduces exactly to k·f^α·B̂^β for a sine.

import { C, LIB } from "./constants.ts";
import { minmax } from "./waveform.ts";

export type Material = {
  id: string; vendor: string; note: string;
  bsat_T: number; mu_i: number; f_min: number; f_max: number;
  beta: number; beta_source: string;
  /** Typical loss at 100 °C: [f (Hz), B̂ (T), Pv (kW/m³)]. */
  points: number[][];
  /** Borrow the frequency slope of this material when only one frequency is published. */
  alpha_from?: string;
};

export type Steinmetz = { k: number; alpha: number; beta: number };

export const MATERIALS: Material[] = LIB.materials as Material[];
const B_REF = 0.1;

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

/** (ln f, ln Pv at B_REF in W/m³), one entry per frequency, sorted. */
function refCurve(m: Material): [number, number][] {
  const byF = new Map<number, number[]>();
  for (const [f, b, p] of m.points) {
    const lnP = Math.log(p * 1e3) + m.beta * Math.log(B_REF / b);
    byF.set(f, [...(byF.get(f) ?? []), lnP]);
  }
  return [...byF.entries()].sort((a, b) => a[0] - b[0]).map(([f, v]) => [Math.log(f), v.reduce((s, x) => s + x, 0) / v.length]);
}

/** ln Pv(B_REF) at ln f, and the local slope α, by log-log interpolation (end segments extrapolate). */
function onCurve(c: [number, number][], x: number): { lnP: number; alpha: number } {
  if (c.length === 1) return { lnP: c[0][1], alpha: NaN };
  let i = 0;
  while (i < c.length - 2 && x > c[i + 1][0]) i++;
  const [x0, y0] = c[i], [x1, y1] = c[i + 1];
  const alpha = (y1 - y0) / (x1 - x0);
  return { lnP: y0 + alpha * (x - x0), alpha };
}

const localCache = new Map<string, Steinmetz>();

/** Steinmetz parameters valid around frequency f (Pv in W/m³, f in Hz, B̂ in T). */
export function steinmetzAt(m: Material, f: number): Steinmetz {
  const key = `${m.id}|${f}`;
  const hit = localCache.get(key);
  if (hit) return hit;
  const x = Math.log(f);
  let { lnP, alpha } = onCurve(refCurve(m), x);
  if (!Number.isFinite(alpha)) {
    // One published frequency: take the shape of the donor's curve through this point.
    const donor = refCurve(material(m.alpha_from ?? "N87"));
    const own = refCurve(m)[0];
    const at = onCurve(donor, x), at0 = onCurve(donor, own[0]);
    alpha = at.alpha;
    lnP = own[1] + (at.lnP - at0.lnP);
  }
  const s = { k: Math.exp(lnP) / (f ** alpha * B_REF ** m.beta), alpha, beta: m.beta };
  localCache.set(key, s);
  return s;
}

/** Steinmetz volume loss, W/m³, for a sinusoid of peak flux bPk (T) at f (Hz). */
export function steinmetz(m: Material, f: number, bPk: number): number {
  const s = steinmetzAt(m, f);
  return s.k * f ** s.alpha * Math.abs(bPk) ** s.beta;
}

const kiCache = new Map<string, number>();

export function igseKi(s: Steinmetz): number {
  const key = `${s.k}|${s.alpha}|${s.beta}`;
  const hit = kiCache.get(key);
  if (hit !== undefined) return hit;
  const n = C.magnetics.igse_quad_points;
  let integral = 0;
  for (let i = 0; i < n; i++) {
    const th = ((i + 0.5) * 2 * Math.PI) / n;
    integral += Math.abs(Math.cos(th)) ** s.alpha;
  }
  integral *= ((2 * Math.PI) / n) * 2 ** (s.beta - s.alpha);
  const ki = s.k / ((2 * Math.PI) ** (s.alpha - 1) * integral);
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
  const s = steinmetzAt(m, 1 / period);
  const ki = igseKi(s);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const db = b[(i + 1) % n] - b[i];
    sum += Math.abs(db / dt) ** s.alpha;
  }
  return (ki * dB ** (s.beta - s.alpha) * sum * dt) / period;
}
