// Periodic waveforms are sampled uniformly over one switching period. Every
// topology produces them; the winding model and the iGSE consume them.

export type Complex = { re: number; im: number };

/** Uniform sample grid: t_k = k·T/N, k = 0…N−1. */
export function grid(n: number, period: number): Float64Array {
  const t = new Float64Array(n);
  for (let k = 0; k < n; k++) t[k] = (k * period) / n;
  return t;
}

/** Sample a function of the phase u ∈ [0, 1). */
export function sample(n: number, f: (u: number) => number): Float64Array {
  const x = new Float64Array(n);
  for (let k = 0; k < n; k++) x[k] = f(k / n);
  return x;
}

export function mean(x: Float64Array): number {
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

export function rms(x: Float64Array): number {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / x.length);
}

export function peak(x: Float64Array): number {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return m;
}

export function minmax(x: Float64Array): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

/**
 * RMS phasors of harmonics 0…K. Index 0 is the DC value (real); index k ≥ 1
 * is √2·X_k with X_k = (1/N)·Σ x_n e^{−j2πkn/N}, so |I_k| is the rms of that
 * harmonic and Σ|I_k|² = rms² when K covers the spectrum.
 */
export function harmonics(x: Float64Array, K: number): Complex[] {
  const n = x.length;
  const cos = twiddle(n);
  const out: Complex[] = [];
  for (let k = 0; k <= K; k++) {
    let re = 0, im = 0;
    // e^{−j2πki/n}: cos from the table, sin(θ) = −cos(θ + π/2) → index offset n/4.
    for (let i = 0, j = 0; i < n; i++, j = (j + k) % n) {
      re += x[i] * cos[j];
      im -= x[i] * cos[(j + n - n / 4) % n];
    }
    re /= n; im /= n;
    out.push(k === 0 ? { re, im: 0 } : { re: Math.SQRT2 * re, im: Math.SQRT2 * im });
  }
  return out;
}

const twiddles = new Map<number, Float64Array>();
function twiddle(n: number): Float64Array {
  let t = twiddles.get(n);
  if (!t) {
    t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = Math.cos((2 * Math.PI * i) / n);
    twiddles.set(n, t);
  }
  return t;
}

/** Running integral (trapezoid) of x over one period with step dt, starting at 0. */
export function integrate(x: Float64Array, dt: number): Float64Array {
  const y = new Float64Array(x.length);
  for (let i = 1; i < x.length; i++) y[i] = y[i - 1] + 0.5 * (x[i - 1] + x[i]) * dt;
  return y;
}

/** Piecewise-linear interpolation through (u, y) knots on the phase u ∈ [0, 1]. */
export function pwl(knots: [number, number][]): (u: number) => number {
  return (u: number) => {
    for (let i = 1; i < knots.length; i++) {
      const [u0, y0] = knots[i - 1];
      const [u1, y1] = knots[i];
      if (u <= u1) return u1 === u0 ? y1 : y0 + ((y1 - y0) * (u - u0)) / (u1 - u0);
    }
    return knots[knots.length - 1][1];
  };
}
