// Half-bridge LLC, evaluated at series resonance (gain 1): square ±Vin/2 on
// the primary, sinusoidal load current, triangular magnetising current sized
// for zero-voltage switching. The leakage can serve as the resonant inductor.

import { sample } from "../waveform.ts";
import { fmt, si } from "../format.ts";
import type { Topology } from "./types.ts";
import { vo } from "./types.ts";

export const llc: Topology = {
  id: "llc",
  label: "LLC half-bridge",
  short: "LLC",
  description: "At resonance; Lm sized for ZVS; leakage reported as integrated Lr.",
  fields: ["rectifier", "tDead", "coss"],
  gapped: true,
  windings: (s) => s.rectifier === "centertap"
    ? [
        { id: "P", label: "Primary", turns: "P", side: "pri" },
        { id: "S", label: "Secondary A", turns: "S", side: "sec" },
        { id: "S2", label: "Secondary B", turns: "S", side: "sec" },
      ]
    : [
        { id: "P", label: "Primary", turns: "P", side: "pri" },
        { id: "S", label: "Secondary", turns: "S", side: "sec" },
      ],
  ratio: (s) => s.vinNom / 2 / vo(s),
  lmTarget: (s) => s.tDead / (16 * s.coss * s.fsw),
  operate(s, np, ns, lm, vin, N) {
    const im = vin / (8 * lm * s.fsw);
    const isPk = (Math.PI * s.iout) / 2;
    const ipPk = (isPk * ns) / np;
    const tri = (u: number) => (u < 0.5 ? -im + 4 * im * u : im - 4 * im * (u - 0.5));
    const sin = (u: number) => Math.sin(2 * Math.PI * u);
    const currents: Record<string, Float64Array> = { P: sample(N, (u) => ipPk * sin(u) + tri(u)) };
    if (s.rectifier === "centertap") {
      currents.S = sample(N, (u) => -isPk * Math.max(sin(u), 0));
      currents.S2 = sample(N, (u) => -isPk * Math.min(sin(u), 0));
    } else {
      currents.S = sample(N, (u) => -isPk * sin(u));
    }
    return {
      vin, duty: 0.5, mode: "at resonance", currents,
      vPri: sample(N, (u) => (u < 0.5 ? vin / 2 : -vin / 2)),
      notes: ["Evaluated at fr = fsw. Below resonance (low line) the flux and the circulating current grow; that is not modelled."],
    };
  },
  steps(s, np, ns, lm) {
    const n = np / ns;
    return [
      { title: "Turns ratio for unity gain at nominal input", formula: "n = (Vin,nom/2) / (Vout+Vf)",
        result: `n = ${fmt(s.vinNom / 2)} / ${fmt(vo(s))} = ${fmt(llc.ratio(s))} → Np:Ns = ${np}:${ns} (${fmt(n)})` },
      { title: "Magnetising inductance for ZVS", formula: "Im = Vin/(8·Lm·fsw) ≥ 2·Coss·Vin/tdead  ⇒  Lm ≤ tdead / (16·Coss·fsw)",
        result: `Lm = ${si(s.tDead, "s")} / (16·${si(s.coss, "F")}·${si(s.fsw, "Hz")}) = ${si(lm, "H")}` },
      { title: "Load current on each side", formula: "Is,pk = π·Iout/2,  Ip,pk = Is,pk/n",
        result: `Is,pk = ${si((Math.PI * s.iout) / 2, "A")}, Ip,pk = ${si((Math.PI * s.iout) / 2 / n, "A")}` },
    ];
  },
};
