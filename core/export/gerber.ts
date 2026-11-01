// Gerber X2 (RS-274X) per copper layer, the outline, and Excellon drill files
// (one per via span: through holes, and each blind/buried pair). Turns are
// stroked with a round aperture of the trace width, arcs as true circular
// interpolation. Where a via passes a layer it does not connect, the anti-pad
// is cleared with dark-to-clear polarity, so the copper the fab etches is the
// copper the checks assumed.

import { C } from "../constants.ts";
import type { Design } from "../design.ts";
import { endOf, outline, startOf, type Geometry, type Pt } from "../geometry.ts";
import { zip } from "./zip.ts";

const coord = (v: number) => Math.round(v * 1e6).toString();
const XY = (p: Pt) => `X${coord(p[0])}Y${coord(p[1])}`;

function header(fn: string): string[] {
  return [
    `%TF.GenerationSoftware,PlanarStudio,${C.app.version}*%`,
    `%TF.FileFunction,${fn}*%`,
    "%FSLAX46Y46*%", "%MOMM*%", "%LPD*%", "G01*", "G75*",
  ];
}

export function gerberLayer(d: Design, g: Geometry, layer: number, isoMm: number): string {
  const L = d.layers.length;
  const pos = layer === 0 ? "Top" : layer === L - 1 ? "Bot" : "Inr";
  const out = header(`Copper,L${layer + 1},${pos}`);
  out.push(`%TF.FilePolarity,Positive*%`);
  const apertures = new Map<string, number>();
  let next = 10;
  const ap = (dia: number) => {
    const k = dia.toFixed(4);
    if (!apertures.has(k)) apertures.set(k, next++);
    return apertures.get(k)!;
  };
  const body: string[] = [];
  for (const t of g.traces.filter((x) => x.layer === layer)) {
    if (t.caps === "flat") {
      const poly = outline(t.prims, t.width);
      body.push("G36*", `${XY(poly[0])}D02*`, ...poly.slice(1).map((p) => `${XY(p)}D01*`), `${XY(poly[0])}D01*`, "G37*");
      continue;
    }
    body.push(`D${ap(t.width)}*`);
    let cur: Pt | null = null;
    for (const p of t.prims) {
      const a = startOf(p), b = endOf(p);
      if (!cur || Math.hypot(cur[0] - a[0], cur[1] - a[1]) > 1e-6) body.push(`${XY(a)}D02*`);
      if (p.kind === "line") body.push(`G01*`, `${XY(b)}D01*`);
      else body.push(`${p.a1 < p.a0 ? "G02" : "G03"}*`, `${XY(b)}I${coord(p.c[0] - a[0])}J${coord(p.c[1] - a[1])}D01*`);
      cur = b;
    }
    body.push("G01*");
  }
  for (const v of g.vias) if (layer >= v.from && layer <= v.to && d.layers[layer].winding === v.winding) body.push(`D${ap(v.pad)}*`, `${XY(v.at)}D03*`);
  for (const t of g.terminals) body.push(`D${ap(t.pad)}*`, `${XY(t.at)}D03*`);
  // Anti-pads where a via passes copper it must not touch.
  const clear: string[] = [];
  const own = (w: string) => d.layers.find((l) => l.winding === w)!.side;
  for (const v of g.vias) {
    if (layer <= v.from || layer >= v.to) continue;
    const l = d.layers[layer];
    if (l.winding === v.winding && (l.series === v.series || l.series === v.series + 1)) continue;
    const clr = l.side !== own(v.winding) ? Math.max(C.pcb.via_clearance_mm, isoMm) : C.pcb.via_clearance_mm;
    clear.push(`D${ap(v.pad + 2 * clr)}*`, `${XY(v.at)}D03*`);
  }
  for (const [k, id] of apertures) out.push(`%ADD${id}C,${k}*%`);
  out.push(...body);
  if (clear.length) out.push("%LPC*%", ...clear, "%LPD*%");
  out.push("M02*");
  return out.join("\n") + "\n";
}

export function gerberOutline(g: Geometry): string {
  const out = header("Profile,NP");
  out.push("%ADD10C,0.1000*%", "D10*");
  for (const poly of [g.board, ...g.cutouts]) {
    out.push(`${XY(poly[0])}D02*`);
    for (const p of [...poly.slice(1), poly[0]]) out.push(`${XY(p)}D01*`);
  }
  out.push("M02*");
  return out.join("\n") + "\n";
}

function excellon(holes: { at: Pt; drill: number }[], fn: string): string {
  const tools = [...new Set(holes.map((h) => h.drill.toFixed(3)))];
  const out = ["M48", `; #@! TF.FileFunction,${fn}`, "METRIC,TZ"];
  tools.forEach((t, i) => out.push(`T${i + 1}C${t}`));
  out.push("%", "G90", "G05");
  tools.forEach((t, i) => {
    out.push(`T${i + 1}`);
    for (const h of holes.filter((x) => x.drill.toFixed(3) === t)) out.push(`X${h.at[0].toFixed(4)}Y${h.at[1].toFixed(4)}`);
  });
  out.push("M30");
  return out.join("\n") + "\n";
}

export function gerberFiles(d: Design, g: Geometry): { name: string; text: string }[] {
  const L = d.layers.length;
  const base = `planar_${d.mag.core.id}_${d.mag.np}-${d.mag.ns}`;
  const files: { name: string; text: string }[] = [];
  for (let i = 0; i < L; i++) files.push({ name: `${base}-L${i + 1}_${d.layers[i].winding}.gbr`, text: gerberLayer(d, g, i, d.iso.layerMm) });
  files.push({ name: `${base}-Edge_Cuts.gbr`, text: gerberOutline(g) });
  const through = [
    ...g.terminals.map((t) => ({ at: t.at, drill: t.drill })),
    ...g.vias.filter((v) => v.from === 0 && v.to === L - 1).map((v) => ({ at: v.at, drill: v.drill })),
  ];
  files.push({ name: `${base}-PTH.drl`, text: excellon(through, `Plated,1,${L},PTH`) });
  const spans = new Map<string, { at: Pt; drill: number }[]>();
  for (const v of g.vias) {
    if (v.from === 0 && v.to === L - 1) continue;
    const k = `${v.from + 1}-${v.to + 1}`;
    spans.set(k, [...(spans.get(k) ?? []), { at: v.at, drill: v.drill }]);
  }
  for (const [k, holes] of spans) {
    const [a, b] = k.split("-");
    const kind = a === "1" || b === String(L) ? "Blind" : "Buried";
    files.push({ name: `${base}-L${k}_${kind.toLowerCase()}.drl`, text: excellon(holes, `Plated,${a},${b},${kind}`) });
  }
  files.push({
    name: "README.txt",
    text: [
      `Planar Studio ${C.app.version} — fabrication files for ${d.mag.core.name} ${d.choice.set}, Np:Ns ${d.mag.np}:${d.mag.ns}.`,
      `${L} copper layers, ${d.choice.oz} oz finished, board ${d.boardMm.toFixed(2)} mm.`,
      "Stack-up (top to bottom):",
      ...d.layers.flatMap((l, i) => [
        `  L${i + 1}  ${l.winding}  ${(l.hMm * 1000).toFixed(0)} um copper`,
        ...(i < d.diel.length ? [`      dielectric ${d.diel[i].toFixed(3)} mm${l.side !== d.layers[i + 1].side ? "  <- P/S isolation" : ""}`] : []),
      ]),
      "Units mm, format 4.6, absolute. Drill files: PTH = through; others name their layer span.",
      "Generated geometry — run your fab's DFM check before ordering.",
    ].join("\n") + "\n",
  });
  return files;
}

export function gerberZip(d: Design, g: Geometry): Uint8Array {
  return zip(gerberFiles(d, g));
}
