// What the numbers assume, and what was not evaluated at all. Shown in the
// inspector's Coverage tab and printed in the report — the most useful panel
// in an engineering tool is the one that says what it did not check.

import type { Design } from "./design.ts";

export function assumptions(d: Design): string[] {
  const a = [
    "1-D field in the window (Dowell/Ferreira): the field is parallel to the layers and uniform across the window breadth.",
    "Parallel layers share current equally. In reality a layer nearer the zero-field plane takes more; interleaving reduces the error.",
    "Core loss from the material sheet's typical loss points at 100 °C (local Steinmetz α at fsw, β per material), through the iGSE on the actual flux waveform. Typical values: a given core may lose up to the datasheet maximum, often 1.5–2× more.",
    "Core Ae, le, Ve and Amin are datasheet values (TDK ELP for E cores, Ferroxcube for ER); saturation is checked in Amin.",
    "Copper resistivity at the estimated hot-spot temperature; one natural-convection estimate for core and board together.",
    "Isolation and creepage use screening rules (DTI 0.4 mm for reinforced, IEC 60664-1 table). They are not a certification.",
  ];
  a.push(...d.mag.op.notes);
  if (d.mag.topo.gapped) a.push("Gap fringing via McLyman's factor; the extra copper loss next to the gap is only what the 1-D model sees.");
  return a;
}

export function notEvaluated(d: Design): string[] {
  const n = [
    "2-D/3-D effects: end turns outside the core, the jog regions and the termination leads.",
    "Resistance and inductance of vias, terminals and the external connections.",
    "Fringing-field loss in the copper right next to a centre-leg gap.",
    "Inner-layer copper to cut-out distance as a cemented joint (only the outer-layer creepage via the core is checked).",
    "Self-capacitance and resonance of each winding; only the P–S capacitance is estimated.",
    "Behaviour across the full load range and at start-up; one operating point is analysed.",
  ];
  if (d.spec.topology === "llc") n.push("Resonant tank design (Lr, Cr, Q, gain curve) and off-resonance operation.");
  if (d.spec.topology === "forward") n.push("Reset winding or clamp design, and the output inductor.");
  if (d.spec.topology === "fullbridge") n.push("Phase-shift circulating current, ZVS range and the output inductor.");
  if (d.spec.topology === "flyback") n.push("Clamp/snubber loss caused by the leakage inductance.");
  return n;
}
