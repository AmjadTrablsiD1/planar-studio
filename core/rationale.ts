// Why this design and not its neighbours. For the chosen design, change one
// thing at a time — a smaller core, one turn more or fewer, two layers fewer
// or more, another copper weight, another stack pattern, another ferrite —
// let the search fill in the rest, and report what each alternative costs or
// which check it fails. The core comparison reuses the main search's per-core
// results, so it costs nothing extra.

import { C } from "./constants.ts";
import { CORES, coreInfo, setsOf } from "./cores.ts";
import { evaluate } from "./design.ts";
import { fmt, si } from "./format.ts";
import { materialsFor } from "./materials.ts";
import { optimise, type Tradeoffs } from "./optimise.ts";
import type { Choice, CoreSet, Locks, Pattern, Spec } from "./types.ts";

export type Alt = {
  label: string;
  chosen: boolean;
  feasible: boolean;
  pTotal: number | null;
  dT: number | null;
  /** The checks it fails, most frequent first (empty when feasible). */
  fails: string[];
  extra?: string;
  /** From the search's quick pass (no thermal iteration): within about 1 % of the full evaluation. */
  approx?: boolean;
};

export type WhyGroup = { aspect: string; title: string; question: string; rows: Alt[]; verdict: string };
export type Rationale = { groups: WhyGroup[]; ms: number };

const topReasons = (t: Record<string, number>, n = 2) =>
  Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

/** Best design with these locks, or why there is none. */
function probe(s: Spec, locks: Locks, label: string, chosen = false, extra?: (c: Choice) => string): Alt {
  const r = optimise(s, locks);
  const best = r.candidates.find((c) => c.feasible);
  if (best) return { label, chosen, feasible: true, pTotal: best.pTotal, dT: best.dT, fails: [], extra: extra?.(best.choice) };
  const near = r.candidates[0];
  const fails = near?.fails.length ? near.fails : topReasons(r.tally);
  return { label, chosen, feasible: false, pTotal: near && Number.isFinite(near.pTotal) ? near.pTotal : null, dT: null, fails: fails.length ? fails : ["no layout fits"] };
}

const pctMore = (a: number, b: number) => `${a >= b ? "+" : ""}${fmt((100 * (a - b)) / b, 2)} %`;

function verdictOf(rows: Alt[], what: string): string {
  const me = rows.find((r) => r.chosen);
  if (!me || me.pTotal === null) return "";
  const better = rows.filter((r) => !r.chosen && r.feasible && r.pTotal !== null && r.pTotal < me.pTotal! - 1e-9);
  const worse = rows.filter((r) => !r.chosen && r.feasible && r.pTotal !== null && r.pTotal >= me.pTotal! - 1e-9);
  const failing = rows.filter((r) => !r.chosen && !r.feasible);
  const parts: string[] = [];
  if (better.length) parts.push(`${better.map((r) => r.label).join(", ")} would lose less but ${better.length > 1 ? "rank" : "ranks"} lower on the objective`);
  if (worse.length) parts.push(`${worse.map((r) => `${r.label} costs ${pctMore(r.pTotal!, me.pTotal!)}`).join(", ")}`);
  if (failing.length) parts.push(`${failing.map((r) => `${r.label} fails ${r.fails[0]}`).join(", ")}`);
  return parts.length ? `${me.label} is the ${what}: ${parts.join("; ")}.` : `${me.label} is the only option tried.`;
}

export function explain(s: Spec, choice: Choice, tradeoffs: Tradeoffs | null, base: Locks = {}): Rationale {
  const t0 = Date.now();
  const groups: WhyGroup[] = [];
  const keep = { core: choice.core, set: choice.set, material: choice.material };
  const d = evaluate(s, choice);

  // 1. Core: every core of the allowed family, smallest first, from the main search.
  if (tradeoffs) {
    const sized = CORES.filter((c) => s.family === "all" || c.family === s.family)
      .flatMap((c) => setsOf(c).map((set) => ({ c, set, ve: coreInfo(c.id, set).Ve })))
      .sort((a, b) => a.ve - b.ve);
    const mine = sized.findIndex((x) => x.c.id === choice.core && x.set === choice.set);
    const rows: Alt[] = sized.slice(0, Math.min(sized.length, mine + 3)).map(({ c, set, ve }) => {
      const tc = tradeoffs.byCore.find((b) => b.core === c.id && b.set === set);
      const ok = tc?.pTotal !== null && tc?.pTotal !== undefined;
      const chosen = c.id === choice.core && set === choice.set;
      return {
        label: `${c.id} ${set}`, chosen, feasible: chosen ? d.feasible : ok,
        pTotal: chosen ? d.pTotal : ok ? tc!.pTotal : null, dT: chosen ? d.dT : null, fails: ok || chosen ? [] : topReasons(tc?.fails ?? {}),
        extra: `${fmt(ve / 1000)} cm³`, approx: !chosen && ok,
      };
    });
    const smaller = rows.slice(0, Math.max(0, mine));
    const smallerPass = smaller.filter((r) => r.feasible);
    // Summarise why the smaller ones fail: how many cores trip each first reason.
    const byReason: Record<string, string[]> = {};
    for (const r of smaller.filter((x) => !x.feasible)) (byReason[r.fails[0] ?? "no layout fits"] ??= []).push(r.label);
    const failing = Object.entries(byReason).map(([k, v]) => `${v.length > 2 ? `${v.length} smaller sets (${v[0]} … ${v[v.length - 1]})` : v.join(" and ")} ${v.length > 1 ? "fail" : "fails"} on ${k.toLowerCase()}`).join("; ");
    groups.push({
      aspect: "core", title: "Core", question: "Why this core and not a smaller one?",
      rows,
      verdict: s.objective !== "size"
        ? verdictOf(rows, "lowest-scoring core")
        : !smaller.length
          ? `${choice.core} ${choice.set} is the smallest core in the catalogue.`
          : !smallerPass.length
            ? `${choice.core} ${choice.set} is the smallest core with a passing design: ${failing}.`
            : `${smallerPass.map((r) => r.label).join(", ")} also ${smallerPass.length > 1 ? "pass" : "passes"} and would rank first under “${C.optimiser.objective_labels.size}”; this is a candidate you picked.${failing ? ` ${failing}.` : ""}`,
    });
  }

  // 2. Turns: one secondary turn fewer and more on the same core and ferrite.
  {
    const rows: Alt[] = [];
    for (const ns of [choice.ns - 1, choice.ns, choice.ns + 1]) {
      if (ns < 1 || ns > C.optimiser.ns_max) continue;
      const a = ns === choice.ns
        ? { label: `${choice.np}:${ns}`, chosen: true, feasible: d.feasible, pTotal: d.pTotal, dT: d.dT, fails: [] }
        : probe(s, { ...base, ...keep, ns }, `Ns = ${ns}`, false, (c) => `${c.np}:${c.ns}`);
      if (ns !== choice.ns && a.extra) a.label = a.extra;
      rows.push(a);
    }
    groups.push({ aspect: "turns", title: "Turns", question: "Why this turn count?",
      rows, verdict: verdictOf(rows, "best turn count: fewer turns raise the flux (core loss, saturation), more turns add copper") });
  }

  // 3. Layers: two fewer and two more, everything else free to adapt.
  {
    const rows: Alt[] = [];
    for (const L of [choice.layers - 2, choice.layers, choice.layers + 2]) {
      if (!C.pcb.layer_counts.includes(L) || L > s.maxLayers || L < 2) continue;
      rows.push(L === choice.layers
        ? { label: `${L} layers`, chosen: true, feasible: d.feasible, pTotal: d.pTotal, dT: d.dT, fails: [] }
        : probe(s, { ...base, ...keep, np: choice.np, ns: choice.ns, layers: L }, `${L} layers`));
    }
    groups.push({ aspect: "layers", title: "Layer count", question: `Why ${choice.layers} layers?`,
      rows, verdict: rows.length > 1 ? verdictOf(rows, "best layer count within your maximum") : `${choice.layers} layers is the most your maximum allows.` });
  }

  // 4. Copper weight on the same layer count.
  {
    const rows: Alt[] = s.copper.map((oz) => oz === choice.oz
      ? { label: `${oz} oz`, chosen: true, feasible: d.feasible, pTotal: d.pTotal, dT: d.dT, fails: [] }
      : probe(s, { ...base, ...keep, np: choice.np, ns: choice.ns, layers: choice.layers, oz }, `${oz} oz`));
    groups.push({ aspect: "copper", title: "Copper weight", question: `Why ${choice.oz} oz?`,
      rows, verdict: rows.length > 1 ? verdictOf(rows, "best copper weight: thicker copper lowers DC resistance until skin and proximity effects and the window height catch up") : "Only one copper weight is allowed." });
  }

  // 5. Stack pattern: the same layers and turns, arranged differently.
  {
    const rows: Alt[] = (C.optimiser.patterns as Pattern[]).map((pattern) => {
      const label = C.optimiser.pattern_labels[pattern as keyof typeof C.optimiser.pattern_labels];
      if (pattern === choice.pattern) {
        return { label, chosen: true, feasible: d.feasible, pTotal: d.pTotal, dT: d.dT, fails: [], extra: `L_{lk} ${si(d.leakage, "H")}, C_{ps} ${si(d.cps, "F")}` };
      }
      try {
        const e = evaluate(s, { ...choice, pattern });
        return { label, chosen: false, feasible: e.feasible, pTotal: e.pTotal, dT: e.dT,
          fails: e.checks.filter((k) => k.severity === "fail").map((k) => k.label), extra: `L_{lk} ${si(e.leakage, "H")}, C_{ps} ${si(e.cps, "F")}` };
      } catch {
        return { label, chosen: false, feasible: false, pTotal: null, dT: null, fails: ["not possible with this layer split"] };
      }
    });
    groups.push({ aspect: "pattern", title: "Stack pattern", question: "Why this arrangement of the layers?",
      rows, verdict: verdictOf(rows, "best arrangement: interleaving cuts proximity loss and leakage, but adds P–S capacitance") });
  }

  // 6. Ferrite on the same design.
  {
    const rows: Alt[] = materialsFor(s.fsw).map((m) => {
      if (m.id === choice.material) return { label: m.id, chosen: true, feasible: d.feasible, pTotal: d.pTotal, dT: d.dT, fails: [], extra: `core ${si(d.mag.pCore, "W")}` };
      const e = evaluate(s, { ...choice, material: m.id });
      return { label: m.id, chosen: false, feasible: e.feasible, pTotal: e.pTotal, dT: e.dT,
        fails: e.checks.filter((k) => k.severity === "fail").map((k) => k.label), extra: `core ${si(e.mag.pCore, "W")}` };
    });
    groups.push({ aspect: "ferrite", title: "Ferrite", question: `Why ${choice.material}?`,
      rows, verdict: rows.length > 1 ? verdictOf(rows, `best ferrite rated for ${si(s.fsw, "Hz")}`) : `${choice.material} is the only ferrite rated for ${si(s.fsw, "Hz")}.` });
  }

  return { groups, ms: Date.now() - t0 };
}

/** The set a core is assembled as, for labels. */
export const setLabel = (set: CoreSet) => (set === "E+PLT" ? "E + plate" : "E + E");
