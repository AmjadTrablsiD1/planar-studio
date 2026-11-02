// The search. Enumerates core × set × ferrite × turns (magnetic stage, shared)
// × layer count × copper × layer split × series/parallel × stack pattern
// (winding stage), keeps the best candidates and the trade-off series the
// charts draw. Anything in `locks` is held fixed.

import { C } from "./constants.ts";
import { CORES, boardHalf, coreInfo, setsOf, turnLength } from "./cores.ts";
import { rhoCu } from "./winding.ts";
import { materialsFor } from "./materials.ts";
import { topology } from "./topologies/index.ts";
import { arrangements, stackOrder } from "./stack.ts";
import { magnetic, windingStage, evaluate, defaultPlan, type Design } from "./design.ts";
import { isolation, tempRise } from "./checks.ts";
import type { Choice, CoreSet, Locks, Pattern, Spec, WindingPlan } from "./types.ts";

export type Candidate = {
  choice: Choice;
  feasible: boolean;
  score: number;
  pCore: number;
  pCopper: number;
  pTotal: number;
  dT: number;
  fails: string[];
};

export type Tradeoffs = {
  /** Best feasible design per core and set, and — for every core — what its rejected designs failed. */
  byCore: { core: string; set: CoreSet; pTotal: number | null; pCore: number | null; pCopper: number | null; fails: Record<string, number> }[];
  byNs: Record<string, { ns: number; np: number; pCore: number; pCopper: number; pTotal: number }[]>;
};

export type Result = {
  candidates: Candidate[];
  best: Design | null;
  evaluated: number;
  feasibleCount: number;
  pruned: number;
  tally: Record<string, number>;
  tradeoffs: Tradeoffs;
  ms: number;
};


function npOptions(s: Spec, ns: number, locks: Locks): number[] {
  if (locks.np) return [locks.np];
  const t = topology(s.topology).ratio(s) * ns;
  const tol = C.optimiser.ratio_tol[s.topology];
  return [...new Set([Math.floor(t), Math.ceil(t), Math.round(t)])]
    .filter((np) => np >= 1 && np <= C.optimiser.np_max && Math.abs(np / ns / (t / ns) - 1) <= tol);
}

/** Every way to give each winding its layers and arrange them. Centre-tap halves mirror each other. */
function plansFor(s: Spec, layers: number, np: number, ns: number, allowSingle = s.singleTurnLayers): WindingPlan[][] {
  const defs = topology(s.topology).windings(s);
  const secs = defs.filter((d) => d.side === "sec");
  const out: WindingPlan[][] = [];
  for (let lp = 1; lp < layers; lp++) {
    const rest = layers - lp;
    if (rest % secs.length) continue;
    const ls = rest / secs.length;
    for (const p of arrangements("P", lp, np, allowSingle)) {
      for (const q of arrangements(secs[0].id, ls, ns, allowSingle)) {
        out.push([p, ...secs.map((d) => ({ ...q, winding: d.id }))]);
      }
    }
  }
  return out;
}

export function optimise(s: Spec, locks: Locks = {}, onProgress?: (done: number, total: number) => void): Result {
  const t0 = Date.now();
  const topo = topology(s.topology);
  const defs = topo.windings(s);
  const cores = locks.core ? CORES.filter((c) => c.id === locks.core)
    : CORES.filter((c) => s.family === "all" || c.family === s.family);
  const mats = locks.material ? [locks.material]
    : s.material !== "auto" ? [s.material] : materialsFor(s.fsw).map((m) => m.id);
  const nsList = locks.ns ? [locks.ns] : Array.from({ length: C.optimiser.ns_max }, (_, i) => i + 1);
  // Most copper first: good designs early make the lower-bound prune bite sooner.
  const layerList = (locks.layers ? [locks.layers] : C.pcb.layer_counts.filter((L) => L <= s.maxLayers && L >= defs.length)).sort((a, b) => b - a);
  const ozList = (locks.oz ? [locks.oz] : [...s.copper]).sort((a, b) => Number(b) - Number(a));
  const rhoLo = rhoCu(s.tAmb);
  const isoSpec = isolation(s.insulation, s.vWork);
  const terminalMm = Math.max(C.pcb.terminal_length_mm, isoSpec.creepMm + C.pcb.terminal_pad_mm);
  const basePull = C.pcb.cutout_clearance_mm + C.pcb.copper_pullback_mm;
  const patterns: Pattern[] = locks.pattern ? [locks.pattern] : (C.optimiser.patterns as Pattern[]);

  const keep: Candidate[] = [];
  const near: Candidate[] = [];
  const topN = C.optimiser.top_n;
  let evaluated = 0, feasibleCount = 0;
  const byCoreMap = new Map<string, Tradeoffs["byCore"][number]>();
  const byNs: Tradeoffs["byNs"] = {};
  const bestAt = new Map<string, number>(); // best feasible loss per core|set|ns
  let pruned = 0;
  const tally: Record<string, number> = {}; // why candidates were rejected

  const total = cores.reduce((a, c) => a + setsOf(c).length, 0) * mats.length * nsList.length;
  let done = 0;
  // Each core only in the assemblies it is sold as (ER cores come in pairs).
  for (const c of cores) for (const set of setsOf(c).filter((x) => !locks.set || x === locks.set)) {
    const key = `${c.id}|${set}`;
    const coreFails: Record<string, number> = {};
    const reject = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; coreFails[k] = (coreFails[k] ?? 0) + 1; };
    byCoreMap.set(key, { core: c.id, set, pTotal: null, pCore: null, pCopper: null, fails: coreFails });
    const hw = coreInfo(c.id, set).hw;
    for (const mat of mats) for (const ns of nsList) {
      done++;
      if (onProgress && done % 8 === 0) onProgress(done, total);
      for (const np of npOptions(s, ns, locks)) {
        const m = magnetic(s, c.id, set, mat, np, ns);
        const magFail = m.checks.filter((k) => k.severity === "fail").map((k) => k.label);
        const nsKey = `${key}|${ns}`;
        const mltMin = turnLength(m.core, basePull) * 1e-3;
        const bcu = (m.core.window - 2 * basePull) * 1e-3;
        const turnsW: Record<string, number> = Object.fromEntries(defs.map((d) => [d.id, d.turns === "P" ? np : ns]));
        const scoreOf = (p: number) => s.objective === "size" ? m.core.Ve * 1e3 + p : p;
        const budget = (s.lossBudget / 100) * s.vout * s.iout;
        const [bx, by] = boardHalf(m.core, terminalMm);
        const area = m.core.surface + C.thermal.pcb_area_credit * 2 * (4 * bx * by - m.core.A * m.core.Cd);
        if (magFail.length) {
          // One representative is enough to explain a magnetic failure.
          const L = layerList[layerList.length - 1];
          const choice: Choice = { core: c.id, set, material: mat, layers: L, oz: ozList[0], np, ns, pattern: patterns[0], plan: defaultPlan(defs, L, np) };
          if (!keep.length) insertNear(near, { choice, feasible: false, score: Infinity, pCore: m.pCore, pCopper: NaN, pTotal: NaN, dT: NaN, fails: magFail }, topN);
          for (const f of magFail) reject(f);
          continue;
        }
        if (m.pCore > budget) { reject("Loss budget"); continue; }
        for (const L of layerList) for (const oz of ozList) {
          const h = C.pcb.oz_um[oz as keyof typeof C.pcb.oz_um] / 1000;
          const minBoard = L * h + (L - 1) * Math.max(s.dielectric, C.pcb.dielectric_min_mm) + 2 * C.pcb.soldermask_mm;
          if (minBoard + 2 * C.pcb.core_vertical_clearance_mm > hw) { reject("Board fits the window"); continue; }
          const minTrace = C.pcb.min_trace_mm[oz as keyof typeof C.pcb.min_trace_mm];
          const space = C.pcb.min_space_mm[oz as keyof typeof C.pcb.min_space_mm];
          const plans = plansFor(s, L, np, ns);
          // Say so when it is the single-turn setting that leaves no way to lay out these turns.
          if (!plans.length && !s.singleTurnLayers && plansFor(s, L, np, ns, true).length) {
            reject("Single-turn layers avoided");
          }
          for (const plan of plans) {
            // Narrowest trace: the layer with the most turns of each winding.
            const tooThin = plan.some((p) => {
              const t = Math.ceil(turnsW[p.winding] / p.series);
              return (bcu * 1e3 - (t - 1) * space) / t < minTrace;
            });
            if (tooThin) { reject("Narrowest trace"); continue; }
            // No arrangement beats the ideal DC resistance of the copper this plan gives each winding.
            let pLow = m.pCore;
            for (const p of plan) pLow += (m.irms[p.winding] ** 2 * rhoLo * turnsW[p.winding] ** 2 * mltMin) / (p.layers * bcu * h * 1e-3);
            if (pLow > budget) { reject("Loss budget"); continue; }
            if (tempRise(pLow, area) > s.dTMax) { reject("Temperature rise"); continue; }
            const localBest = bestAt.get(nsKey) ?? Infinity;
            const kth = keep.length >= topN ? keep[keep.length - 1].score : Infinity;
            if (pLow >= localBest && scoreOf(pLow) + (s.objective === "layers" ? L * 1e3 : 0) >= kth) { pruned++; continue; }
            const seen = new Set<string>();
            const iso = isoSpec.layerMm;
            for (const pattern of patterns) {
              const ord = stackOrder(defs, Object.fromEntries(plan.map((p) => [p.winding, p.layers])), pattern);
              const order = ord.join("");
              if (seen.has(order)) continue;
              seen.add(order);
              // Exact board thickness for this order: every P–S boundary needs the isolation dielectric.
              const sideOf = (w: string) => defs.find((d) => d.id === w)!.side;
              let board = L * h + 2 * C.pcb.soldermask_mm;
              for (let i = 0; i + 1 < L; i++) board += Math.max(s.dielectric, C.pcb.dielectric_min_mm, sideOf(ord[i]) !== sideOf(ord[i + 1]) ? iso : 0);
              if (board + 2 * C.pcb.core_vertical_clearance_mm > hw) { reject("Board fits the window"); continue; }
              const choice: Choice = { core: c.id, set, material: mat, layers: L, oz, np, ns, pattern, plan };
              const d = windingStage(s, m, choice, 0);
              evaluated++;
              const cand: Candidate = {
                choice, feasible: d.feasible, score: d.score, pCore: d.mag.pCore, pCopper: d.pCopper,
                pTotal: d.pTotal, dT: d.dT, fails: d.checks.filter((k) => k.severity === "fail").map((k) => k.label),
              };
              for (const f of cand.fails) reject(f);
              if (cand.feasible) {
                feasibleCount++;
                insert(keep, cand, topN);
                if (cand.pTotal < (bestAt.get(nsKey) ?? Infinity)) bestAt.set(nsKey, cand.pTotal);
                const bc = byCoreMap.get(key)!;
                if (bc.pTotal === null || cand.pTotal < bc.pTotal) Object.assign(bc, { pTotal: cand.pTotal, pCore: cand.pCore, pCopper: cand.pCopper });
                const series = (byNs[key] ??= []);
                const at = series.find((r) => r.ns === ns);
                if (!at) series.push({ ns, np, pCore: cand.pCore, pCopper: cand.pCopper, pTotal: cand.pTotal });
                else if (cand.pTotal < at.pTotal) Object.assign(at, { np, pCore: cand.pCore, pCopper: cand.pCopper, pTotal: cand.pTotal });
              } else if (!keep.length) {
                insertNear(near, cand, topN);
              }
            }
          }
        }
      }
    }
  }
  onProgress?.(total, total);
  for (const v of Object.values(byNs)) v.sort((a, b) => a.ns - b.ns);

  // Re-score the survivors with the full thermal iteration, so the table and the inspector agree.
  const list = keep.length ? keep : near;
  const final = list.map((c) => {
    if (!Number.isFinite(c.pTotal) && c.fails.length) return c;
    const d = evaluate(s, c.choice);
    return { ...c, feasible: d.feasible, score: d.score, pCore: d.mag.pCore, pCopper: d.pCopper, pTotal: d.pTotal, dT: d.dT,
      fails: d.checks.filter((k) => k.severity === "fail").map((k) => k.label) };
  }).sort((a, b) => (a.feasible === b.feasible ? a.score - b.score : a.feasible ? -1 : 1));
  const best = final.length ? evaluate(s, final[0].choice) : null;
  return {
    candidates: final, best, evaluated, feasibleCount, pruned, tally,
    tradeoffs: { byCore: [...byCoreMap.values()], byNs },
    ms: Date.now() - t0,
  };
}

function insert(list: Candidate[], c: Candidate, n: number): void {
  if (list.length >= n && c.score >= list[list.length - 1].score) return;
  let i = list.findIndex((x) => c.score < x.score);
  if (i < 0) i = list.length;
  list.splice(i, 0, c);
  if (list.length > n) list.pop();
}

/** Without any feasible design, keep the ones that fail the fewest checks, to explain why. */
function insertNear(list: Candidate[], c: Candidate, n: number): void {
  const rank = (x: Candidate) => x.fails.length * 1e6 + (Number.isFinite(x.pTotal) ? x.pTotal : 1e5);
  if (list.length >= n && rank(c) >= rank(list[list.length - 1])) return;
  let i = list.findIndex((x) => rank(c) < rank(x));
  if (i < 0) i = list.length;
  list.splice(i, 0, c);
  if (list.length > n) list.pop();
}
