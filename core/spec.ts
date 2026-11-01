// Default specs per topology and input validation. Validation names the field,
// so the UI can put the message next to the input that caused it.

import { C } from "./constants.ts";
import type { Spec, TopologyId } from "./types.ts";

export function defaultSpec(topology: TopologyId): Spec {
  const t = C.topology_defaults[topology];
  const d = C.spec_defaults;
  return {
    topology,
    vinMin: t.vinMin, vinNom: t.vinNom, vinMax: t.vinMax,
    vout: t.vout, iout: t.iout, vf: t.vf, fsw: t.fsw, eta: t.eta,
    dMax: t.dMax, ripple: t.ripple,
    rectifier: t.rectifier as Spec["rectifier"],
    tDead: t.tDead, coss: t.coss,
    vWork: t.vWork, insulation: t.insulation as Spec["insulation"],
    tAmb: d.tAmb, dTMax: d.dTMax, lossBudget: d.lossBudget,
    maxLayers: d.maxLayers, copper: [...d.copper], dielectric: d.dielectric, singleTurnLayers: d.singleTurnLayers,
    family: d.family as Spec["family"], material: d.material, objective: d.objective as Spec["objective"],
    operatingPoint: d.operatingPoint as Spec["operatingPoint"],
  };
}

export type FieldError = { field: keyof Spec; message: string };

export function validate(s: Spec): FieldError[] {
  const L = C.limits;
  const errs: FieldError[] = [];
  const range = (field: keyof Spec, v: number, [lo, hi]: number[], label: string, unit: string) => {
    if (!Number.isFinite(v)) errs.push({ field, message: `${label} is not a number.` });
    else if (v < lo || v > hi) errs.push({ field, message: `${label} must be between ${lo} and ${hi} ${unit}.` });
  };
  range("vinMin", s.vinMin, L.vin, "Vin min", "V");
  range("vinNom", s.vinNom, L.vin, "Vin nom", "V");
  range("vinMax", s.vinMax, L.vin, "Vin max", "V");
  range("vout", s.vout, L.vout, "Vout", "V");
  range("iout", s.iout, L.iout, "Iout", "A");
  range("fsw", s.fsw, L.fsw, "Switching frequency", "Hz");
  range("eta", s.eta, L.eta, "Efficiency", "");
  range("dMax", s.dMax, L.dMax, "Dmax", "");
  range("ripple", s.ripple, L.ripple, "Ripple ratio", "");
  range("tAmb", s.tAmb, L.tAmb, "Ambient", "°C");
  range("dTMax", s.dTMax, L.dTMax, "Allowed rise", "°C");
  range("lossBudget", s.lossBudget, L.lossBudget, "Loss budget", "%");
  range("vWork", s.vWork, L.vWork, "Working voltage", "V");
  range("dielectric", s.dielectric, L.dielectric, "Dielectric", "mm");
  if (!(s.vinMin <= s.vinNom && s.vinNom <= s.vinMax)) errs.push({ field: "vinNom", message: "Need Vin min ≤ Vin nom ≤ Vin max." });
  if (!s.copper.length) errs.push({ field: "copper", message: "Allow at least one copper weight." });
  if (s.topology === "llc" && !(s.tDead > 0 && s.coss > 0)) errs.push({ field: "tDead", message: "Dead time and Coss must be positive." });
  return errs;
}
