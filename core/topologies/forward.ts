// Single-switch forward (active-clamp or reset-winding reset). Energy goes
// straight through while the switch conducts; the output inductor carries the
// load during the off time, so the secondary winding is idle then. Ungapped:
// the flux swing is set by the volt-seconds and is unipolar (conservative).

import { sample, pwl } from "../waveform.ts";
import { fmt, si } from "../format.ts";
import type { Topology } from "./types.ts";
import { vo } from "./types.ts";

export const forward: Topology = {
  id: "forward",
  label: "Forward",
  short: "FWD",
  description: "Ungapped, unipolar flux; output inductor not part of this design.",
  fields: ["dMax"],
  gapped: false,
  windings: () => [
    { id: "P", label: "Primary", turns: "P", side: "pri" },
    { id: "S", label: "Secondary", turns: "S", side: "sec" },
  ],
  ratio: (s) => (s.vinMin * s.dMax) / vo(s),
  lmTarget: () => Infinity,
  operate(s, np, ns, lm, vin, N) {
    const n = np / ns, T = 1 / s.fsw;
    const d = Math.min((n * vo(s)) / vin, 0.95);
    const imPk = (vin * d * T) / lm;
    const ipl = s.iout / n;
    const im = pwl([[0, 0], [d, imPk], [1, 0]]);
    return {
      vin, duty: d, mode: "CCM",
      currents: {
        P: sample(N, (u) => (u < d ? ipl + im(u) : im(u))),
        S: sample(N, (u) => (u < d ? -s.iout : 0)),
      },
      vPri: sample(N, (u) => (u < d ? vin : (-vin * d) / (1 - d))),
      notes: ["The reset path (clamp or reset winding) carries the magnetising current during the off time; a reset winding is not drawn."],
    };
  },
  steps(s, np, ns) {
    const n = np / ns;
    return [
      { title: "Turns ratio from the duty limit", formula: "n = Vin,min·Dmax / (Vout+Vf)",
        result: `n = ${fmt(s.vinMin)}·${fmt(s.dMax)} / ${fmt(vo(s))} = ${fmt(forward.ratio(s))} → Np:Ns = ${np}:${ns} (${fmt(n)})` },
      { title: "Duty at each line voltage", formula: "D = n·(Vout+Vf) / Vin",
        result: `D = ${fmt((n * vo(s)) / s.vinMin)} at ${si(s.vinMin, "V")}, ${fmt((n * vo(s)) / s.vinMax)} at ${si(s.vinMax, "V")}` },
      { title: "Volt-seconds are constant", formula: "Vin·D·T = n·(Vout+Vf)/fsw",
        result: `${si((n * vo(s)) / s.fsw, "Vs")} per cycle at any line voltage`, note: "So the flux swing does not depend on Vin in CCM." },
    ];
  },
};
