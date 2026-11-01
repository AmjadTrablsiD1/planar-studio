// KiCad board file (.kicad_pcb, KiCad 8 format; KiCad 9 opens it): the
// winding board with the real stack-up, every turn as a track or arc on its
// net, junction vias (blind/buried where they do not reach both outer layers),
// terminal pads, and the outline with the core cut-outs on Edge.Cuts.
// KiCad's y axis points down, so y is negated; the board sits at (100, 100).

import { C } from "../constants.ts";
import { fmt } from "../format.ts";
import type { Design } from "../design.ts";
import { endOf, outline, startOf, type Geometry, type Pt } from "../geometry.ts";

const OX = 100, OY = 100;
const n = (v: number) => Number(v.toFixed(4));
const xy = (p: Pt) => `${n(OX + p[0])} ${n(OY - p[1])}`;

/** KiCad 8 layer name and ordinal for copper index i of L. */
export function kicadLayer(i: number, L: number): { name: string; id: number } {
  if (i === 0) return { name: "F.Cu", id: 0 };
  if (i === L - 1) return { name: "B.Cu", id: 31 };
  return { name: `In${i}.Cu`, id: i };
}

export function kicadPcb(d: Design, g: Geometry): string {
  let uid = 0;
  const uuid = () => {
    const h = (++uid).toString(16).padStart(12, "0");
    return `5a1e0000-0000-4000-8000-${h}`;
  };
  const L = d.layers.length;
  const nets = [...new Set(d.layers.map((l) => l.winding))];
  const netId = (w: string) => nets.indexOf(w) + 1;
  const out: string[] = [];
  out.push(`(kicad_pcb (version 20240108) (generator "planar_studio") (generator_version "${C.app.version}")`);
  out.push(`  (general (thickness ${n(d.boardMm)}) (legacy_teardrops no))`);
  out.push(`  (paper "A4")`);
  out.push(`  (layers`);
  for (let i = 0; i < L; i++) { const k = kicadLayer(i, L); out.push(`    (${k.id} "${k.name}" signal)`); }
  for (const [id, name, alias] of [
    [32, "B.Adhes", "B.Adhesive"], [33, "F.Adhes", "F.Adhesive"], [34, "B.Paste", ""], [35, "F.Paste", ""],
    [36, "B.SilkS", "B.Silkscreen"], [37, "F.SilkS", "F.Silkscreen"], [38, "B.Mask", ""], [39, "F.Mask", ""],
    [40, "Dwgs.User", "User.Drawings"], [41, "Cmts.User", "User.Comments"], [44, "Edge.Cuts", ""], [45, "Margin", ""],
    [46, "B.CrtYd", "B.Courtyard"], [47, "F.CrtYd", "F.Courtyard"], [48, "B.Fab", ""], [49, "F.Fab", ""],
  ] as [number, string, string][]) out.push(`    (${id} "${name}" user${alias ? ` "${alias}"` : ""})`);
  out.push(`  )`);
  out.push(`  (setup`);
  out.push(`    (stackup`);
  out.push(`      (layer "F.SilkS" (type "Top Silk Screen"))`);
  out.push(`      (layer "F.Mask" (type "Top Solder Mask") (thickness ${C.pcb.soldermask_mm}))`);
  for (let i = 0; i < L; i++) {
    out.push(`      (layer "${kicadLayer(i, L).name}" (type "copper") (thickness ${n(d.layers[i].hMm)}))`);
    if (i < L - 1) {
      out.push(`      (layer "dielectric ${i + 1}" (type "${i % 2 ? "core" : "prepreg"}") (thickness ${n(d.diel[i])}) (material "FR4") (epsilon_r ${C.pcb.eps_r}) (loss_tangent 0.02))`);
    }
  }
  out.push(`      (layer "B.Mask" (type "Bottom Solder Mask") (thickness ${C.pcb.soldermask_mm}))`);
  out.push(`      (layer "B.SilkS" (type "Bottom Silk Screen"))`);
  out.push(`      (copper_finish "ENIG") (dielectric_constraints no))`);
  out.push(`    (pad_to_mask_clearance 0)`);
  out.push(`    (allow_soldermask_bridges_in_footprints no)`);
  out.push(`  )`);
  out.push(`  (net 0 "")`);
  for (const w of nets) out.push(`  (net ${netId(w)} "${w}")`);

  // Terminal pads as footprints, so they keep their reference designators.
  for (const t of g.terminals) {
    out.push(`  (footprint "Terminal_${fmt(t.drill)}mm" (layer "F.Cu") (uuid "${uuid()}") (at ${xy(t.at)})`);
    out.push(`    (property "Reference" "${t.name}" (at 0 ${n(t.pad / 2 + 0.9) * (t.at[1] > 0 ? 1 : -1)} 0) (layer "F.SilkS") (uuid "${uuid()}") (effects (font (size 0.8 0.8) (thickness 0.12))))`);
    out.push(`    (property "Value" "winding ${t.winding}" (at 0 ${n(t.pad / 2 + 0.9) * (t.at[1] > 0 ? 1 : -1)} 0) (layer "F.Fab") (hide yes) (uuid "${uuid()}") (effects (font (size 0.8 0.8) (thickness 0.12))))`);
    out.push(`    (attr through_hole)`);
    out.push(`    (pad "1" thru_hole circle (at 0 0) (size ${t.pad} ${t.pad}) (drill ${t.drill}) (layers "*.Cu" "*.Mask") (net ${netId(t.winding)} "${t.winding}") (uuid "${uuid()}"))`);
    out.push(`  )`);
  }

  for (const t of g.traces) {
    const layer = kicadLayer(t.layer, L).name;
    if (t.caps === "flat") {
      // A turn is a filled zone on its net, already filled with exactly its outline.
      const pts = outline(t.prims, t.width).map((p) => `(xy ${xy(p)})`).join(" ");
      out.push(`  (zone (net ${netId(t.winding)}) (net_name "${t.winding}") (layer "${layer}") (uuid "${uuid()}") (name "turns ${t.winding} L${t.layer + 1}") (hatch edge 0.5)`);
      out.push(`    (connect_pads yes (clearance 0)) (min_thickness 0.1) (filled_areas_thickness no)`);
      out.push(`    (fill yes (thermal_gap 0.3) (thermal_bridge_width 0.3) (island_removal_mode 1))`);
      out.push(`    (polygon (pts ${pts}))`);
      out.push(`    (filled_polygon (layer "${layer}") (pts ${pts}))`);
      out.push(`  )`);
      continue;
    }
    for (const p of t.prims) {
      const a = startOf(p), b = endOf(p);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4) continue;
      if (p.kind === "line") {
        out.push(`  (segment (start ${xy(a)}) (end ${xy(b)}) (width ${n(t.width)}) (layer "${layer}") (net ${netId(t.winding)}) (uuid "${uuid()}"))`);
      } else {
        const am = (p.a0 + p.a1) / 2;
        const mid: Pt = [p.c[0] + p.r * Math.cos(am), p.c[1] + p.r * Math.sin(am)];
        out.push(`  (arc (start ${xy(a)}) (mid ${xy(mid)}) (end ${xy(b)}) (width ${n(t.width)}) (layer "${layer}") (net ${netId(t.winding)}) (uuid "${uuid()}"))`);
      }
    }
  }
  for (const v of g.vias) {
    const through = v.from === 0 && v.to === L - 1;
    out.push(`  (via${through ? "" : " blind"} (at ${xy(v.at)}) (size ${v.pad}) (drill ${v.drill}) (layers "${kicadLayer(v.from, L).name}" "${kicadLayer(v.to, L).name}") (net ${netId(v.winding)}) (uuid "${uuid()}"))`);
  }
  const poly = (pts: Pt[]) => `  (gr_poly (pts ${pts.map((p) => `(xy ${xy(p)})`).join(" ")}) (stroke (width 0.1) (type solid)) (fill none) (layer "Edge.Cuts") (uuid "${uuid()}"))`;
  out.push(poly(g.board));
  for (const c of g.cutouts) out.push(poly(c));
  const core = d.mag.core;
  out.push(`  (gr_rect (start ${xy([-core.A / 2, core.Cd / 2])}) (end ${xy([core.A / 2, -core.Cd / 2])}) (stroke (width 0.1) (type dash)) (fill none) (layer "Dwgs.User") (uuid "${uuid()}"))`);
  out.push(`  (gr_text "${core.name} ${d.choice.set} ${d.mag.mat.id} · Np:Ns ${d.mag.np}:${d.mag.ns} · ${L} layers ${d.choice.oz} oz" (at ${xy([-g.half[0], g.half[1] + 3])}) (layer "Cmts.User") (uuid "${uuid()}") (effects (font (size 1 1) (thickness 0.15)) (justify left)))`);
  out.push(`)`);
  return out.join("\n") + "\n";
}

/**
 * The project file that goes with the board: the design rules this design was
 * made to (copper weight clearance, copper-to-edge keep-back, via sizes), so
 * KiCad's DRC checks the board against the same fabrication assumptions.
 */
export function kicadProject(d: Design, name: string): string {
  const oz = d.choice.oz as keyof typeof C.pcb.min_space_mm;
  const space = C.pcb.min_space_mm[oz];
  const track = C.pcb.min_trace_mm[oz];
  return JSON.stringify({
    board: {
      design_settings: {
        defaults: { board_outline_line_width: 0.1, copper_line_width: 0.2 },
        rules: {
          // KiCad approximates arcs to 5 µm when it measures, so the edge rule sits 10 µm under the design keep-back.
          min_clearance: space, min_track_width: track, min_copper_edge_clearance: C.pcb.copper_pullback_mm - 0.01,
          min_via_diameter: C.pcb.via_pad_mm, min_through_hole_diameter: C.pcb.via_drill_mm,
          min_via_annular_width: (C.pcb.via_pad_mm - C.pcb.via_drill_mm) / 2, min_hole_clearance: C.pcb.via_clearance_mm,
          min_hole_to_hole: C.pcb.via_clearance_mm, min_silk_clearance: 0, min_microvia_diameter: 0.2, min_microvia_drill: 0.1,
          allow_blind_buried_vias: true, allow_microvias: false, solder_mask_to_copper_clearance: 0,
        },
        rule_severities: { lib_footprint_issues: "ignore", lib_footprint_mismatch: "ignore", silk_edge_clearance: "warning", silk_overlap: "ignore" },
      },
    },
    meta: { filename: `${name}.kicad_pro`, version: 1 },
    net_settings: {
      classes: [{ name: "Default", clearance: space, track_width: track, via_diameter: C.pcb.via_pad_mm, via_drill: C.pcb.via_drill_mm,
        microvia_diameter: 0.3, microvia_drill: 0.1, diff_pair_gap: 0.25, diff_pair_width: 0.2, wire_width: 6, bus_width: 12, line_style: 0,
        pcb_color: "rgba(0, 0, 0, 0.000)", schematic_color: "rgba(0, 0, 0, 0.000)", priority: 2147483647 }],
      meta: { version: 3 },
    },
  }, null, 2) + "\n";
}
