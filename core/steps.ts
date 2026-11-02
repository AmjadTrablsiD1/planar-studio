// The design path as data: every step names its formula, puts the numbers in,
// states the result and says why that value was chosen. The Design steps
// view, the inspector's ⓘ buttons and the report all render this, so the
// explanation can never drift from the numbers. Formulas use core/math.ts.

import { C, MM } from "./constants.ts";
import { fmt, si, pct } from "./format.ts";
import type { Design } from "./design.ts";
import { skinDepth, rhoCu } from "./winding.ts";
import { steinmetzAt } from "./materials.ts";
import type { Step } from "./topologies/index.ts";

export type Section = { title: string; steps: Step[] };

export function designSteps(d: Design): Section[] {
  const s = d.spec, m = d.mag, core = m.core;
  const pout = s.vout * s.iout;
  const out: Section[] = [];
  const st = steinmetzAt(m.mat, s.fsw);
  const oz = d.choice.oz as keyof typeof C.pcb.min_space_mm;

  out.push({
    title: "1 · Requirements",
    steps: [
      { id: "power", title: "Power", formula: "P_{out} = V_{out} I_{out}, \\; P_{in} = \\frac{P_{out}}{\\eta}",
        result: `P_{out} = ${si(pout, "W")}, P_{in} = ${si(pout / s.eta, "W")} (\\eta = ${fmt(s.eta)})`,
        why: "\\eta is the whole converter's efficiency (your input); it only sets how much power the primary carries. The transformer's own loss is worked out below." },
      { id: "oppoint", title: "Operating point for losses",
        formula: "P_{loss} \\text{ at } V_{in,op}, \\; \\hat{B} \\text{ checked at } V_{in,min}, V_{in,nom}, V_{in,max}",
        result: `V_{in,op} = ${si(m.op.vin, "V")} (${s.operatingPoint}), ${si(s.fsw, "Hz")}, ${m.op.mode}`,
        why: "Losses and temperature are worked out where the converter spends its time (Search → Losses at). Saturation is a worst-case limit, so the peak flux is checked at every line voltage." },
    ],
  });

  out.push({ title: `2 · ${m.topo.label}: ratio and inductance`, steps: m.topo.steps(s, m.np, m.ns, m.lm) });

  const flux: Step[] = [
    { id: "core", title: "Core and ferrite", formula: "A_e, \\; A_{min}, \\; l_e, \\; V_e \\text{ (datasheet)}",
      result: `${core.name}, ${d.choice.set}, ${m.mat.vendor} ${m.mat.id}: A_e = ${fmt(core.Ae)} mm², A_{min} = ${fmt(core.Amin)} mm², l_e = ${fmt(core.le)} mm, V_e = ${fmt(core.Ve / 1000)} cm³`,
      why: `Objective “${C.optimiser.objective_labels[s.objective]}”: of every core × ferrite × turns × stack-up that passes all checks, this one ranks first. ${m.mat.id} is rated ${si(m.mat.f_min, "Hz")}–${si(m.mat.f_max, "Hz")}, which covers f_{sw}. “Why this design” compares it with its neighbours.`,
      where: [["A_e", "effective cross-section"], ["A_{min}", "narrowest cross-section, where saturation starts"], ["l_e", "effective magnetic path"], ["V_e", "effective volume (core loss scales with it)"]] },
    { id: "flux", title: "Flux density from the winding currents",
      formula: "B(t) = \\frac{L_m i_m(t)}{N_p A_e}, \\; i_m = \\frac{\\sum N_k i_k}{N_p}, \\; \\hat{B}_{min} = \\hat{B} \\frac{A_e}{A_{min}} \\le k_{sat} B_{sat}",
      result: `\\Delta B = ${si(m.dBpp, "T")} p-p, \\hat{B} = ${si(m.bPk, "T")} at ${si(m.op.vin, "V")}; worst ${si(m.bPkAmin, "T")} in A_{min} at ${si(m.vinWorst, "V")}, limit ${si(m.bMax, "T")}`,
      why: `N_p = ${m.np} keeps \\hat{B} under ${C.magnetics.bsat_margin} × B_{sat} (${si(m.mat.bsat_T, "T")} at 100 °C) at the worst line voltage. More turns would lower the flux and the core loss but add copper loss; the turn count with the lowest total won.`,
      where: [["i_m", "magnetising current: the net ampere-turns of all windings over N_p"], ["k_{sat}", `saturation margin, ${C.magnetics.bsat_margin}`]] },
  ];
  if (m.topo.gapped && m.gapMm !== null) {
    flux.push({ id: "gap", title: "Air gap with fringing",
      formula: "L_m = \\frac{\\mu_0 N_p^2 A_e F}{l_g + l_e/\\mu_i}, \\; F = 1 + \\frac{l_g}{\\sqrt{A_e}} \\ln\\frac{2 h_w}{l_g}",
      result: `l_g = ${fmt(m.gapMm)} mm (F = ${fmt(m.fringe)}) → L_m = ${si(m.lm, "H")}`,
      why: `The gap is solved so that ${m.np} turns give exactly the L_m of step 2. Fringing (F > 1) makes the real gap larger than the textbook \\mu_0 N^2 A_e / L. ${d.choice.set === "E+E" ? "Grind the centre leg and split the gap between both halves." : "Grind the E centre leg; the plate stays flat."}`,
      where: [["l_g", "centre-leg gap"], ["F", "McLyman fringing factor"], ["h_w", "window height"], ["\\mu_i", `initial permeability of ${m.mat.id}`]] });
  } else {
    flux.push({ id: "gap", title: "Magnetising inductance (ungapped)", formula: "L_m = \\frac{\\mu_0 N_p^2 A_e}{l_e/\\mu_i + l_{res}}",
      result: `L_m = ${si(m.lm, "H")} with a ${fmt(C.magnetics.residual_gap_mm * 1000)} µm residual gap`,
      why: "This topology passes energy straight through, so no gap is wanted: a high L_m keeps the magnetising current, and its loss, small. l_{res} is what two ground mating faces behave like." });
  }
  flux.push({ id: "coreloss", title: "Core loss (iGSE on the real flux waveform)",
    formula: "P_v = \\frac{1}{T} \\int_0^T k_i \\left|\\frac{dB}{dt}\\right|^{\\alpha} (\\Delta B)^{\\beta-\\alpha} dt, \\; P_{core} = P_v V_e",
    result: `P_v = ${fmt(m.pv / 1e6, 3)} W/cm³ → P_{core} = ${si(m.pCore, "W")}`,
    why: `The iGSE weights the real, non-sinusoidal flux waveform; for a sine it reduces to Steinmetz k f^{\\alpha} \\hat{B}^{\\beta}. ${m.mat.id} at ${si(s.fsw, "Hz")}: local \\alpha = ${fmt(st.alpha)} from the datasheet loss points either side of f_{sw}, \\beta = ${fmt(st.beta)} (${m.mat.beta_source}). Typical values at 100 °C.`,
    where: [["k_i", "k / ((2π)^{α−1} ∫|cos θ|^{α} 2^{β−α} dθ)"], ["\\alpha, \\beta", "Steinmetz exponents of frequency and flux"]] });
  out.push({ title: "3 · Core, turns, gap and core loss", steps: flux });

  const plan = d.choice.plan.map((p) => {
    const ls = d.layers.filter((l) => l.winding === p.winding);
    return `${p.winding}: ${p.layers} layers = ${p.series} in series × ${p.parallel} in parallel, turns/layer ${[...new Set(ls.map((l) => l.turns))].join("/")}`;
  });
  const l0 = d.layers[0];
  const multi = d.layers.find((l) => l.turns > 1);
  const ring = d.layers.some((l) => l.pullMm > C.pcb.cutout_clearance_mm + C.pcb.copper_pullback_mm + 1e-9);
  out.push({
    title: "4 · Layer stack",
    steps: [
      { id: "stack", title: "Stack order (top → bottom)", formula: `\\text{${C.optimiser.pattern_labels[d.choice.pattern]}}`,
        result: d.order.map((w, i) => `L${i + 1} ${w}`).join(" · "),
        note: plan.join("; ") + (s.singleTurnLayers ? "" : ". Single-turn layers avoided."),
        why: "Series layers add turns, parallel layers add copper for current. Interleaving P and S keeps the ampere-turns between layers small, which lowers proximity loss and leakage but adds P–S interfaces (capacitance, isolation layers). The arrangement with the lowest total loss that fits the window won." },
      { id: "width", title: "Trace width per layer", formula: "w = \\frac{b - p_{in} - p_{out} - (t-1) s}{t}, \\; b = \\frac{D - F}{2}",
        result: `b = ${fmt(core.window)} mm, p_{in} = ${fmt(l0.pullMm)} mm, p_{out} = ${fmt(l0.pullOutMm)} mm; widths ${[...new Set(d.layers.map((l) => fmt(l.widthMm)))].join(" / ")} mm`,
        why: `The turns of a layer share the window breadth equally. ${multi ? `The gap s is widened to ${fmt(multi.spaceMm)} mm so the step between turns still keeps the ` : "The fab minimum gap is "}${C.pcb.min_space_mm[oz]} mm for ${d.choice.oz} oz copper; the keep-backs leave room for the core cut-outs${ring ? " and the via ring inside the innermost turn" : ""}.`,
        where: [["b", "window breadth"], ["t", "turns on the layer"], ["p_{in}, p_{out}", "copper keep-back at the centre and outer leg"], ["s", "turn-to-turn gap"]] },
      { id: "board", title: "Board thickness", formula: "t_{pcb} = \\sum h_{cu} + \\sum d + 2 t_{mask} \\le h_w - 2c",
        result: `${fmt(d.boardMm)} mm in a ${fmt(core.hw)} mm window (${d.choice.layers} × ${d.choice.oz} oz)`,
        why: "The whole board has to slide into the window with a little clearance, so more layers or heavier copper only win if they still fit." },
    ],
  });

  const rho = rhoCu(d.copperTempC);
  const delta = skinDepth(rho, s.fsw);
  const wsteps: Step[] = [
    { id: "skin", title: "Skin depth at f_{sw}", formula: "\\delta = \\sqrt{\\frac{\\rho}{\\pi f \\mu_0}}",
      result: `\\delta = ${fmt((delta / MM) * 1000)} µm at ${fmt(d.copperTempC)} °C; copper ${fmt(l0.hMm * 1000)} µm → h/\\delta = ${fmt((l0.hMm * MM) / delta)}`,
      why: `Copper much thicker than \\delta carries current only near its faces. ${d.choice.oz} oz won because, at this h/\\delta, its lower DC resistance outweighs the extra AC loss.` },
    { id: "layerloss", title: "Layer loss (Dowell/Ferreira, every harmonic)",
      formula: "P = R_F \\Delta' \\left[ (|F_1|^2 + |F_2|^2) G_1 - 4 \\, \\text{Re}(F_1 F_2^*) G_2 \\right], \\; \\Delta' = \\frac{h}{\\delta}\\sqrt{\\eta}",
      result: Object.entries(d.copper.byWinding).map(([w, b]) => `${w}: I_{rms} ${si(b.irms, "A")}, R_{dc} ${si(b.rdc, "Ω")}, R_{ac,eff} ${si(b.rac, "Ω")}, ${si(b.loss, "W")}`).join("; "),
      why: `Summed over ${C.magnetics.harmonics} harmonics of the real current waveform. F_1, F_2 are the ampere-turns on the two faces of a layer: interleaving keeps them small and of opposite sign, which is why it lowers the loss.`,
      where: [["R_F", "layer DC resistance per (ampere-turn)²"], ["G_1, G_2", "Dowell functions of \\Delta'"], ["\\eta", "copper fraction of the window breadth"]] },
    { id: "leakage", title: "Leakage inductance (referred to the primary)",
      formula: "L_{lk} = \\frac{\\mu_0 MLT}{b} \\cdot \\frac{\\sum h (F_1^2 + F_1 F_2 + F_2^2)/3 + \\sum d F^2}{I_p^2}",
      result: `L_{lk} = ${si(d.leakage, "H")}`,
      why: s.topology === "llc" ? "Usable as part of the resonant inductor L_r." : "Sets the switch-node spike and the clamp loss; interleaving lowers it." },
    { id: "cps", title: "Primary–secondary capacitance", formula: "C_{ps} = \\sum \\frac{\\varepsilon_0 \\varepsilon_r A}{d}",
      result: `C_{ps} = ${si(d.cps, "F")} over ${d.capPairs.length} interface(s)`,
      why: "The common-mode noise path through the transformer: each P–S interface adds to it, so interleaving trades capacitance for leakage." },
  ];
  out.push({ title: "5 · Copper loss, leakage and capacitance", steps: wsteps });

  out.push({
    title: "6 · Isolation and temperature",
    steps: [
      { id: "iso", title: "Insulation through the board", formula: "d \\ge \\max\\left(\\frac{\\sqrt{2} V_{test}}{E_{bd} k}, DTI\\right)",
        result: `${s.insulation}, ${si(s.vWork, "V")} working: V_{test} = ${fmt(d.iso.testVrms)} Vrms → every P–S dielectric ≥ ${fmt(d.iso.layerMm)} mm`,
        why: `Your insulation class and working voltage set the hipot test voltage; the laminate (E_{bd} = ${C.pcb.breakdown_kV_per_mm} kV/mm, derated by k = ${C.isolation.breakdown_derating}) must hold it, and reinforced insulation also needs ${C.isolation.dti_min_mm.reinforced} mm distance through insulation.` },
      { id: "creepage", title: "Creepage (ferrite counts as conductive)", formula: "2 p + t_{pcb} \\ge creepage(V_{work})",
        result: `${fmt(d.iso.creepMm)} mm: outer-layer keep-back ${fmt(d.layers[0].pullMm)} mm, terminals ${fmt(d.terminalMm)} mm from the windings`,
        why: "IEC 60664-1, pollution degree 2, material group III. MnZn ferrite conducts, so a path from primary copper over the core to secondary copper counts." },
      { id: "thermal", title: "Temperature rise", formula: "\\Delta T = \\left(\\frac{P \\, [mW]}{A \\, [cm^2]}\\right)^{0.833}",
        result: `P = ${si(d.pTotal, "W")} (${pct(d.lossPct)} of P_{out}) over ${fmt(d.areaMm2 / 100)} cm² → \\Delta T ≈ ${fmt(d.dT)} °C`,
        why: `Natural convection from the core surface plus ${Math.round(C.thermal.pcb_area_credit * 100)} % credit for the board around it. Copper resistance is evaluated at the resulting temperature (iterated).` },
    ],
  });
  return out;
}

/** The fabrication stack-up as rows, for the report and the Layers view. */
export function stackupRows(d: Design): { name: string; kind: string; thick: number; detail: string }[] {
  const rows: { name: string; kind: string; thick: number; detail: string }[] = [];
  rows.push({ name: "Top mask", kind: "mask", thick: C.pcb.soldermask_mm, detail: "" });
  for (const [i, l] of d.layers.entries()) {
    rows.push({
      name: `L${i + 1}`, kind: "copper", thick: l.hMm,
      detail: `${l.winding} · ${l.turns} turn${l.turns > 1 ? "s" : ""} × ${fmt(l.widthMm)} mm · series ${l.series + 1}${l.parallel > 1 ? `, copy ${l.copy + 1}/${l.parallel}` : ""}`,
    });
    if (i < d.diel.length) {
      const cross = l.side !== d.layers[i + 1].side;
      rows.push({ name: cross ? "Isolation" : "Dielectric", kind: cross ? "iso" : "diel", thick: d.diel[i], detail: cross ? "P–S barrier" : "" });
    }
  }
  rows.push({ name: "Bottom mask", kind: "mask", thick: C.pcb.soldermask_mm, detail: "" });
  return rows;
}
