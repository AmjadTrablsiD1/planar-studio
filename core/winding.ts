// Copper loss of a planar winding stack: the 1-D field model of Dowell (1966)
// in the boundary-field form of Ferreira (1994), applied per layer and per
// harmonic. A layer with rms MMFs F1, F2 (A·turns) on its two faces loses
//
//   P = R_F · Δ' · [ (|F1|² + |F2|²)·G1(Δ') − 4·Re(F1·F2*)·G2(Δ') ]
//
//   G1 = (sinh 2Δ + sin 2Δ) / (cosh 2Δ − cos 2Δ)
//   G2 = (sinh Δ·cos Δ + cosh Δ·sin Δ) / (cosh 2Δ − cos 2Δ)
//   Δ' = (h/δ)·√η          η = copper fraction of the window breadth (porosity)
//   R_F = ρ·MLT / (N·w·h)  the layer's DC resistance per (A·turn)²
//
// which tends to R_F·|F2 − F1|² = I²·R_dc as Δ → 0. The field is tangential to
// the layers; the MMF is referenced to the gap plane (Ampère's law around a
// contour that does not cross the gap), so a flyback's stored-energy MMF shows
// up as field next to the gap, as it does physically.

import { C, MU0, EPS0, MM } from "./constants.ts";
import type { CoreInfo } from "./cores.ts";
import type { Complex } from "./waveform.ts";
import type { Layer, LayerResult } from "./types.ts";

export function rhoCu(tC: number): number {
  return C.physics.rho_cu_20 * (1 + C.physics.alpha_cu * (tC - 20));
}

export function skinDepth(rho: number, f: number): number {
  return Math.sqrt(rho / (Math.PI * f * MU0));
}

/** Δ'·G1 and Δ'·G2, stable at both ends. */
export function dowellG(D: number): [number, number] {
  if (D < 1e-3) return [1, 0.5];
  if (D > 20) return [D, 0];
  // One exp, one sin, one cos: this runs a few million times per search.
  const e = Math.exp(D), ei = 1 / e;
  const sh = 0.5 * (e - ei), ch = 0.5 * (e + ei);
  const sn = Math.sin(D), cs = Math.cos(D);
  const sh2 = 2 * sh * ch, ch2 = ch * ch + sh * sh;
  const sn2 = 2 * sn * cs, cs2 = cs * cs - sn * sn;
  const den = ch2 - cs2;
  return [(D * (sh2 + sn2)) / den, (D * (sh * cs + ch * sn)) / den];
}

/** Classic Dowell AC factor of the m-th layer (m = 1 at the zero-field face) for a sinusoid. */
export function dowellFr(D: number, m: number): number {
  const [dg1, dg2] = dowellG(D);
  // F1 = (m−1)·ΔF, F2 = m·ΔF → [(m−1)² + m²]·G1 − 4·m(m−1)·G2, normalised by ΔF².
  return ((m - 1) ** 2 + m * m) * dg1 - 4 * m * (m - 1) * dg2;
}

export type StackLoss = {
  layers: LayerResult[];
  byWinding: Record<string, { loss: number; rdc: number; irms: number; rac: number }>;
  total: number;
};

const cmul = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });
const cadd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const csub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const abs2 = (a: Complex) => a.re * a.re + a.im * a.im;

/**
 * MMF on every face p = 0…L (0 = top) of the stack for per-layer ampere-turn
 * phasors dF, with the zero referenced to the gap plane g: faces above the gap
 * close their Ampère contour through the top core, faces below through the
 * bottom core.
 */
export function faceMmf(dF: Complex[], gapPlane: number): { top: Complex[]; bottom: Complex[] } {
  const L = dF.length;
  const A: Complex[] = [{ re: 0, im: 0 }];
  for (let i = 0; i < L; i++) A.push(cadd(A[i], dF[i]));
  const net = A[L];
  const top: Complex[] = [], bottom: Complex[] = [];
  for (let i = 0; i < L; i++) {
    const below = i >= gapPlane;
    const f = (p: number) => (below ? csub(net, A[p]) : cmul(A[p], -1));
    top.push(f(i));
    bottom.push(f(i + 1));
  }
  return { top, bottom };
}

/**
 * Copper loss per layer at copper temperature tC. `harm[w][k]` is the rms
 * phasor of winding w at harmonic k (k = 0 is DC).
 */
export function stackLoss(
  core: CoreInfo, layers: Layer[], harm: Record<string, Complex[]>, fsw: number, tC: number, gapPlane: number,
): StackLoss {
  const rho = rhoCu(tC);
  const w = core.window * MM;
  const K = Math.min(...Object.values(harm).map((h) => h.length)) - 1;
  const res: LayerResult[] = layers.map((l) => ({
    index: l.index, winding: l.winding, rdc: 0, irms: 0, loss: 0, lossDc: 0, fr: 1, mmfTop: 0, mmfBottom: 0, jRms: 0,
  }));
  for (const [i, l] of layers.entries()) {
    const h = l.hMm * MM;
    res[i].rdc = (rho * l.turns * l.mltMm * MM) / (l.widthMm * MM * h);
    let i2 = 0;
    for (let k = 0; k <= K; k++) i2 += abs2(harm[l.winding][k]);
    res[i].irms = Math.sqrt(i2) / l.parallel;
    res[i].lossDc = res[i].irms ** 2 * res[i].rdc;
    res[i].jRms = res[i].irms / (l.widthMm * l.hMm);
  }
  const energy = (k: number) => Object.values(harm).reduce((a, h) => a + abs2(h[k]), 0);
  const e0 = Array.from({ length: K + 1 }, (_, k) => energy(k));
  const eTot = e0.reduce((a, b) => a + b, 0);
  for (let k = 0; k <= K; k++) {
    if (e0[k] < 1e-9 * eTot) continue;
    const dF = layers.map((l) => cmul(harm[l.winding][k], l.turns / l.parallel));
    const { top, bottom } = faceMmf(dF, gapPlane);
    const delta = k === 0 ? Infinity : skinDepth(rho, k * fsw);
    for (const [i, l] of layers.entries()) {
      const rF = (rho * l.mltMm * MM) / (l.porosity * w * l.hMm * MM);
      const F1 = top[i], F2 = bottom[i];
      if (k === 0) {
        res[i].loss += rF * abs2(csub(F2, F1));
        continue;
      }
      const D = ((l.hMm * MM) / delta) * Math.sqrt(l.porosity);
      const [dg1, dg2] = dowellG(D);
      res[i].loss += rF * ((abs2(F1) + abs2(F2)) * dg1 - 4 * (F1.re * F2.re + F1.im * F2.im) * dg2);
      if (k === 1) { res[i].mmfTop = Math.sqrt(abs2(F1)); res[i].mmfBottom = Math.sqrt(abs2(F2)); }
    }
  }
  const byWinding: StackLoss["byWinding"] = {};
  for (const [i, l] of layers.entries()) {
    const r = res[i];
    r.fr = r.lossDc > 0 ? r.loss / r.lossDc : 1;
    const b = (byWinding[l.winding] ??= { loss: 0, rdc: 0, irms: 0, rac: 0 });
    b.loss += r.loss;
    if (l.copy === 0) b.rdc += r.rdc / l.parallel;
    b.irms = r.irms * l.parallel;
  }
  for (const b of Object.values(byWinding)) b.rac = b.irms > 0 ? b.loss / b.irms ** 2 : 0;
  return { layers: res, byWinding, total: res.reduce((a, r) => a + r.loss, 0) };
}

/**
 * Leakage inductance referred to the primary, from the stored field energy of
 * the balanced load MMF (magnetising current excluded):
 *   L = μ0·MLT/w · [ Σ_layers h·(F1² + F1·F2 + F2²)/3 + Σ_gaps d·F² ] / Ip²
 * Load currents: primary 1 A, the active secondary −Np/Ns·(1 A), others idle.
 */
export function leakage(core: CoreInfo, layers: Layer[], diel: number[], load: Record<string, number>): number {
  const dF = layers.map((l) => (load[l.winding] ?? 0) * (l.turns / l.parallel));
  let F = 0, sum = 0;
  for (const [i, l] of layers.entries()) {
    const F1 = F, F2 = F + dF[i];
    sum += (l.hMm * MM * (F1 * F1 + F1 * F2 + F2 * F2)) / 3;
    F = F2;
    if (i < diel.length) sum += diel[i] * MM * F * F;
  }
  const mlt = (layers.reduce((a, l) => a + l.mltMm, 0) / layers.length) * MM;
  return (MU0 * mlt * sum) / (core.window * MM);
}

/** Parallel-plate capacitance of every adjacent pair of layers on different sides (pF-scale, F). */
export function interwinding(layers: Layer[], diel: number[]): { total: number; pairs: { a: number; b: number; c: number }[] } {
  const pairs: { a: number; b: number; c: number }[] = [];
  for (let i = 0; i + 1 < layers.length; i++) {
    const A = layers[i], B = layers[i + 1];
    if (A.side === B.side) continue;
    const mlt = 0.5 * (A.mltMm + B.mltMm) * MM;
    const overlap = Math.min(A.turns * A.widthMm, B.turns * B.widthMm) * MM;
    pairs.push({ a: i, b: i + 1, c: (EPS0 * C.pcb.eps_r * mlt * overlap) / (diel[i] * MM) });
  }
  return { total: pairs.reduce((a, p) => a + p.c, 0), pairs };
}

/**
 * Real MMF on both faces of every layer at the instant of the peak primary
 * current, referenced to the gap plane — what the cross-section draws.
 */
export function faceMmfReal(d: {
  layers: Layer[]; choice: { set: string }; mag: { op: { currents: Record<string, Float64Array> } };
}): [number, number][] {
  const cur = d.mag.op.currents;
  const ip = cur.P;
  let k = 0;
  for (let i = 1; i < ip.length; i++) if (Math.abs(ip[i]) > Math.abs(ip[k])) k = i;
  const dF = d.layers.map((l) => ({ re: (cur[l.winding][k] * l.turns) / l.parallel, im: 0 }));
  const gap = d.choice.set === "E+PLT" ? 0 : Math.floor(d.layers.length / 2);
  const { top, bottom } = faceMmf(dF, gap);
  return top.map((t, i) => [t.re, bottom[i].re]);
}
