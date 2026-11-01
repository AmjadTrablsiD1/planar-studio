// The exporter registry. Add an exporter: one file, one line here
// (ARCHITECTURE.md "How to add an exporter").

import type { Design } from "../design.ts";
import type { Geometry } from "../geometry.ts";
import { kicadPcb, kicadProject } from "./kicad.ts";
import { zip } from "./zip.ts";
import { gerberZip } from "./gerber.ts";
import { dxf } from "./dxf.ts";
import { reportHtml } from "./report.ts";

export type Exporter = {
  id: string;
  label: string;
  hint: string;
  ext: string;
  mime: string;
  build: (d: Design, g: Geometry) => string | Uint8Array;
};

export function baseName(d: Design): string {
  return `planar-${d.spec.topology}-${d.mag.core.id}-${d.mag.np}to${d.mag.ns}-${d.layers.length}L`;
}

export const EXPORTERS: Exporter[] = [
  { id: "report", label: "Design report", hint: "HTML — open and print to PDF", ext: "html", mime: "text/html",
    build: (d, g) => reportHtml(d, g, new Date().toISOString().slice(0, 16).replace("T", " ")) },
  { id: "kicad", label: "KiCad project", hint: "zip: .kicad_pcb (stack-up, tracks, vias, cut-outs) + .kicad_pro with the fab rules", ext: "zip", mime: "application/zip",
    build: (d, g) => {
      const name = baseName(d);
      return zip([{ name: `${name}/${name}.kicad_pcb`, text: kicadPcb(d, g) }, { name: `${name}/${name}.kicad_pro`, text: kicadProject(d, name) }]);
    } },
  { id: "gerber", label: "Gerber + drill", hint: "zip: copper per layer, outline, PTH/blind/buried drills", ext: "zip", mime: "application/zip", build: gerberZip },
  { id: "dxf", label: "DXF", hint: "R12, one DXF layer per copper layer", ext: "dxf", mime: "application/dxf", build: dxf },
];
