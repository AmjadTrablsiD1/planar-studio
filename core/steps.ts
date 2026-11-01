// The design path as data: every step names its formula, puts the numbers in,
// and states the result. The Design steps view and the report both render this,
// so the explanation can never drift from the numbers.

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

  out.push({
    title: "1 · Requirements",
    steps: [
      { title: "Power", formula: "Pout = Vout·Iout,  Pin = Pout/η",
        result: `Pout = ${si(pout, "W")}, Pin = ${si(pout / s.eta, "W")} (η = ${fmt(s.eta)})` },
      { title: "Operating point for losses", formula: "losses at Vin,op; peak flux checked at Vin,min, Vin,nom and Vin,max",
        result: `Vin,op = ${si(m.op.vin, "V")} (${s.operatingPoint}), ${si(s.fsw, "Hz")}, ${m.op.mode}` },
    ],
  });

  out.push({ title: `2 · ${m.topo.label}: ratio and inductance`, steps: m.topo.steps(s, m.np, m.ns, m.lm) });

  const flux: Step[] = [
    { title: "Core and ferrite", formula: "smallest core meeting every check (objective: " + C.optimiser.objective_labels[s.objective] + ")",
      result: `${core.name}, ${d.choice.set}, ${m.mat.vendor} ${m.mat.id}: Ae = ${fmt(core.Ae)} mm², le = ${fmt(core.le)} mm, Ve = ${fmt(core.Ve / 1000)} cm³ (${core.source})` },
    { title: "Flux density from the winding currents", formula: "B(t) = Lm·im(t) / (Np·Ae),  im = Σ N·i / Np",
      result: `ΔB = ${si(m.dBpp, "T")} p-p, B̂ = ${si(m.bPk, "T")} at ${si(m.op.vin, "V")}; worst B̂ = ${si(m.bPkWorst, "T")} at ${si(m.vinWorst, "V")}, ${si(m.bPkAmin, "T")} in Amin = ${fmt(core.Amin)} mm²`,
      note: `Limit ${si(m.bMax, "T")} = ${C.magnetics.bsat_margin} × Bsat(100 °C). Np = ${m.np} is the turn count that keeps B̂ under it with the lowest total loss.` },
  ];
  if (m.topo.gapped && m.gapMm !== null) {
    flux.push({ title: "Air gap with fringing", formula: "L = μ0·Np²·Ae·F / (lg + le/μi),  F = 1 + (lg/√Ae)·ln(2·hw/lg)",
      result: `lg = ${fmt(m.gapMm)} mm (F = ${fmt(m.fringe)}) → Lm = ${si(m.lm, "H")}`,
      note: d.choice.set === "E+E" ? "Grind the centre leg; split the gap between both halves." : "Grind the E centre leg; the plate stays flat." });
  } else {
    flux.push({ title: "Magnetising inductance (ungapped)", formula: "Lm = μ0·Np²·Ae / (le/μi + lres)",
      result: `Lm = ${si(m.lm, "H")} with a ${fmt(C.magnetics.residual_gap_mm * 1000)} µm residual gap` });
  }
  flux.push({ title: "Core loss (iGSE on the real flux waveform)", formula: "Pv = (1/T)·∫ ki·|dB/dt|^α·ΔB^(β−α) dt,  Pcore = Pv·Ve",
    result: `Pv = ${fmt(m.pv / 1e6, 3)} W/cm³ → Pcore = ${si(m.pCore, "W")}`,
    note: (() => {
      const st = steinmetzAt(m.mat, s.fsw);
      return `${m.mat.id} at ${si(s.fsw, "Hz")}: local α = ${fmt(st.alpha)} from the datasheet points either side, β = ${fmt(st.beta)} (${m.mat.beta_source}), 100 °C.`;
    })() });
  out.push({ title: "3 · Core, turns, gap and core loss", steps: flux });

  const plan = d.choice.plan.map((p) => {
    const ls = d.layers.filter((l) => l.winding === p.winding);
    return `${p.winding}: ${p.layers} layers = ${p.series} in series × ${p.parallel} in parallel, turns/layer ${[...new Set(ls.map((l) => l.turns))].join("/")}`;
  });
  const l0 = d.layers[0];
  out.push({
    title: "4 · Layer stack",
    steps: [
      { title: "Stack order (top → bottom)", formula: C.optimiser.pattern_labels[d.choice.pattern],
        result: d.order.map((w, i) => `L${i + 1} ${w}`).join(" · "),
        note: plan.join("; ") + (s.singleTurnLayers ? "" : ". Single-turn layers avoided: every winding of two or more turns is a spiral on each of its layers.") },
      { title: "Trace width per layer", formula: "w = (b − 2·pull − (t−1)·s) / t,  b = (D − F)/2",
        result: `b = ${fmt(core.window)} mm, pull = ${fmt(l0.pullMm)} mm; widths ${[...new Set(d.layers.map((l) => fmt(l.widthMm)))].join(" / ")} mm`,
        note: `Gap s widened to ${fmt(d.layers.find((l) => l.turns > 1)?.spaceMm ?? l0.spaceMm)} mm so the diagonal jog keeps the ${C.pcb.min_space_mm[d.choice.oz as keyof typeof C.pcb.min_space_mm]} mm fab minimum.` },
      { title: "Board thickness", formula: "t = Σ copper + Σ dielectric + 2·mask ≤ hw − 2·clearance",
        result: `${fmt(d.boardMm)} mm in a ${fmt(core.hw)} mm window (${d.choice.layers} × ${d.choice.oz} oz)` },
    ],
  });

  const rho = rhoCu(d.copperTempC);
  const delta = skinDepth(rho, s.fsw);
  const wsteps: Step[] = [
    { title: "Skin depth at fsw", formula: "δ = √(ρ / (π·f·μ0))",
      result: `δ = ${fmt((delta / MM) * 1000)} µm at ${fmt(d.copperTempC)} °C; copper ${fmt(l0.hMm * 1000)} µm → h/δ = ${fmt(l0.hMm * MM / delta)}` },
    { title: "Layer loss (Dowell/Ferreira, every harmonic)", formula: "P = R_F·Δ'·[(|F1|²+|F2|²)·G1 − 4·Re(F1·F2*)·G2],  Δ' = (h/δ)·√η",
      result: Object.entries(d.copper.byWinding).map(([w, b]) => `${w}: Irms ${si(b.irms, "A")}, Rdc ${si(b.rdc, "Ω")}, Rac,eff ${si(b.rac, "Ω")}, ${si(b.loss, "W")}`).join("; "),
      note: "F1, F2 are the MMFs on the two faces of the layer; interleaving keeps them small and opposite." },
    { title: "Leakage inductance (referred to the primary)", formula: "Llk = μ0·MLT/b·[Σ h·(F1²+F1F2+F2²)/3 + Σ d·F²] / Ip²",
      result: `Llk = ${si(d.leakage, "H")}`, note: s.topology === "llc" ? "Usable as part of the resonant inductor Lr." : "Sets the switch-node spike and the clamp loss." },
    { title: "Primary–secondary capacitance", formula: "C = ε0·εr·A / d over every P–S interface",
      result: `Cps = ${si(d.cps, "F")} over ${d.capPairs.length} interface(s)`, note: "Common-mode noise path; fewer P–S interfaces lowers it, at the cost of leakage." },
  ];
  out.push({ title: "5 · Copper loss, leakage and capacitance", steps: wsteps });

  out.push({
    title: "6 · Isolation and temperature",
    steps: [
      { title: "Insulation through the board", formula: "d ≥ max(√2·Vtest / (E_bd·k), DTI)",
        result: `${s.insulation}, ${si(s.vWork, "V")} working: Vtest = ${fmt(d.iso.testVrms)} Vrms → every P–S dielectric ≥ ${fmt(d.iso.layerMm)} mm`,
        note: `E_bd = ${C.pcb.breakdown_kV_per_mm} kV/mm derated × ${C.isolation.breakdown_derating}; DTI floor ${d.iso.dtiMm} mm.` },
      { title: "Creepage (ferrite counts as conductive)", formula: "IEC 60664-1, pollution degree 2, material group III",
        result: `${fmt(d.iso.creepMm)} mm: outer-layer keep-back ${fmt(d.layers[0].pullMm)} mm, terminals ${fmt(d.terminalMm)} mm from the windings` },
      { title: "Temperature rise", formula: "ΔT = (P[mW] / A[cm²])^0.833",
        result: `P = ${si(d.pTotal, "W")} (${pct(d.lossPct)} of Pout) over ${fmt(d.areaMm2 / 100)} cm² → ΔT ≈ ${fmt(d.dT)} °C` },
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
