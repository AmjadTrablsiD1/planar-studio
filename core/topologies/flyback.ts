// Flyback: the "transformer" is a coupled inductor. Energy is stored in the
// gap while the switch is on and released into the secondary while it is off,
// so primary and secondary never conduct together and the core carries a DC flux.

import { sample, pwl } from "../waveform.ts";
import { fmt, si } from "../format.ts";
import type { Topology } from "./types.ts";
import { pin, vo } from "./types.ts";

export const flyback: Topology = {
  id: "flyback",
  label: "Flyback",
  short: "FLY",
  description: "Gapped coupled inductor; CCM or DCM from the ripple ratio at low line.",
  fields: ["dMax", "ripple"],
  gapped: true,
  windings: () => [
    { id: "P", label: "Primary", turns: "P", side: "pri" },
    { id: "S", label: "Secondary", turns: "S", side: "sec" },
  ],
  ratio: (s) => (s.vinMin * s.dMax) / (vo(s) * (1 - s.dMax)),
  lmTarget(s, np, ns) {
    const n = np / ns;
    const d = (n * vo(s)) / (s.vinMin + n * vo(s));
    const ion = pin(s) / (s.vinMin * d);
    return (s.vinMin * d) / (s.ripple * ion * s.fsw);
  },
  operate(s, np, ns, lm, vin, N) {
    const n = np / ns, T = 1 / s.fsw, P = pin(s), vr = n * vo(s);
    const d = vr / (vin + vr);
    const ion = P / (vin * d);
    const di = (vin * d * T) / lm;
    if (di / 2 <= ion) {
      const lo = ion - di / 2, hi = ion + di / 2;
      return {
        vin, duty: d, mode: di / 2 > 0.98 * ion ? "BCM" : "CCM",
        currents: {
          P: sample(N, pwl([[0, lo], [d, hi], [d, 0], [1, 0]])),
          S: sample(N, pwl([[0, 0], [d, 0], [d, n * hi], [1, n * lo]])),
        },
        vPri: sample(N, (u) => (u < d ? vin : -vr)),
        notes: [],
      };
    }
    // DCM: the same Lm runs dry before the period ends.
    const ipk = Math.sqrt((2 * P) / (lm * s.fsw));
    const dOn = (ipk * lm) / (vin * T);
    const dOff = (lm * ipk) / (vr * T);
    return {
      vin, duty: dOn, mode: "DCM",
      currents: {
        P: sample(N, pwl([[0, 0], [dOn, ipk], [dOn, 0], [1, 0]])),
        S: sample(N, pwl([[0, 0], [dOn, 0], [dOn, n * ipk], [dOn + dOff, 0], [1, 0]])),
      },
      vPri: sample(N, (u) => (u < dOn ? vin : u < dOn + dOff ? -vr : 0)),
      notes: ["Discontinuous at this line voltage: the ringing after the secondary runs dry is not modelled."],
    };
  },
  steps(s, np, ns, lm) {
    const n = np / ns, vr = n * vo(s);
    const d = vr / (s.vinMin + vr);
    const ion = pin(s) / (s.vinMin * d);
    return [
      { title: "Turns ratio from the duty limit", formula: "n = Vin,min·Dmax / ((Vout+Vf)·(1−Dmax))",
        result: `n = ${fmt(s.vinMin)}·${fmt(s.dMax)} / (${fmt(vo(s))}·${fmt(1 - s.dMax)}) = ${fmt(flyback.ratio(s))} → Np:Ns = ${np}:${ns} (${fmt(n)})` },
      { title: "Reflected voltage and real duty", formula: "Vr = n·(Vout+Vf),  D = Vr / (Vin,min + Vr)",
        result: `Vr = ${si(vr, "V")}, D = ${fmt(d)}`, note: "The switch sees Vin,max + Vr plus the leakage spike." },
      { title: "Magnetising inductance from the ripple ratio", formula: "Ion = Pin/(Vin,min·D),  Lm = Vin,min·D / (r·Ion·fsw)",
        result: `Ion = ${si(ion, "A")}, r = ${fmt(s.ripple)} → Lm = ${si(lm, "H")}`,
        note: s.ripple >= 2 ? "r = 2 is the CCM/DCM boundary." : "r < 2 keeps full load in CCM at low line." },
    ];
  },
};
