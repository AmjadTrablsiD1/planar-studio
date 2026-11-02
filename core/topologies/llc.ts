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
      { id: "ratio", title: "Turns ratio for unity gain at nominal input", formula: "n = \\frac{V_{in,nom}/2}{V_{out}+V_f}",
        result: `n = ${fmt(s.vinNom / 2)} / ${fmt(vo(s))} = ${fmt(llc.ratio(s))} → N_p:N_s = ${np}:${ns} (${fmt(n)})`,
        why: "Gain 1 at nominal input puts the converter at its series resonance, where it is most efficient; the line range is covered by moving the frequency." },
      { id: "lm", title: "Magnetising inductance for ZVS",
        formula: "I_m = \\frac{V_{in}}{8 L_m f_{sw}} \\ge \\frac{2 C_{oss} V_{in}}{t_{dead}} \\Rightarrow L_m \\le \\frac{t_{dead}}{16 C_{oss} f_{sw}}",
        result: `L_m = ${si(s.tDead, "s")} / (16·${si(s.coss, "F")}·${si(s.fsw, "Hz")}) = ${si(lm, "H")}`,
        why: "The largest L_m that still swings both switch capacitances in the dead time: a larger L_m would cut the circulating current but lose zero-voltage switching.",
        where: [["t_{dead}", "dead time (your input)"], ["C_{oss}", "output capacitance per switch (your input)"]] },
      { id: "load", title: "Load current on each side", formula: "I_{s,pk} = \\frac{\\pi I_{out}}{2}, \\; I_{p,pk} = \\frac{I_{s,pk}}{n}",
        result: `I_{s,pk} = ${si((Math.PI * s.iout) / 2, "A")}, I_{p,pk} = ${si((Math.PI * s.iout) / 2 / n, "A")}`,
        why: "At resonance the current is sinusoidal; its rectified mean must equal I_{out}." },
    ];
  },
};
