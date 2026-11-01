// Every formula is checked against a second, independent route to the same
// number (rule 15): a closed form against a numerical solution, a datasheet
// point, an energy balance, or an analytic special case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { igse, material, steinmetz } from "../core/materials.ts";
import { coreInfo, CORES, turnLength } from "../core/cores.ts";
import { gapFor, inductance } from "../core/gap.ts";
import { dowellFr, dowellG, skinDepth, rhoCu, stackLoss, leakage } from "../core/winding.ts";
import { sample, harmonics, rms } from "../core/waveform.ts";
import { MU0 } from "../core/constants.ts";
import { fmt, fmtSI, si } from "../core/format.ts";
import { isolation, interp, tempRise } from "../core/checks.ts";
import type { Layer } from "../core/types.ts";

const near = (a: number, b: number, rel: number, msg = "") =>
  assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} ${a} vs ${b} (±${rel * 100}%)`);

test("format: rule 16 digits and SI prefixes", () => {
  assert.equal(fmt(14.3218), "14.3");
  assert.equal(fmt(0.0000123456), "1.23e-5");
  assert.equal(si(1.2e-7, "H"), "120 nH");
  assert.equal(si(0.0254, "Ω"), "25.4 mΩ");
  assert.deepEqual(fmtSI(3.3, "mm"), { num: "3.3", unit: "mm" });
  assert.equal(fmt(-2.5), "−2.5");
});

test("iGSE equals Steinmetz for a sine (definition of k_i)", () => {
  const m = material("N87");
  const f = 150e3, B = 0.12, N = 2048;
  const b = sample(N, (u) => B * Math.sin(2 * Math.PI * u));
  near(igse(m, b, 1 / f), steinmetz(m, f, B), 0.002);
});

test("iGSE on a symmetric triangle matches the closed form k_i·(2f)^α·ΔB^β… derived by hand", () => {
  // Triangle flux, 50 % duty: |dB/dt| = 2·ΔB·f everywhere, so
  // Pv = k_i·(2ΔBf)^α·ΔB^(β−α) = k_i·2^α·f^α·ΔB^β, with k_i from its own integral.
  const m = material("3C95");
  const f = 100e3, dB = 0.2, N = 4096;
  const b = sample(N, (u) => (u < 0.5 ? -dB / 2 + 2 * dB * u : dB / 2 - 2 * dB * (u - 0.5)));
  let integ = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) integ += Math.abs(Math.cos(((i + 0.5) * 2 * Math.PI) / n)) ** m.alpha;
  integ *= ((2 * Math.PI) / n) * 2 ** (m.beta - m.alpha);
  const ki = m.k / ((2 * Math.PI) ** (m.alpha - 1) * integ);
  near(igse(m, b, 1 / f), ki * 2 ** m.alpha * f ** m.alpha * dB ** m.beta, 0.003);
});

test("N87 Steinmetz fit sits on the datasheet at 100 °C (two independent points)", () => {
  const m = material("N87");
  near(steinmetz(m, 100e3, 0.2), 375e3, 0.15, "100 kHz / 200 mT");
  near(steinmetz(m, 300e3, 0.1), 300e3, 0.15, "300 kHz / 100 mT");
});

test("le from the dimensions agrees with the catalogue within 5 % for every E core", () => {
  for (const c of CORES.filter((x) => x.family === "E")) {
    for (const set of ["E+PLT", "E+E"] as const) {
      const cat = coreInfo(c.id, set).le;
      const yoke = c.B - c.E, hw = set === "E+PLT" ? c.E : 2 * c.E, plate = set === "E+PLT" ? c.tp : yoke;
      const x = c.F / 2 + (c.D - c.F) / 2 + (c.A - c.D) / 4;
      const computed = 0.87 * 2 * (x + hw + yoke / 2 + plate / 2);
      near(computed, cat, 0.05, `${c.id} ${set}`);
    }
  }
});

test("ER cores: Ae is the round centre leg", () => {
  const e = coreInfo("ER18", "E+PLT");
  near(e.Ae, (Math.PI * 6.2 ** 2) / 4, 1e-9);
  assert.equal(e.source, "computed");
});

test("turn length of an E-core turn: rounded rectangle perimeter", () => {
  const e = coreInfo("E22", "E+PLT");
  near(turnLength(e, 1), 2 * 5 + 2 * 15.8 + 2 * Math.PI * 1, 1e-12);
});

test("gap: no fringing limit and round trip", () => {
  // With μ → ∞ and lg ≪ √Ae the textbook L = μ0·N²·Ae/lg holds (fringing → 1 as lg → 0).
  const L = inductance(10, 100, 30, 1e9, 1e-4, 3);
  near(L, (MU0 * 100 * 100e-6) / 1e-7, 0.01);
  const lg = gapFor(20e-6, 12, 78.5, 26.1, 2200, 3.2)!;
  near(inductance(12, 78.5, 26.1, 2200, lg, 3.2), 20e-6, 1e-6);
  // Fringing makes the needed gap larger than the no-fringing estimate.
  assert.ok(lg > MU0 * 144 * 78.5e-6 / 20e-6 * 1e3 - 26.1 / 2200);
});

/** Finite-difference solution of H'' = j·2/δ²·H across a foil, H(0)=H1, H(h)=H2 → ρ∫|dH/dx|² dx. */
function fdLoss(h: number, delta: number, H1: number, H2: number, rho: number): number {
  const N = 6000, dx = h / N;
  const k2 = 2 / (delta * delta); // imaginary part of k²
  // Thomas algorithm on complex numbers: a·H(i−1) + b·H(i) + c·H(i+1) = 0
  const n = N - 1;
  const cr = new Float64Array(n), ci = new Float64Array(n), dr = new Float64Array(n), di = new Float64Array(n);
  const bRe = -2 / (dx * dx), bIm = -k2;
  const a = 1 / (dx * dx);
  let pr = bRe, pi = bIm;
  for (let i = 0; i < n; i++) {
    // rhs
    let rr = i === 0 ? -a * H1 : 0;
    if (i === n - 1) rr -= a * H2;
    let ri = 0;
    if (i > 0) {
      // b' = b − a·c'(i−1); d' = d − a·d'(i−1)
      pr = bRe - a * cr[i - 1]; pi = bIm - a * ci[i - 1];
      rr -= a * dr[i - 1]; ri -= a * di[i - 1];
    } else { pr = bRe; pi = bIm; }
    const den = pr * pr + pi * pi;
    const cUp = i === n - 1 ? 0 : a; // the last row has no unknown above it: H2 is already in the rhs
    cr[i] = (cUp * pr) / den; ci[i] = (-cUp * pi) / den;
    dr[i] = (rr * pr + ri * pi) / den; di[i] = (ri * pr - rr * pi) / den;
  }
  const Hr = new Float64Array(N + 1), Hi = new Float64Array(N + 1);
  Hr[0] = H1; Hr[N] = H2;
  for (let i = n - 1; i >= 0; i--) {
    const nr = i === n - 1 ? H2 : Hr[i + 2], ni = i === n - 1 ? 0 : Hi[i + 2];
    Hr[i + 1] = dr[i] - (cr[i] * nr - ci[i] * ni);
    Hi[i + 1] = di[i] - (cr[i] * ni + ci[i] * nr);
  }
  let s = 0;
  for (let i = 0; i < N; i++) {
    const jr = (Hr[i + 1] - Hr[i]) / dx, ji = (Hi[i + 1] - Hi[i]) / dx;
    s += (jr * jr + ji * ji) * dx;
  }
  return rho * s;
}

test("Dowell/Ferreira layer loss matches a finite-difference field solution", () => {
  const rho = rhoCu(20), f = 500e3, delta = skinDepth(rho, f);
  for (const [hOverDelta, H1, H2] of [[0.5, 0, 100], [1.5, 0, 100], [3, 40, 100], [2, -60, 60]] as const) {
    const h = hOverDelta * delta;
    const [dg1, dg2] = dowellG(hOverDelta);
    // per unit area: (ρ/δ)·[(H1²+H2²)·G1 − 4·H1·H2·G2], with dg = Δ·G
    const formula = (rho / delta) * ((H1 * H1 + H2 * H2) * dg1 - 4 * H1 * H2 * dg2) / hOverDelta;
    near(formula, fdLoss(h, delta, H1, H2, rho), 0.003, `h/δ=${hOverDelta} H=${H1},${H2}`);
  }
});

test("Dowell: textbook two-layer average Fr at Δ = 1 is 1.41", () => {
  // Dowell's chart / Fr(p) = Δ[ς1 + (2/3)(p²−1)ς2] for p = 2 gives 1.406.
  near((dowellFr(1, 1) + dowellFr(1, 2)) / 2, 1.406, 0.002);
  near(dowellFr(1e-4, 3), 1, 1e-6);
});

function layer(over: Partial<Layer>): Layer {
  return {
    index: 0, winding: "P", side: "pri", series: 0, copy: 0, parallel: 1, turns: 1, dir: "single",
    oz: "2", hMm: 0.07, pullMm: 0, pullOutMm: 0, widthMm: 10, spaceMm: 0.2, jogMm: 1, offsetsMm: [5], mltMm: 40, porosity: 1, ...over,
  };
}

test("stack loss at DC is I²R; leakage of a P/S pair is μ0·MLT/b·(2h/3 + d)", () => {
  const core = { ...coreInfo("E32", "E+PLT"), window: 10 };
  const L1 = layer({ index: 0 }), L2 = layer({ index: 1, winding: "S", side: "sec" });
  const harm = { P: [{ re: 3, im: 0 }], S: [{ re: -3, im: 0 }] };
  const r = stackLoss(core, [L1, L2], harm, 100e3, 20, 0);
  const R = (rhoCu(20) * 0.04) / (10e-3 * 0.07e-3);
  near(r.total, 2 * 9 * R, 1e-9);
  const lk = leakage(core, [L1, L2], [0.2], { P: 1, S: -1 });
  near(lk, (MU0 * 0.04 / 10e-3) * ((2 * 0.07e-3) / 3 + 0.2e-3), 1e-9);
});

test("harmonic rms phasors add up to the waveform rms", () => {
  const x = sample(512, (u) => (u < 0.3 ? 2 + 5 * u : 0));
  const h = harmonics(x, 200);
  near(Math.sqrt(h.reduce((a, c) => a + c.re * c.re + c.im * c.im, 0)), rms(x), 0.002);
});

test("isolation and thermal screening rules", () => {
  const r = isolation("reinforced", 250);
  assert.equal(r.dtiMm, 0.4);
  near(r.creepMm, 5.0, 1e-9);
  near(interp([0, 10], [0, 100], 2.5), 25, 1e-12);
  // 1 W over 10 cm² → (100 mW/cm²)^0.833 = 46.4 °C
  near(tempRise(1, 1000), 100 ** 0.833, 1e-9);
});
