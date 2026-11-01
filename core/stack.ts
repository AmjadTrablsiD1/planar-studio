// Which winding sits on which copper layer, how its layers connect (series
// for turns, parallel for current), and what each layer's turns look like.

import { C } from "./constants.ts";
import { turnLength, type CoreInfo } from "./cores.ts";
import type { Direction, Layer, Pattern, WindingDef, WindingPlan } from "./types.ts";

/** Turns on each series layer: as even as possible, the larger counts first. */
const splits = new Map<number, number[]>();
export function turnsSplit(n: number, series: number): number[] {
  const key = n * 1000 + series;
  let s = splits.get(key);
  if (!s) {
    const base = Math.floor(n / series), rem = n % series;
    s = Array.from({ length: series }, (_, i) => base + (i < rem ? 1 : 0));
    splits.set(key, s);
  }
  return s;
}

/**
 * A multi-turn spiral starts on one side (outside / inside the turns) and ends
 * on the other; a single turn starts and ends outside. Both terminals must end
 * up outside the window, so a winding needs an even number of multi-turn layers.
 */
export function chainValid(turns: number[]): boolean {
  if (turns.some((t) => t < 1)) return false;
  return turns.filter((t) => t > 1).length % 2 === 0;
}

export function directions(turns: number[]): Direction[] {
  let inside = false;
  return turns.map((t) => {
    if (t === 1) return "single";
    const d: Direction = inside ? "out" : "in";
    inside = !inside;
    return d;
  });
}

/**
 * Every valid series/parallel arrangement of `layers` layers carrying `turns`
 * turns. With allowSingle false, a winding of two or more turns may not put a
 * single turn alone on any layer.
 */
export function arrangements(winding: string, layers: number, turns: number, allowSingle = true): WindingPlan[] {
  const out: WindingPlan[] = [];
  for (let series = 1; series <= layers; series++) {
    if (layers % series) continue;
    if (turns < series) continue;
    const split = turnsSplit(turns, series);
    if (split[0] > C.optimiser.max_turns_per_layer) continue;
    if (!chainValid(split)) continue;
    if (!allowSingle && turns > 1 && split.includes(1)) continue;
    out.push({ winding, layers, series, parallel: layers / series });
  }
  return out;
}

/** Stack order (top to bottom) of winding ids for a pattern. */
export function stackOrder(defs: WindingDef[], counts: Record<string, number>, pattern: Pattern): string[] {
  const pri = defs.filter((d) => d.side === "pri").map((d) => d.id);
  const sec = defs.filter((d) => d.side === "sec").map((d) => d.id);
  const lp = pri.reduce((a, id) => a + counts[id], 0);
  // Secondary layers alternate between the secondaries (centre tap: A, B, A, B…).
  const secSeq: string[] = [];
  const left: Record<string, number> = Object.fromEntries(sec.map((id) => [id, counts[id]]));
  while (secSeq.length < sec.reduce((a, id) => a + counts[id], 0)) {
    for (const id of sec) if (left[id] > 0) { secSeq.push(id); left[id]--; }
  }
  const priSeq: string[] = pri.flatMap((id) => Array(counts[id]).fill(id));
  const ls = secSeq.length;
  const L = lp + ls;

  if (pattern === "split") return [...priSeq, ...secSeq];
  if (pattern === "sandwich") {
    if (lp >= 2) {
      const top = Math.ceil(lp / 2);
      return [...priSeq.slice(0, top), ...secSeq, ...priSeq.slice(top)];
    }
    if (ls >= 2) {
      const top = Math.ceil(ls / 2);
      return [...secSeq.slice(0, top), ...priSeq, ...secSeq.slice(top)];
    }
    return [...priSeq, ...secSeq];
  }
  // Interleaved: spread the minority winding evenly through the majority.
  const [few, many] = lp <= ls ? [priSeq, secSeq] : [secSeq, priSeq];
  const slots = new Set<number>();
  for (let i = 0; i < few.length; i++) slots.add(Math.round(((i + 0.5) * L) / few.length - 0.5));
  const order: string[] = [];
  let a = 0, b = 0;
  for (let k = 0; k < L; k++) order.push(slots.has(k) && a < few.length ? few[a++] : many[b++] ?? few[a++]);
  return order;
}

export type LayerInput = {
  core: CoreInfo;
  defs: WindingDef[];
  plans: WindingPlan[];
  turnsOf: Record<string, number>;
  order: string[];
  oz: string;
  /** Extra keep-back on the outer layers, mm (creepage to the core). */
  outerPullMm: number;
  /** Inner keep-back that leaves room for the inner via ring, mm (0 when no winding needs one). */
  ringPullMm: number;
};

export type Junction = { winding: string; series: number; inner: boolean; from: number; to: number; crossesSide: boolean };

/**
 * Where consecutive series layers of a winding connect. A layer that spirals
 * outward ends on the outside, so its junction via sits on the outer ring,
 * beyond all copper; every other junction (inward spirals, single turns) uses
 * the inner ring, so the stubs never cross a terminal lead.
 */
export function junctions(defs: WindingDef[], plans: WindingPlan[], order: string[], turnsOf: Record<string, number>): Junction[] {
  const out: Junction[] = [];
  const sideOf = (w: string) => defs.find((d) => d.id === w)!.side;
  for (const p of plans) {
    const split = turnsSplit(turnsOf[p.winding], p.series);
    const dirs = directions(split);
    const idx = order.map((w, i) => (w === p.winding ? i : -1)).filter((i) => i >= 0);
    const seriesAt = (k: number) => Math.floor(k / p.parallel);
    for (let g = 0; g + 1 < p.series; g++) {
      const span = idx.filter((_, k) => seriesAt(k) === g || seriesAt(k) === g + 1);
      const from = Math.min(...span), to = Math.max(...span);
      let crossesSide = false;
      for (let i = from + 1; i < to; i++) if (sideOf(order[i]) !== sideOf(p.winding)) crossesSide = true;
      out.push({ winding: p.winding, series: g, inner: dirs[g] !== "out", from, to, crossesSide });
    }
  }
  return out;
}

/** Build the copper layers. Parallel copies of one series layer are kept adjacent. */
export function buildLayers(x: LayerInput): Layer[] {
  const { core, order } = x;
  const hMm = C.pcb.oz_um[x.oz as keyof typeof C.pcb.oz_um] / 1000;
  const space = C.pcb.min_space_mm[x.oz as keyof typeof C.pcb.min_space_mm];
  const basePull = C.pcb.cutout_clearance_mm + C.pcb.copper_pullback_mm;
  const seen: Record<string, number> = {};
  return order.map((w, index) => {
    const def = x.defs.find((d) => d.id === w)!;
    const plan = x.plans.find((p) => p.winding === w)!;
    const k = (seen[w] = (seen[w] ?? -1) + 1);
    const series = Math.floor(k / plan.parallel);
    const copy = k % plan.parallel;
    const split = turnsSplit(x.turnsOf[w], plan.series);
    const turns = split[series];
    const dir = directions(split)[series];
    const outer = index === 0 || index === order.length - 1;
    const extra = outer ? x.outerPullMm : 0;
    const pull = Math.max(basePull, x.ringPullMm) + extra;
    const pullOut = basePull + extra;
    const breadth = core.window - pull - pullOut;
    // The jog zone must fit through the core's exit opening with the terminal
    // leads beside it; where the transition climbs to the next turn it is closer
    // to its neighbour than the pitch, so the gap is widened until it still keeps min_space.
    const jogMax = Math.max(C.pcb.jog_min_mm, 2 * (core.opening - C.pcb.terminal_pad_mm / 2));
    let gap = space, width = (breadth - (turns - 1) * space) / turns, jog: number;
    if (turns > 1) {
      let f = C.pcb.jog_pitch_factor;
      for (let i = 0; i < 3; i++) {
        f = Math.min(C.pcb.jog_pitch_factor, jogMax / (width + gap));
        // Cosine ramp: steepest slope is π/2 × the average, so that is what sets the clearance.
        const cosJ = f / Math.hypot(f, Math.PI / 2);
        gap = (space + (1 - cosJ) * width) / cosJ;
        width = (breadth - (turns - 1) * gap) / turns;
      }
      jog = Math.max(C.pcb.jog_min_mm, f * (width + gap));
    } else {
      // A single turn: the gap only has to clear the narrow stubs and leads that leave its ends.
      const narrow = Math.min(width, Math.max(C.pcb.terminal_pad_mm, C.pcb.via_pad_mm));
      jog = Math.min(jogMax, Math.max(C.pcb.jog_min_mm, narrow + space));
    }
    const offsetsMm = Array.from({ length: turns }, (_, i) => pull + i * (width + gap) + width / 2);
    const mltMm = offsetsMm.reduce((a, d) => a + turnLength(core, d), 0) / turns;
    return {
      index, winding: w, side: def.side, series, copy, parallel: plan.parallel, turns, dir,
      oz: x.oz, hMm, pullMm: pull, pullOutMm: pullOut, widthMm: width, spaceMm: gap, jogMm: jog, offsetsMm, mltMm,
      porosity: (turns * width) / core.window,
    };
  });
}

/**
 * Dielectric between layer i and i+1, mm. A primary/secondary boundary gets
 * at least the isolation thickness; everything else the default.
 */
export function dielectrics(layers: Layer[], defaultMm: number, isoMm: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < layers.length; i++) {
    const cross = layers[i].side !== layers[i + 1].side;
    out.push(Math.max(defaultMm, C.pcb.dielectric_min_mm, cross ? isoMm : 0));
  }
  return out;
}

export function boardThickness(layers: Layer[], diel: number[]): number {
  return layers.reduce((a, l) => a + l.hMm, 0) + diel.reduce((a, d) => a + d, 0) + 2 * C.pcb.soldermask_mm;
}
