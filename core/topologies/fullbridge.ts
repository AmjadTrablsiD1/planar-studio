// Hard-switched full bridge (phase-shift operation approximated): ±Vin for
// D/2 of each half period, zero while freewheeling. Ungapped, bipolar flux.
// Centre-tap secondaries share the load current while the bridge freewheels.

import { sample } from "../waveform.ts";
import { fmt, si } from "../format.ts";
import type { Topology } from "./types.ts";
import { vo } from "./types.ts";

export const fullbridge: Topology = {
  id: "fullbridge",
  label: "Full bridge",
  short: "FB",
  description: "Bipolar, ungapped; transformer current zero while freewheeling.",
  fields: ["dMax", "rectifier"],
  gapped: false,
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
  ratio: (s) => (s.vinMin * s.dMax) / vo(s),
  lmTarget: () => Infinity,
  operate(s, np, ns, lm, vin, N) {
    const n = np / ns, T = 1 / s.fsw;
    const d = Math.min((n * vo(s)) / vin, 0.98);
    const h = d / 2;
    const dIm = (vin * h * T) / lm;
    const ph = (u: number) => (u < h ? 1 : u < 0.5 ? 0 : u < 0.5 + h ? 2 : 3);
    const im = (u: number) => {
      if (u < h) return -dIm / 2 + (dIm * u) / h;
      if (u < 0.5) return dIm / 2;
      if (u < 0.5 + h) return dIm / 2 - (dIm * (u - 0.5)) / h;
      return -dIm / 2;
    };
    const ipl = s.iout / n;
    const currents: Record<string, Float64Array> = {
      P: sample(N, (u) => (ph(u) === 1 ? ipl : ph(u) === 2 ? -ipl : 0) + im(u)),
    };
    if (s.rectifier === "centertap") {
      currents.S = sample(N, (u) => { const p = ph(u); return p === 1 ? -s.iout : p === 2 ? 0 : -s.iout / 2; });
      currents.S2 = sample(N, (u) => { const p = ph(u); return p === 1 ? 0 : p === 2 ? s.iout : s.iout / 2; });
    } else {
      currents.S = sample(N, (u) => { const p = ph(u); return p === 1 ? -s.iout : p === 2 ? s.iout : 0; });
    }
    return {
      vin, duty: d, mode: "CCM", currents,
      vPri: sample(N, (u) => { const p = ph(u); return p === 1 ? vin : p === 2 ? -vin : 0; }),
      notes: ["Phase-shift circulating current during freewheeling is not modelled (hard-switched waveform)."],
    };
  },
  steps(s, np, ns) {
    const n = np / ns;
    return [
      { id: "ratio", title: "Turns ratio from the duty limit", formula: "n = \\frac{V_{in,min} D_{max}}{V_{out}+V_f}",
        result: `n = ${fmt(s.vinMin)}·${fmt(s.dMax)} / ${fmt(vo(s))} = ${fmt(fullbridge.ratio(s))} → N_p:N_s = ${np}:${ns} (${fmt(n)})`,
        why: "D_{max} below 1 keeps headroom for the phase-shift transitions and the voltage lost in the leakage.",
        where: [["D_{max}", "effective duty at V_{in,min} (your input)"]] },
      { id: "duty", title: "Effective duty", formula: "D = \\frac{n (V_{out}+V_f)}{V_{in}}",
        result: `D = ${fmt((n * vo(s)) / s.vinMin)} at ${si(s.vinMin, "V")}, ${fmt((n * vo(s)) / s.vinMax)} at ${si(s.vinMax, "V")}` },
      { id: "voltsec", title: "Volt-seconds per half cycle", formula: "V_{in} \\frac{D}{2} T = \\frac{n (V_{out}+V_f)}{2 f_{sw}}",
        result: `${si((n * vo(s)) / (2 * s.fsw), "Vs")} — independent of V_in`,
        why: "The flux swing is the same at every line voltage, so N_p is set by the flux limit alone." },
    ];
  },
};
