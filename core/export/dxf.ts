// DXF (R12 ASCII): every copper layer on its own DXF layer as width-carrying
// POLYLINEs with arc bulges, plus the outline and cut-outs. For mechanical CAD
// and for tools that import graphics rather than boards.

import type { Design } from "../design.ts";
import { endOf, startOf, type Geometry, type Prim, type Pt } from "../geometry.ts";

const f = (v: number) => v.toFixed(5);

function polyline(layer: string, width: number, verts: { p: Pt; bulge: number }[], closed: boolean, colour: number): string {
  const out = ["0", "POLYLINE", "8", layer, "62", String(colour), "66", "1", "70", closed ? "1" : "0", "40", f(width), "41", f(width)];
  for (const v of verts) out.push("0", "VERTEX", "8", layer, "10", f(v.p[0]), "20", f(v.p[1]), "30", "0", "42", f(v.bulge));
  out.push("0", "SEQEND", "8", layer);
  return out.join("\n");
}

/** Split a primitive chain into continuous runs of bulge vertices. */
function runs(prims: Prim[]): { p: Pt; bulge: number }[][] {
  const out: { p: Pt; bulge: number }[][] = [];
  let cur: { p: Pt; bulge: number }[] = [];
  let last: Pt | null = null;
  for (const q of prims) {
    const a = startOf(q), b = endOf(q);
    if (last && Math.hypot(last[0] - a[0], last[1] - a[1]) > 1e-6) { cur.push({ p: last, bulge: 0 }); out.push(cur); cur = []; }
    cur.push({ p: a, bulge: q.kind === "arc" ? Math.tan((q.a1 - q.a0) / 4) : 0 });
    last = b;
  }
  if (last) { cur.push({ p: last, bulge: 0 }); out.push(cur); }
  return out;
}

export function dxf(d: Design, g: Geometry): string {
  const ents: string[] = [];
  const colour = (w: string) => (w === "P" ? 1 : w === "S2" ? 3 : 5);
  for (const t of g.traces) {
    const layer = `L${t.layer + 1}_${t.winding}`;
    for (const r of runs(t.prims)) ents.push(polyline(layer, t.width, r, false, colour(t.winding)));
  }
  for (const poly of [g.board, ...g.cutouts]) ents.push(polyline("OUTLINE", 0, poly.map((p) => ({ p, bulge: 0 })), true, 7));
  for (const v of g.vias) ents.push(["0", "CIRCLE", "8", `VIA_L${v.from + 1}-L${v.to + 1}`, "10", f(v.at[0]), "20", f(v.at[1]), "30", "0", "40", f(v.drill / 2)].join("\n"));
  for (const t of g.terminals) ents.push(["0", "CIRCLE", "8", "TERMINALS", "10", f(t.at[0]), "20", f(t.at[1]), "30", "0", "40", f(t.drill / 2)].join("\n"));
  const c = d.mag.core;
  ents.push(polyline("CORE_FOOTPRINT", 0, ([[-c.A / 2, -c.Cd / 2], [c.A / 2, -c.Cd / 2], [c.A / 2, c.Cd / 2], [-c.A / 2, c.Cd / 2]] as Pt[]).map((p) => ({ p, bulge: 0 })), true, 8));
  return ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", ...ents, "0", "ENDSEC", "0", "EOF"].join("\n") + "\n";
}
