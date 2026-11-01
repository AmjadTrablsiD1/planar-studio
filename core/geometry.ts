// Copper geometry of every layer as centre lines made of straight segments and
// circular arcs, so KiCad tracks, Gerber strokes, DXF polylines, SVG paths and
// the 3D solids all come from one description and agree to the micrometre.
//
// Board frame (mm): origin on the centre-leg axis, x along the core length,
// +y towards the primary terminals. A secondary's local frame is turned 180°,
// so its terminals and vias sit on the −y side, away from the primary.
//
// A turn at offset d from the centre-leg face is a rounded rectangle around
// the leg (E) or a circle (ER). Arc length s runs clockwise seen from the top,
// starting at the front centre. Each turn runs from s₀ round to s₀ − J and a
// diagonal jog carries it to the next turn; the next series layer starts where
// this one ended, through a via.

import { C } from "./constants.ts";
import { boardHalf, type CoreInfo } from "./cores.ts";
import type { Check, Layer } from "./types.ts";

export type Pt = [number, number];
export type Prim =
  | { kind: "line"; a: Pt; b: Pt }
  | { kind: "arc"; c: Pt; r: number; a0: number; a1: number };

/** flat: a copper area with square ends (the turns); round: a track with round ends (stubs, leads). */
export type Trace = { layer: number; winding: string; width: number; prims: Prim[]; caps: "flat" | "round" };
export type Via = { at: Pt; from: number; to: number; drill: number; pad: number; winding: string; series: number; kind: "junction" };
export type Terminal = { at: Pt; drill: number; pad: number; winding: string; name: string };
export type Geometry = {
  board: Pt[];
  cutouts: Pt[][];
  traces: Trace[];
  vias: Via[];
  terminals: Terminal[];
  half: Pt;
};

const len = (p: Prim) => (p.kind === "line" ? Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) : Math.abs(p.a1 - p.a0) * p.r);

/** One closed turn, clockwise from the front centre. */
export function loopPrims(core: CoreInfo, d: number): Prim[] {
  const [ax, ay] = core.legHalf;
  const R = core.legRadius + d;
  const Y = ay + R, X = ax + R;
  const H = Math.PI / 2;
  const raw: Prim[] = [
    { kind: "line", a: [0, Y], b: [ax, Y] },
    { kind: "arc", c: [ax, ay], r: R, a0: H, a1: 0 },
    { kind: "line", a: [X, ay], b: [X, -ay] },
    { kind: "arc", c: [ax, -ay], r: R, a0: 0, a1: -H },
    { kind: "line", a: [ax, -Y], b: [-ax, -Y] },
    { kind: "arc", c: [-ax, -ay], r: R, a0: -H, a1: -2 * H },
    { kind: "line", a: [-X, -ay], b: [-X, ay] },
    { kind: "arc", c: [-ax, ay], r: R, a0: -2 * H, a1: -3 * H },
    { kind: "line", a: [-ax, Y], b: [0, Y] },
  ];
  return raw.filter((p) => len(p) > 1e-9);
}

export function perimeter(prims: Prim[]): number {
  return prims.reduce((a, p) => a + len(p), 0);
}

function clip(p: Prim, t0: number, t1: number): Prim {
  if (p.kind === "line") {
    const at = (t: number): Pt => [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t];
    return { kind: "line", a: at(t0), b: at(t1) };
  }
  return { ...p, a0: p.a0 + (p.a1 - p.a0) * t0, a1: p.a0 + (p.a1 - p.a0) * t1 };
}

export function startOf(p: Prim): Pt {
  return p.kind === "line" ? p.a : [p.c[0] + p.r * Math.cos(p.a0), p.c[1] + p.r * Math.sin(p.a0)];
}
export function endOf(p: Prim): Pt {
  return p.kind === "line" ? p.b : [p.c[0] + p.r * Math.cos(p.a1), p.c[1] + p.r * Math.sin(p.a1)];
}

/** The part of a closed loop from arc length s0 for `length` (clockwise, wrapping). */
export function walk(prims: Prim[], s0: number, length: number): Prim[] {
  const P = perimeter(prims);
  let s = ((s0 % P) + P) % P;
  let left = length;
  const out: Prim[] = [];
  let i = 0, acc = 0;
  while (acc + len(prims[i]) <= s) { acc += len(prims[i]); i = (i + 1) % prims.length; }
  let guard = 0;
  while (left > 1e-9 && guard++ < prims.length * 3) {
    const p = prims[i], L = len(p);
    const t0 = (s - acc) / L;
    const take = Math.min(left, L - (s - acc));
    out.push(clip(p, t0, t0 + take / L));
    left -= take;
    s += take;
    if (s - acc >= L - 1e-12) { acc += L; i = (i + 1) % prims.length; if (i === 0) { s -= P; acc -= P; } }
  }
  return out;
}

export function pointAt(prims: Prim[], s: number): Pt {
  const part = walk(prims, s, 1e-6);
  return part.length ? startOf(part[0]) : startOf(prims[0]);
}

/** Sample a primitive list into a polyline, arcs at `step` mm. */
export function polyline(prims: Prim[], step = 0.25): Pt[] {
  const pts: Pt[] = [];
  for (const p of prims) {
    if (p.kind === "line") { if (!pts.length) pts.push(p.a); pts.push(p.b); continue; }
    const n = Math.max(2, Math.ceil(len(p) / step));
    for (let k = pts.length ? 1 : 0; k <= n; k++) {
      const a = p.a0 + ((p.a1 - p.a0) * k) / n;
      pts.push([p.c[0] + p.r * Math.cos(a), p.c[1] + p.r * Math.sin(a)]);
    }
  }
  return pts;
}

const rot = (p: Pt, flip: boolean): Pt => (flip ? [-p[0], -p[1]] : p);
function rotPrim(p: Prim, flip: boolean): Prim {
  if (!flip) return p;
  return p.kind === "line"
    ? { kind: "line", a: rot(p.a, true), b: rot(p.b, true) }
    : { kind: "arc", c: rot(p.c, true), r: p.r, a0: p.a0 + Math.PI, a1: p.a1 + Math.PI };
}

/**
 * The step from one turn to the next: the centre line follows the loop while
 * its offset ramps from dA to dB over arc length sA → sB on a cosine profile.
 * Zero slope at both ends means no kink, so the copper outline cannot fold
 * over, even where the transition runs round a corner of the leg.
 */
export function transition(core: CoreInfo, dA: number, dB: number, sA: number, sB: number, step = 0.2): Prim[] {
  const n = Math.max(2, Math.ceil(Math.abs(sB - sA) / step));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ramp = (1 - Math.cos(Math.PI * t)) / 2; // zero slope at both ends: no kink where it meets the turns
    pts.push(pointAt(loopPrims(core, dA + (dB - dA) * ramp), sA + (sB - sA) * t));
  }
  const out: Prim[] = [];
  for (let i = 0; i < n; i++) out.push({ kind: "line", a: pts[i], b: pts[i + 1] });
  return out;
}

/** Jog length of a layer (decided with its trace width in stack.ts). */
export function jogOf(l: Layer): number {
  return l.jogMm;
}

/**
 * Outline polygon of a flat-ended trace along a centre line: the turns are
 * drawn as copper areas, because a round-capped track as wide as a planar turn
 * would need a gap as wide as itself.
 */
export function outline(prims: Prim[], width: number, step = 0.1): Pt[] {
  // Clipping at a primitive boundary can leave micrometre-long pieces whose
  // direction is noise; offsetting those would grow a miter spike (a sliver).
  const pts: Pt[] = [];
  for (const p of polyline(prims, step)) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.005) pts.push(p);
  }
  const n = pts.length;
  const left: Pt[] = [], right: Pt[] = [];
  const h = width / 2;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n - 1, i + 1)];
    const d1 = i > 0 ? norm([b[0] - a[0], b[1] - a[1]]) : norm([c[0] - b[0], c[1] - b[1]]);
    const d2 = i < n - 1 ? norm([c[0] - b[0], c[1] - b[1]]) : d1;
    const t = norm([d1[0] + d2[0], d1[1] + d2[1]]);
    const nx = -t[1], ny = t[0];
    const miter = Math.min(4, 1 / Math.max(0.25, nx * -d1[1] + ny * d1[0]));
    left.push([b[0] + nx * h * miter, b[1] + ny * h * miter]);
    right.push([b[0] - nx * h * miter, b[1] - ny * h * miter]);
  }
  return [...left, ...right.reverse()];
}

const norm = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

type Chain = { layer: Layer; s0: number; jog: number; start: Pt; end: Pt; order: number[] };

/**
 * Every layer jogs in the same short zone at the front: turns run from s0 = J/2
 * round to −J/2. Consecutive series layers meet at a junction via on a ring
 * that no copper occupies — inside the innermost turn when a spiral ends on the
 * inside, outside the outermost turn otherwise — joined by short stubs.
 */
export function chains(core: CoreInfo, layers: Layer[]): Chain[] {
  return layers.map((l) => {
    const J = jogOf(l);
    const idx = l.offsetsMm.map((_, i) => i);
    const order = l.dir === "out" ? idx : idx.reverse();
    const first = loopPrims(core, l.offsetsMm[order[0]]);
    const last = loopPrims(core, l.offsetsMm[order[order.length - 1]]);
    return { layer: l, s0: J / 2, jog: J, order, start: pointAt(first, J / 2), end: pointAt(last, -J / 2) };
  });
}

type ViaSite = { via: Via; ring: number; s: number; flip: boolean };

/** Junction vias in the winding's own frame (ring offset, arc position) and in board coordinates. */
function viaSites(core: CoreInfo, layers: Layer[], viaGap: number): ViaSite[] {
  const ch = chains(core, layers);
  const out: ViaSite[] = [];
  const pad = C.pcb.via_pad_mm;
  const basePull = C.pcb.cutout_clearance_mm + C.pcb.copper_pullback_mm;
  const innerRing = C.pcb.cutout_clearance_mm + C.pcb.copper_pullback_mm + pad / 2;
  const outerRing = core.window - basePull + viaGap + pad / 2;
  const pitch = pad + C.pcb.via_clearance_mm;
  for (const w of [...new Set(layers.map((l) => l.winding))]) {
    const cs = ch.filter((c) => c.layer.winding === w);
    const series = Math.max(...cs.map((c) => c.layer.series)) + 1;
    let kIn = 0, kOut = 0;
    for (let g = 0; g + 1 < series; g++) {
      const here = cs.filter((c) => c.layer.series === g);
      const next = cs.filter((c) => c.layer.series === g + 1);
      const idx = [...here, ...next].map((c) => c.layer.index);
      const inner = here[0].layer.dir !== "out";
      const ring = inner ? innerRing : outerRing;
      // An outer via into the last layer goes ahead of its start, so the stub
      // does not cross that layer's terminal lead, which leaves behind it.
      const ahead = !inner && g + 1 === series - 1;
      const k = inner ? kIn++ : kOut++;
      const s = ahead ? next[0].jog / 2 + k * pitch : -here[0].jog / 2 - k * pitch;
      const flip = here[0].layer.side === "sec";
      out.push({
        ring, s, flip,
        via: {
          at: rot(pointAt(loopPrims(core, ring), s), flip), from: Math.min(...idx), to: Math.max(...idx),
          drill: C.pcb.via_drill_mm, pad, winding: w, series: g, kind: "junction",
        },
      });
    }
  }
  return out;
}

export function junctionVias(core: CoreInfo, layers: Layer[], viaGap: number): Via[] {
  return viaSites(core, layers, viaGap).map((v) => v.via);
}

/** Distance from a point to the centre line of a turn at offset d. */
function distToTurn(core: CoreInfo, p: Pt, d: number): number {
  const [ax, ay] = core.legHalf;
  const qx = Math.max(Math.abs(p[0]) - ax, 0), qy = Math.max(Math.abs(p[1]) - ay, 0);
  return Math.abs(Math.hypot(qx, qy) - (core.legRadius + d));
}

/**
 * A via that passes a layer it does not connect needs an anti-pad in that
 * layer's copper. Across the isolation boundary the anti-pad must also give
 * the isolation distance in the plane. Fails when the trace is too narrow to
 * keep copper on both sides of the hole.
 */
export function viaChecks(core: CoreInfo, layers: Layer[], viaGap: number): Check[] {
  const vias = junctionVias(core, layers, viaGap);
  const out: Check[] = [];
  let worst = Infinity, hits = 0, blocked = 0, isoBlocked = 0;
  const notes: string[] = [];
  for (const v of vias) {
    const own = layers.find((l) => l.winding === v.winding)!;
    for (let c = v.from + 1; c < v.to; c++) {
      const l = layers[c];
      if (l.winding === v.winding && (l.series === v.series || l.series === v.series + 1)) continue;
      const cross = l.side !== own.side;
      const clr = cross ? viaGap : C.pcb.via_clearance_mm;
      const r = v.pad / 2 + clr;
      for (const d of l.offsetsMm) {
        const dist = distToTurn(core, v.at, d);
        if (dist >= l.widthMm / 2 + r) continue;
        hits++;
        const remaining = (l.widthMm - 2 * r) / 2;
        worst = Math.min(worst, remaining);
        if (remaining < C.pcb.min_trace_mm[l.oz as keyof typeof C.pcb.min_trace_mm]) {
          blocked++;
          if (cross) isoBlocked++;
          if (notes.length < 3) notes.push(`${v.winding} via L${v.from + 1}–L${v.to + 1} through ${l.winding} on L${c + 1}`);
        }
      }
    }
  }
  out.push({
    id: "vias", label: "Via anti-pads", ok: blocked === 0, severity: blocked ? "fail" : hits ? "warn" : "info",
    value: hits, limit: 0, unit: "",
    detail: blocked
      ? `${blocked} via crossing(s) leave less than the minimum trace beside the anti-pad${isoBlocked ? ` (${isoBlocked} across the isolation boundary)` : ""}: ${notes.join("; ")}. Use blind/buried vias or a stack that keeps series layers adjacent.`
      : hits
        ? `${hits} via crossing(s) need an anti-pad; the narrowest remaining copper is ${worst.toFixed(2)} mm each side.`
        : "Every junction via connects adjacent layers or passes only empty board.",
  });
  return out;
}

/** The complete drawing for the selected design. */
export function buildGeometry(core: CoreInfo, layers: Layer[], terminalMm: number, viaGap: number): Geometry {
  const half = boardHalf(core, terminalMm);
  const [bx, by] = half;
  const board: Pt[] = [[-bx, -by], [bx, -by], [bx, by], [-bx, by]];
  const clr = C.pcb.cutout_clearance_mm;

  const cutouts: Pt[][] = [];
  if (core.family === "ER") {
    // Arcs become polygons with ~0.1 mm sides whose chords touch the true
    // circle from outside, so no cut-out edge ever comes closer to the copper
    // than the design keep-back.
    const r = core.legRadius + clr;
    const nLeg = Math.ceil((2 * Math.PI * r) / 0.1);
    const rv = r / Math.cos(Math.PI / nLeg);
    cutouts.push(Array.from({ length: nLeg }, (_, k): Pt => [rv * Math.cos((2 * Math.PI * k) / nLeg), rv * Math.sin((2 * Math.PI * k) / nLeg)]));
    for (const sgn of [1, -1]) cutouts.push(erLeg(core, clr, sgn as 1 | -1));
  } else {
    // The leg cut-out is the leg grown by the clearance, corners rounded like the
    // copper around it (and like the router bit that mills it).
    cutouts.push(polyline(loopPrims(core, clr), 0.1).slice(0, -1));
    const x0 = core.D / 2 - clr, x1 = core.A / 2 + clr, y = core.Cd / 2 + clr;
    cutouts.push([[x0, -y], [x1, -y], [x1, y], [x0, y]]);
    cutouts.push([[-x1, -y], [-x0, -y], [-x0, y], [-x1, y]]);
  }

  const ch = chains(core, layers);
  const sites = viaSites(core, layers, viaGap);
  const traces: Trace[] = [];
  const terminals: Terminal[] = [];
  const yPad = by - C.pcb.terminal_pad_mm;
  const pitch = C.pcb.terminal_pad_mm + C.pcb.board_margin_mm;
  const seriesOf = (w: string) => Math.max(...layers.filter((l) => l.winding === w).map((l) => l.series)) + 1;
  const windings = [...new Set(layers.map((l) => l.winding))];
  const secs = windings.filter((w) => layers.find((l) => l.winding === w)!.side === "sec");
  const padX = (w: string) => {
    const side = secs.indexOf(w);
    return side < 0 ? 0 : (side - (secs.length - 1) / 2) * 2 * pitch;
  };
  const stubW = (l: Layer) => Math.min(l.widthMm, C.pcb.via_pad_mm);

  for (const c of ch) {
    const l = c.layer;
    const flip = l.side === "sec";
    const prims: Prim[] = [];
    for (const [k, ti] of c.order.entries()) {
      const loop = loopPrims(core, l.offsetsMm[ti]);
      prims.push(...walk(loop, c.s0, perimeter(loop) - c.jog));
      if (k + 1 < c.order.length) prims.push(...transition(core, l.offsetsMm[ti], l.offsetsMm[c.order[k + 1]], c.s0 - c.jog, c.s0));
    }
    // Stubs to the junction vias: radially to the via ring, then along it.
    const stubs: Prim[] = [];
    const before = sites.find((v) => v.via.winding === l.winding && v.via.series === l.series - 1);
    const after = sites.find((v) => v.via.winding === l.winding && v.via.series === l.series);
    const along = (ring: Prim[], a: number, b: number) => (a < b ? walk(ring, a, b - a) : walk(ring, b, a - b));
    if (before) {
      const ring = loopPrims(core, before.ring);
      stubs.push(...along(ring, before.s, c.s0));
      stubs.push({ kind: "line", a: pointAt(ring, c.s0), b: c.start });
    }
    if (after) {
      const ring = loopPrims(core, after.ring);
      stubs.push({ kind: "line", a: c.end, b: pointAt(ring, -c.jog / 2) });
      stubs.push(...along(ring, -c.jog / 2, after.s));
    }
    // Terminals: the chain start (series 0) goes to the right-hand pad, the chain
    // end to the left-hand one, so the two leads never have to cross. Leads are
    // at most a pad wide and turn below the pad row; when one lead's horizontal
    // run passes the other's start, it turns higher.
    const x0 = padX(l.winding);
    const isFirst = l.series === 0, isLast = l.series === seriesOf(l.winding) - 1;
    const leadW = Math.min(l.widthMm, C.pcb.terminal_pad_mm);
    const gapL = Math.max(C.pcb.via_clearance_mm, C.pcb.min_space_mm[l.oz as keyof typeof C.pcb.min_space_mm]);
    const kneeHigh = yPad - (C.pcb.terminal_pad_mm / 2 + gapL + leadW / 2);
    const kneeLow = kneeHigh - (leadW + gapL);
    const pS = x0 + pitch / 2, pE = x0 - pitch / 2;
    const spans = (a: number, b: number, x: number) => x > Math.min(a, b) - leadW && x < Math.max(a, b) + leadW;
    const startHigh = spans(c.start[0], pS, c.end[0]);
    const lead = (p: Pt, xPad: number, high: boolean): Prim[] => {
      const ky = Math.max(p[1] + C.pcb.terminal_pad_mm / 2, high ? kneeHigh : kneeLow);
      return ([
        { kind: "line", a: p, b: [p[0], ky] }, { kind: "line", a: [p[0], ky], b: [xPad, ky] }, { kind: "line", a: [xPad, ky], b: [xPad, yPad] },
      ] as Prim[]).filter((q) => len(q) > 1e-9);
    };
    const leads: Prim[] = [];
    if (isFirst) leads.push(...lead(c.start, pS, startHigh));
    if (isLast) leads.push(...lead(c.end, pE, !startHigh));
    traces.push({ layer: l.index, winding: l.winding, width: l.widthMm, prims: prims.map((p) => rotPrim(p, flip)), caps: "flat" });
    if (stubs.length) traces.push({ layer: l.index, winding: l.winding, width: stubW(l), prims: stubs.map((p) => rotPrim(p, flip)), caps: "round" });
    if (leads.length) traces.push({ layer: l.index, winding: l.winding, width: leadW, prims: leads.map((p) => rotPrim(p, flip)), caps: "round" });
  }
  for (const w of windings) {
    const flip = layers.find((x) => x.winding === w)!.side === "sec";
    const xw = padX(w);
    for (const [k, x] of [xw + pitch / 2, xw - pitch / 2].entries()) {
      terminals.push({ at: rot([x, yPad], flip), drill: C.pcb.terminal_drill_mm, pad: C.pcb.terminal_pad_mm, winding: w, name: `${w}${k + 1}` });
    }
  }
  return { board, cutouts, traces, vias: sites.map((v) => v.via), terminals, half };
}

/**
 * One ER outer leg seen from the top, grown by `clr`: the window arc, the
 * trimmed tips back to the opening (when the datasheet gives one), and the
 * core end. Arc vertices sit on the circumscribed polygon so no edge comes
 * inside the true circle — the copper keep-back is never eaten by a chord.
 */
export function erLeg(core: CoreInfo, clr: number, sgn: 1 | -1): Pt[] {
  const R = core.D / 2 - clr, yC = core.Cd / 2 + clr, xA = core.A / 2 + clr;
  const natural = Math.sqrt(Math.max(0, R * R - yC * yC));
  const xo = core.open !== null ? core.open / 2 - clr : 0;
  // Trimmed tips: the arc stops where it reaches x = open/2, then the tip runs straight out.
  const th = xo > natural ? Math.acos(Math.min(1, xo / R)) : Math.asin(Math.min(1, yC / R));
  const yArc = R * Math.sin(th);
  const n = Math.max(2, Math.ceil((2 * th * R) / 0.1));
  const Rv = R / Math.cos(th / n);
  const pts: Pt[] = [];
  if (xo > natural) pts.push([sgn * xo, -yC]);
  pts.push([sgn * R * Math.cos(th), -yArc]);
  for (let k = 0; k < n; k++) {
    const a = -th + (2 * th * (k + 0.5)) / n;
    pts.push([sgn * Rv * Math.cos(a), Rv * Math.sin(a)]);
  }
  pts.push([sgn * R * Math.cos(th), yArc]);
  if (xo > natural) pts.push([sgn * xo, yC]);
  pts.push([sgn * xA, yC], [sgn * xA, -yC]);
  return pts;
}

/** A primitive chain run backwards. */
export function reverse(prims: Prim[]): Prim[] {
  return prims.slice().reverse().map((p): Prim => (p.kind === "line" ? { kind: "line", a: p.b, b: p.a } : { ...p, a0: p.a1, a1: p.a0 }));
}
