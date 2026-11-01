// evaluate(spec, choice) → one complete Design: every number the interface
// shows and every check, as plain data. Split into a magnetic stage (core,
// turns, gap, flux, core loss, current harmonics) and a winding stage (stack,
// copper loss, leakage, isolation, thermal) so the optimiser can reuse the
// first across hundreds of stack-ups.

import { C, MM } from "./constants.ts";
import { boardHalf, coreInfo, type CoreInfo } from "./cores.ts";
import { gapFor, fringing, inductance } from "./gap.ts";
import { igse, material, type Material } from "./materials.ts";
import { topology, type Topology } from "./topologies/index.ts";
import { harmonics, minmax, rms, type Complex } from "./waveform.ts";
import { boardThickness, buildLayers, dielectrics, junctions, stackOrder } from "./stack.ts";
import { interwinding, leakage, stackLoss, type StackLoss } from "./winding.ts";
import { isolation, tempRise, type Isolation } from "./checks.ts";
import { viaChecks } from "./geometry.ts";
import type { Check, Choice, CoreSet, Layer, Operation, Spec, WindingDef, WindingPlan } from "./types.ts";

export type Magnetic = {
  core: CoreInfo;
  mat: Material;
  topo: Topology;
  defs: WindingDef[];
  np: number; ns: number;
  n: number; nTarget: number;
  lm: number; lmTarget: number;
  gapMm: number | null;
  fringe: number;
  op: Operation;
  b: Float64Array;
  bPk: number; bPkWorst: number; vinWorst: number; dBpp: number; bMax: number;
  pv: number; pCore: number;
  harm: Record<string, Complex[]>;
  irms: Record<string, number>;
  checks: Check[];
};

export function vinAt(s: Spec, p: Spec["operatingPoint"]): number {
  return p === "min" ? s.vinMin : p === "max" ? s.vinMax : s.vinNom;
}

function turnsOf(defs: WindingDef[], np: number, ns: number): Record<string, number> {
  return Object.fromEntries(defs.map((d) => [d.id, d.turns === "P" ? np : ns]));
}

/** Flux density waveform (T) from the winding currents: B = Lm·(Σ N·i / Np) / (Np·Ae). */
function fluxOf(op: Operation, turns: Record<string, number>, lm: number, np: number, aeMm2: number): Float64Array {
  const n = op.vPri.length;
  const b = new Float64Array(n);
  for (const [w, i] of Object.entries(op.currents)) for (let k = 0; k < n; k++) b[k] += turns[w] * i[k];
  const kB = lm / (np * np * aeMm2 * MM * MM);
  for (let k = 0; k < n; k++) b[k] *= kB;
  return b;
}

export function magnetic(s: Spec, coreId: string, set: CoreSet, matId: string, np: number, ns: number): Magnetic {
  const core = coreInfo(coreId, set);
  const mat = material(matId);
  const topo = topology(s.topology);
  const defs = topo.windings(s);
  const turns = turnsOf(defs, np, ns);
  const checks: Check[] = [];
  const nTarget = topo.ratio(s);
  const n = np / ns;
  const tol = C.optimiser.ratio_tol[s.topology];
  const err = n / nTarget - 1;
  checks.push({
    id: "ratio", label: "Turns ratio", ok: Math.abs(err) <= tol, severity: Math.abs(err) <= tol ? "info" : "fail",
    value: n, limit: nTarget, unit: "",
    detail: `Np:Ns = ${np}:${ns} = ${n.toFixed(3)} against the target ${nTarget.toFixed(3)} (${(err * 100).toFixed(1)} %, allowed ±${(tol * 100).toFixed(0)} %).`,
  });

  const mu = mat.mu_i;
  let lm: number, gapMm: number | null, lmTarget: number;
  if (topo.gapped) {
    lmTarget = topo.lmTarget(s, np, ns);
    gapMm = gapFor(lmTarget, np, core.Ae, core.le, mu, core.hw);
    if (gapMm === null) {
      lm = inductance(np, core.Ae, core.le, mu, C.magnetics.residual_gap_mm, core.hw);
      checks.push({ id: "gap", label: "Air gap", ok: false, severity: "fail", value: lm, limit: lmTarget, unit: "H",
        detail: `Even without a gap ${np} turns give only ${(lm * 1e6).toFixed(1)} µH; ${(lmTarget * 1e6).toFixed(1)} µH needs more turns or a larger core.` });
    } else {
      gapMm = Math.max(C.magnetics.residual_gap_mm, Math.round(gapMm / C.magnetics.gap_round_mm) * C.magnetics.gap_round_mm);
      lm = inductance(np, core.Ae, core.le, mu, gapMm, core.hw);
      const atMax = gapMm >= C.magnetics.gap_max_mm - 1e-9;
      checks.push({ id: "gap", label: "Air gap", ok: !atMax, severity: atMax ? "fail" : "info", value: gapMm, limit: C.magnetics.gap_max_mm, unit: "mm",
        detail: atMax ? "The gap would exceed the practical limit; add turns or use a larger core." : `Centre-leg gap ${gapMm.toFixed(2)} mm (fringing factor ${fringing(gapMm, core.Ae, core.hw).toFixed(2)}).` });
    }
  } else {
    lmTarget = Infinity;
    gapMm = null;
    lm = inductance(np, core.Ae, core.le, mu, C.magnetics.residual_gap_mm, core.hw);
  }

  const N = C.magnetics.samples_per_period;
  const op = topo.operate(s, np, ns, lm, vinAt(s, s.operatingPoint), N);
  const b = fluxOf(op, turns, lm, np, core.Ae);
  const [lo, hi] = minmax(b);
  let bPkWorst = Math.max(Math.abs(lo), Math.abs(hi)), vinWorst = op.vin;
  for (const v of [s.vinMin, s.vinNom, s.vinMax]) {
    if (v === op.vin) continue;
    // A coarser grid is enough for a peak, made conservative by half the largest step between samples.
    const o = topo.operate(s, np, ns, lm, v, N / 4);
    const bw = fluxOf(o, turns, lm, np, core.Ae);
    const [l2, h2] = minmax(bw);
    let step = 0;
    for (let k = 0; k < bw.length; k++) step = Math.max(step, Math.abs(bw[(k + 1) % bw.length] - bw[k]));
    const pk = Math.max(Math.abs(l2), Math.abs(h2)) + step / 2;
    if (pk > bPkWorst) { bPkWorst = pk; vinWorst = v; }
  }
  const bMax = mat.bsat_T * C.magnetics.bsat_margin;
  checks.push({
    id: "flux", label: "Peak flux", ok: bPkWorst <= bMax, severity: bPkWorst <= bMax ? "info" : "fail",
    value: bPkWorst, limit: bMax, unit: "T",
    detail: `B̂ = ${(bPkWorst * 1000).toFixed(0)} mT at ${vinWorst} V against ${(bMax * 1000).toFixed(0)} mT (${C.magnetics.bsat_margin} × Bsat ${(mat.bsat_T * 1000).toFixed(0)} mT at 100 °C).`,
  });

  const dLimit = s.topology === "flyback" ? 0.95 : s.topology === "forward" ? s.dMax + 0.05 : s.topology === "fullbridge" ? 0.98 : 1;
  const dLow = op.vin === s.vinMin ? op.duty : topo.operate(s, np, ns, lm, s.vinMin, 64).duty;
  checks.push({
    id: "duty", label: "Duty at low line", ok: dLow <= dLimit, severity: dLow <= dLimit ? "info" : "fail",
    value: dLow, limit: dLimit, unit: "",
    detail: `D = ${dLow.toFixed(2)} at ${s.vinMin} V (${op.mode} at the operating point).`,
  });

  const pv = igse(mat, b, 1 / s.fsw);
  const harm: Record<string, Complex[]> = {};
  const irms: Record<string, number> = {};
  for (const [w, i] of Object.entries(op.currents)) {
    harm[w] = harmonics(i, C.magnetics.harmonics);
    irms[w] = rms(i);
  }
  return {
    core, mat, topo, defs, np, ns, n, nTarget, lm, lmTarget, gapMm,
    fringe: gapMm === null ? 1 : fringing(gapMm, core.Ae, core.hw),
    op, b, bPk: Math.max(Math.abs(lo), Math.abs(hi)), bPkWorst, vinWorst, dBpp: hi - lo, bMax,
    pv, pCore: pv * core.Ve * MM * MM * MM, harm, irms, checks,
  };
}

export type Design = {
  spec: Spec;
  choice: Choice;
  feasible: boolean;
  score: number;
  mag: Magnetic;
  order: string[];
  layers: Layer[];
  diel: number[];
  boardMm: number;
  iso: Isolation;
  outerPullMm: number;
  terminalMm: number;
  viaGapMm: number;
  copper: StackLoss;
  copperTempC: number;
  dT: number;
  areaMm2: number;
  leakage: number;
  cps: number;
  capPairs: { a: number; b: number; c: number }[];
  pCopper: number;
  pTotal: number;
  lossPct: number;
  checks: Check[];
};

/** The winding stage: stack-up, copper loss, thermal and isolation for one magnetic design. */
export function windingStage(s: Spec, m: Magnetic, choice: Choice, iterations: number = C.thermal.iterations): Design {
  const counts = Object.fromEntries(choice.plan.map((p) => [p.winding, p.layers]));
  const order = stackOrder(m.defs, counts, choice.pattern);
  const iso = isolation(s.insulation, s.vWork);
  const turns = turnsOf(m.defs, m.np, m.ns);

  // First pass without the outer keep-back, to know the board thickness.
  // Junction vias: an inner one needs a free ring inside the innermost turn; one that
  // passes the other side's layers keeps the isolation distance in the plane too.
  const junc = junctions(m.defs, choice.plan, order, turns);
  const space = C.pcb.min_space_mm[choice.oz as keyof typeof C.pcb.min_space_mm];
  const viaGap = Math.max(C.pcb.via_clearance_mm, space, junc.some((j) => j.crossesSide) ? iso.layerMm : 0);
  const ringPullMm = junc.some((j) => j.inner)
    ? C.pcb.cutout_clearance_mm + C.pcb.copper_pullback_mm + C.pcb.via_pad_mm + viaGap : 0;
  const build = (outer: number) => buildLayers({ core: m.core, defs: m.defs, plans: choice.plan, turnsOf: turns, order, oz: choice.oz, outerPullMm: outer, ringPullMm });
  let layers = build(0);
  const diel = dielectrics(layers, s.dielectric, iso.layerMm);
  const boardMm = boardThickness(layers, diel);
  const basePull = C.pcb.cutout_clearance_mm + C.pcb.copper_pullback_mm;
  const outerCross = layers[0].side !== layers[layers.length - 1].side;
  const outerPullMm = outerCross ? Math.max(0, (iso.creepMm - boardMm) / 2 - basePull) : 0;
  if (outerPullMm > 0) layers = build(outerPullMm);
  const terminalMm = Math.max(C.pcb.terminal_length_mm, iso.creepMm + C.pcb.terminal_pad_mm);

  const gapPlane = choice.set === "E+PLT" ? 0 : Math.floor(layers.length / 2);
  const [bx, by] = boardHalf(m.core, terminalMm);
  const areaMm2 = m.core.surface + C.thermal.pcb_area_credit * 2 * (4 * bx * by - m.core.A * m.core.Cd);
  let tC = s.tAmb + s.dTMax / 2;
  let copper = stackLoss(m.core, layers, m.harm, s.fsw, tC, gapPlane);
  let dT = 0;
  for (let i = 0; i < iterations; i++) {
    dT = tempRise(m.pCore + copper.total, areaMm2);
    tC = s.tAmb + dT;
    copper = stackLoss(m.core, layers, m.harm, s.fsw, tC, gapPlane);
  }
  dT = tempRise(m.pCore + copper.total, areaMm2);

  const pri = m.defs.find((d) => d.side === "pri")!.id;
  const sec = m.defs.find((d) => d.side === "sec")!.id;
  const lk = leakage(m.core, layers, diel, { [pri]: 1, [sec]: -m.np / m.ns });
  const cap = interwinding(layers, diel);

  const checks: Check[] = [...m.checks];
  const fit = boardMm + 2 * C.pcb.core_vertical_clearance_mm;
  checks.push({
    id: "window", label: "Board fits the window", ok: fit <= m.core.hw, severity: fit <= m.core.hw ? "info" : "fail",
    value: fit, limit: m.core.hw, unit: "mm",
    detail: `${layers.length}-layer stack ${boardMm.toFixed(2)} mm + clearance in a ${m.core.hw.toFixed(2)} mm window (${choice.set}).`,
  });
  const minW = Math.min(...layers.map((l) => l.widthMm));
  const minTrace = C.pcb.min_trace_mm[choice.oz as keyof typeof C.pcb.min_trace_mm];
  checks.push({
    id: "trace", label: "Narrowest trace", ok: minW >= minTrace, severity: minW >= minTrace ? "info" : "fail",
    value: minW, limit: minTrace, unit: "mm",
    detail: `${minW.toFixed(2)} mm against the ${choice.oz} oz fabrication minimum ${minTrace} mm.`,
  });
  checks.push({
    id: "thermal", label: "Temperature rise", ok: dT <= s.dTMax, severity: dT <= s.dTMax ? "info" : "fail",
    value: dT, limit: s.dTMax, unit: "°C",
    detail: `ΔT ≈ ${dT.toFixed(0)} °C for ${(m.pCore + copper.total).toFixed(2)} W over ${(areaMm2 / 100).toFixed(1)} cm² (natural convection; core at ${(s.tAmb + dT).toFixed(0)} °C).`,
  });
  const jMax = Math.max(...copper.layers.map((r) => r.jRms));
  const jLim = C.optimiser.current_density_warn_A_mm2;
  checks.push({
    id: "density", label: "Current density", ok: true, severity: jMax > jLim ? "warn" : "info",
    value: jMax, limit: jLim, unit: "A/mm²",
    detail: `Highest rms density ${jMax.toFixed(1)} A/mm²${jMax > jLim ? " — terminations and vias will run hot" : ""}.`,
  });
  checks.push({
    id: "dti", label: "P–S insulation", ok: true, severity: "info", value: iso.layerMm, limit: iso.layerMm, unit: "mm",
    detail: `${s.insulation}: ${iso.testVrms.toFixed(0)} Vrms test → ≥ ${iso.strengthMm.toFixed(2)} mm by strength, ${iso.dtiMm} mm DTI floor; every P–S dielectric is set to ${iso.layerMm.toFixed(2)} mm.`,
  });
  const creepPath = outerCross ? 2 * (basePull + outerPullMm) + boardMm : Infinity;
  checks.push({
    id: "creepage", label: "Creepage via the core", ok: true, severity: "info", value: outerCross ? creepPath : 0, limit: iso.creepMm, unit: "mm",
    detail: outerCross
      ? `Outer layers are on opposite sides; the ferrite counts as conductive, so the outer copper is held back ${(basePull + outerPullMm).toFixed(2)} mm from the cut-outs (path ${creepPath.toFixed(1)} mm ≥ ${iso.creepMm.toFixed(1)} mm). Terminals sit ${terminalMm.toFixed(1)} mm out.`
      : `Both outer layers belong to the same side; terminals sit ${terminalMm.toFixed(1)} mm out for ${iso.creepMm.toFixed(1)} mm creepage.`,
  });
  // The via geometry check is a safety net (vias sit on rings no copper uses); the
  // search skips it and every finalist is re-evaluated with it (iterations > 0).
  if (iterations > 0) checks.push(...viaChecks(m.core, layers, viaGap));

  const pCopper = copper.total;
  const pTotal = m.pCore + pCopper;
  const budget = (s.lossBudget / 100) * s.vout * s.iout;
  checks.push({
    id: "budget", label: "Loss budget", ok: pTotal <= budget, severity: pTotal <= budget ? "info" : "fail",
    value: pTotal, limit: budget, unit: "W",
    detail: `${pTotal.toFixed(2)} W = ${((100 * pTotal) / (s.vout * s.iout)).toFixed(2)} % of Pout against the ${s.lossBudget} % budget.`,
  });
  const feasible = checks.every((c) => c.severity !== "fail");
  const score = s.objective === "size" ? m.core.Ve * 1e3 + pTotal
    : s.objective === "layers" ? layers.length * 1e3 + pTotal
    : pTotal;
  return {
    spec: s, choice, feasible, score, mag: m, order, layers, diel, boardMm, iso, outerPullMm, terminalMm, viaGapMm: viaGap,
    copper, copperTempC: tC, dT, areaMm2, leakage: lk, cps: cap.total, capPairs: cap.pairs,
    pCopper, pTotal, lossPct: pTotal / (s.vout * s.iout), checks,
  };
}

export function evaluate(s: Spec, choice: Choice): Design {
  return windingStage(s, magnetic(s, choice.core, choice.set, choice.material, choice.np, choice.ns), choice);
}

/** Default plan: the primary on half the layers in series, the secondaries share the rest in parallel. */
export function defaultPlan(defs: WindingDef[], layers: number, np: number): WindingPlan[] {
  const secs = defs.filter((d) => d.side === "sec");
  const lp = Math.max(1, Math.floor(layers / (1 + secs.length)));
  const ls = Math.floor((layers - lp) / secs.length);
  const series = np > 1 && lp % 2 === 0 ? 2 : 1;
  return [
    { winding: "P", layers: lp, series, parallel: lp / series },
    ...secs.map((d) => ({ winding: d.id, layers: ls, series: 1, parallel: ls })),
  ];
}
