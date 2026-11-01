// To-scale drawings as SVG markup: one copper layer from the top, and the
// window cross-section with the MMF diagram. The UI inlines these strings with
// CSS-variable colours; the report inlines them with fixed colours.

import { fmt } from "../format.ts";
import type { Design } from "../design.ts";
import { endOf, startOf, type Geometry, type Prim, type Pt } from "../geometry.ts";
import { faceMmfReal } from "../winding.ts";

export type Palette = {
  pri: string; sec: string; sec2: string; text: string; muted: string; line: string;
  board: string; core: string; iso: string; diel: string; mmf: string; via: string; bg: string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const n2 = (v: number) => Number(v.toFixed(3));
const P = (p: Pt) => `${n2(p[0])} ${n2(-p[1])}`;

export function windingColour(p: Palette, w: string): string {
  return w === "P" ? p.pri : w === "S2" ? p.sec2 : p.sec;
}

/** SVG path data for a primitive chain, y flipped for the screen. */
export function pathData(prims: Prim[]): string {
  let d = "";
  let cur: Pt | null = null;
  for (const q of prims) {
    const a = startOf(q), b = endOf(q);
    if (!cur || Math.hypot(cur[0] - a[0], cur[1] - a[1]) > 1e-6) d += `M${P(a)}`;
    if (q.kind === "line") d += `L${P(b)}`;
    else {
      // y is flipped for the screen, so a clockwise arc in board coordinates
      // (angle decreasing) runs in SVG's positive-angle direction: sweep = 1.
      const sweep = q.a1 < q.a0 ? 1 : 0;
      const large = Math.abs(q.a1 - q.a0) > Math.PI ? 1 : 0;
      d += `A${n2(q.r)} ${n2(q.r)} 0 ${large} ${sweep} ${P(b)}`;
    }
    cur = b;
  }
  return d;
}

function dimension(a: Pt, b: Pt, off: Pt, label: string, pal: Palette, size: number): string {
  const A: Pt = [a[0] + off[0], a[1] + off[1]], B: Pt = [b[0] + off[0], b[1] + off[1]];
  const mid: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const vertical = Math.abs(A[0] - B[0]) < 1e-6;
  const t = size * 0.9;
  return `<g stroke="${pal.muted}" stroke-width="${n2(size * 0.06)}" fill="none">
<line x1="${n2(a[0])}" y1="${n2(-a[1])}" x2="${n2(A[0])}" y2="${n2(-A[1])}" stroke-dasharray="${n2(size * 0.2)} ${n2(size * 0.2)}"/>
<line x1="${n2(b[0])}" y1="${n2(-b[1])}" x2="${n2(B[0])}" y2="${n2(-B[1])}" stroke-dasharray="${n2(size * 0.2)} ${n2(size * 0.2)}"/>
<line x1="${n2(A[0])}" y1="${n2(-A[1])}" x2="${n2(B[0])}" y2="${n2(-B[1])}" marker-start="url(#arr)" marker-end="url(#arr)"/></g>
<text x="${n2(mid[0] + (vertical ? t * 0.6 : 0))}" y="${n2(-mid[1] - (vertical ? 0 : t * 0.45))}" font-size="${n2(t)}" fill="${pal.muted}" text-anchor="${vertical ? "start" : "middle"}" dominant-baseline="${vertical ? "middle" : "auto"}" font-family="JetBrains Mono, monospace">${esc(label)}</text>`;
}

/** One copper layer from the top, with the core footprint and dimensions. */
export function layerSvg(d: Design, g: Geometry, layer: number, pal: Palette): string {
  const [bx, by] = g.half;
  const core = d.mag.core;
  const m = Math.max(bx, by) * 0.32;
  const size = Math.max(bx, by) / 22;
  const vb = `${n2(-bx - m)} ${n2(-by - m * 0.6)} ${n2(2 * bx + 2 * m)} ${n2(2 * by + m * 1.2)}`;
  const l = d.layers[layer];
  const traces = g.traces.filter((t) => t.layer === layer);
  const parts: string[] = [];
  parts.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="${pal.muted}"/></marker></defs>`);
  parts.push(`<path d="M${g.board.map(P).join("L")}Z ${g.cutouts.map((c) => `M${c.map(P).join("L")}Z`).join(" ")}" fill="${pal.board}" fill-rule="evenodd" stroke="${pal.line}" stroke-width="${n2(size * 0.08)}"/>`);
  // Core footprint, dashed: what sits above and below this board.
  parts.push(`<rect x="${n2(-core.A / 2)}" y="${n2(-core.Cd / 2)}" width="${n2(core.A)}" height="${n2(core.Cd)}" fill="none" stroke="${pal.core}" stroke-width="${n2(size * 0.1)}" stroke-dasharray="${n2(size * 0.5)} ${n2(size * 0.3)}"/>`);
  for (const t of traces) {
    parts.push(`<path d="${pathData(t.prims)}" fill="none" stroke="${windingColour(pal, t.winding)}" stroke-width="${n2(t.width)}" stroke-linecap="${t.caps === "flat" ? "butt" : "round"}" stroke-linejoin="${t.caps === "flat" ? "miter" : "round"}" opacity="0.92"/>`);
  }
  for (const v of g.vias) {
    const on = layer >= v.from && layer <= v.to;
    if (!on) continue;
    const connects = d.layers[layer].winding === v.winding;
    parts.push(`<circle cx="${n2(v.at[0])}" cy="${n2(-v.at[1])}" r="${n2(v.pad / 2)}" fill="${connects ? pal.via : "none"}" stroke="${pal.via}" stroke-width="${n2(size * 0.08)}"${connects ? "" : ` stroke-dasharray="${n2(size * 0.15)} ${n2(size * 0.15)}"`}/>`);
    parts.push(`<circle cx="${n2(v.at[0])}" cy="${n2(-v.at[1])}" r="${n2(v.drill / 2)}" fill="${pal.bg}"/>`);
  }
  for (const t of g.terminals) {
    parts.push(`<circle cx="${n2(t.at[0])}" cy="${n2(-t.at[1])}" r="${n2(t.pad / 2)}" fill="${windingColour(pal, t.winding)}" opacity="0.85"/><circle cx="${n2(t.at[0])}" cy="${n2(-t.at[1])}" r="${n2(t.drill / 2)}" fill="${pal.bg}"/>`);
    parts.push(`<text x="${n2(t.at[0])}" y="${n2(-t.at[1] + (t.at[1] > 0 ? -t.pad : t.pad * 1.6))}" font-size="${n2(size * 0.85)}" text-anchor="middle" fill="${pal.text}" font-family="Inter, sans-serif">${esc(t.name)}</text>`);
  }
  parts.push(dimension([-bx, by], [bx, by], [0, m * 0.35], `${fmt(2 * bx)} mm`, pal, size));
  parts.push(dimension([bx, by], [bx, -by], [m * 0.3, 0], `${fmt(2 * by)} mm`, pal, size));
  const x0 = core.F / 2 + (core.family === "ER" ? 0 : 0);
  const yW = -by - m * 0.2;
  parts.push(dimension([x0, -core.Cd / 2], [x0 + core.window, -core.Cd / 2], [0, yW + core.Cd / 2], `b ${fmt(core.window)}`, pal, size));
  parts.push(`<text x="${n2(-bx)}" y="${n2(by + m * 0.55)}" font-size="${n2(size * 0.9)}" fill="${pal.text}" font-family="Inter, sans-serif">L${layer + 1} · ${esc(l.winding)} · ${l.turns} turn${l.turns > 1 ? "s" : ""} × ${fmt(l.widthMm)} mm · ${l.oz} oz · ${l.dir === "single" ? "single turn" : l.dir === "in" ? "spirals inward" : "spirals outward"}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Copper layer ${layer + 1}">${parts.join("")}</svg>`;
}

/** Window cross-section (one side of the centre leg) with the instantaneous MMF across the stack. */
export function sectionSvg(d: Design, pal: Palette): string {
  const core = d.mag.core;
  const W = core.window;
  const scaleY = Math.max(1, (W * 0.45) / core.hw); // stretch the height so thin layers stay legible
  const yoke = core.B - core.E;
  const plate = d.choice.set === "E+PLT" ? core.tp : yoke;
  const H = (core.hw + yoke + plate) * scaleY;
  const legW = Math.min(core.F / 2, W * 0.3);
  const outerW = Math.min(core.outerLeg, W * 0.3);
  const mmfW = W * 0.55;
  const total = legW + W + outerW + mmfW + W * 0.25;
  const pad = W * 0.08;
  const top = 0;
  const yWin = top + plate * scaleY;
  const parts: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string, extra = "") =>
    `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" fill="${fill}" ${extra}/>`;
  // Core: top plate/yoke, bottom yoke, centre leg, outer leg.
  parts.push(rect(0, top, legW + W + outerW, plate * scaleY, pal.core));
  parts.push(rect(0, yWin + core.hw * scaleY, legW + W + outerW, yoke * scaleY, pal.core));
  const gap = (d.mag.gapMm ?? 0) * scaleY;
  if (d.choice.set === "E+PLT") {
    parts.push(rect(0, yWin + gap, legW, core.hw * scaleY - gap, pal.core));
  } else {
    const half = (core.hw * scaleY - gap) / 2;
    parts.push(rect(0, yWin, legW, half, pal.core));
    parts.push(rect(0, yWin + half + gap, legW, half, pal.core));
  }
  parts.push(rect(legW + W, yWin, outerW, core.hw * scaleY, pal.core));
  // Board stack centred in the window.
  const t = d.boardMm * scaleY;
  let y = yWin + (core.hw * scaleY - t) / 2;
  const boardTop = y;
  parts.push(rect(legW + 0.04 * W, y, W * 0.92, t, pal.diel, `opacity="0.55"`));
  y += 0.02 * scaleY;
  const layerY: [number, number][] = [];
  for (const [i, l] of d.layers.entries()) {
    const h = l.hMm * scaleY;
    for (const off of l.offsetsMm) {
      parts.push(rect(legW + off - l.widthMm / 2, y, l.widthMm, h, windingColour(pal, l.winding)));
    }
    layerY.push([y, y + h]);
    parts.push(`<text x="${n2(legW + W + outerW + pad * 0.4)}" y="${n2(y + h / 2)}" font-size="${n2(W * 0.035)}" fill="${pal.muted}" dominant-baseline="middle" font-family="JetBrains Mono, monospace">L${i + 1}</text>`);
    y += h;
    if (i < d.diel.length) {
      const dh = d.diel[i] * scaleY;
      if (l.side !== d.layers[i + 1].side) parts.push(rect(legW + 0.04 * W, y, W * 0.92, dh, pal.iso, `opacity="0.5"`));
      y += dh;
    }
  }
  // MMF diagram: instantaneous, at the peak primary current.
  const prof = faceMmfReal(d);
  const fx0 = legW + W + outerW + W * 0.18;
  const fMax = Math.max(1e-9, ...prof.flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]));
  const fx = (f: number) => fx0 + mmfW / 2 + (f / fMax) * (mmfW / 2) * 0.9;
  parts.push(`<line x1="${n2(fx(0))}" y1="${n2(boardTop - W * 0.04)}" x2="${n2(fx(0))}" y2="${n2(boardTop + t + W * 0.04)}" stroke="${pal.line}" stroke-width="${n2(W * 0.004)}"/>`);
  let pts = "";
  for (const [i, [a, b]] of layerY.entries()) {
    pts += `${n2(fx(prof[i][0]))},${n2(a)} ${n2(fx(prof[i][1]))},${n2(b)} `;
    if (i + 1 < layerY.length) pts += `${n2(fx(prof[i][1]))},${n2(layerY[i + 1][0])} `;
  }
  parts.push(`<polyline points="${pts}" fill="none" stroke="${pal.mmf}" stroke-width="${n2(W * 0.008)}" stroke-linejoin="round"/>`);
  parts.push(`<text x="${n2(fx(0))}" y="${n2(boardTop - W * 0.07)}" font-size="${n2(W * 0.04)}" text-anchor="middle" fill="${pal.mmf}" font-family="Inter, sans-serif">MMF at peak Ip · ±${fmt(fMax)} A·t</text>`);
  parts.push(`<text x="${n2(legW / 2)}" y="${n2(H + W * 0.07)}" font-size="${n2(W * 0.035)}" text-anchor="middle" fill="${pal.muted}" font-family="Inter, sans-serif">centre leg</text>`);
  parts.push(`<text x="${n2(legW + W / 2)}" y="${n2(H + W * 0.07)}" font-size="${n2(W * 0.035)}" text-anchor="middle" fill="${pal.muted}" font-family="Inter, sans-serif">window b = ${fmt(W)} mm · height ${fmt(core.hw)} mm (×${fmt(scaleY)} vertical)</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n2(-pad)} ${n2(-W * 0.12)} ${n2(total + 2 * pad)} ${n2(H + W * 0.22)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Window cross-section with MMF">${parts.join("")}</svg>`;
}
