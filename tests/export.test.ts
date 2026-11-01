// The exports are checked by the tools that will read them: KiCad's own DRC
// runs on the board (with the project rules we write next to it), and the ZIP
// is opened by the system unzip. Each is skipped, and says so, when the tool
// is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSpec } from "../core/spec.ts";
import { optimise } from "../core/optimise.ts";
import { buildGeometry } from "../core/geometry.ts";
import { kicadPcb, kicadProject } from "../core/export/kicad.ts";
import { gerberFiles, gerberZip } from "../core/export/gerber.ts";
import { dxf } from "../core/export/dxf.ts";
import { reportHtml } from "../core/export/report.ts";
import type { Locks, TopologyId } from "../core/types.ts";

const KICAD = [
  "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
  "C:\\Program Files\\KiCad\\9.0\\bin\\kicad-cli.exe",
  "C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe",
].find((p) => existsSync(p));

const CASES: [TopologyId, Locks][] = [
  ["flyback", {}], ["forward", {}], ["llc", {}], ["fullbridge", {}],
  ["forward", { core: "E32", layers: 6, pattern: "sandwich" }],
  ["llc", { core: "E43", set: "E+PLT" }],
];

for (const [id, locks] of CASES) {
  const name = `${id}${locks.core ? `-${locks.core}` : ""}`;
  const r = optimise(defaultSpec(id), locks);
  const d = r.best!;
  const g = buildGeometry(d.mag.core, d.layers, d.terminalMm, d.viaGapMm);

  test(`${name}: Gerber files are complete and balanced`, () => {
    const files = gerberFiles(d, g);
    const copper = files.filter((f) => /-L\d+_/.test(f.name) && f.name.endsWith(".gbr"));
    assert.equal(copper.length, d.layers.length);
    for (const f of copper) {
      assert.ok(f.text.trimEnd().endsWith("M02*"), f.name);
      assert.equal((f.text.match(/G36\*/g) ?? []).length, (f.text.match(/G37\*/g) ?? []).length, f.name);
      assert.ok(/G36\*/.test(f.text), `${f.name} has its turns as a region`);
    }
    assert.ok(files.some((f) => f.name.endsWith("PTH.drl")));
    assert.ok(dxf(d, g).trimEnd().endsWith("EOF"));
    assert.ok(reportHtml(d, g, "test").includes("<svg"));
  });

  test(`${name}: KiCad DRC passes with zero violations and zero unconnected items`, { skip: KICAD ? false : "kicad-cli not installed" }, () => {
    const dir = mkdtempSync(join(tmpdir(), "planar-"));
    writeFileSync(join(dir, "t.kicad_pcb"), kicadPcb(d, g));
    writeFileSync(join(dir, "t.kicad_pro"), kicadProject(d, "t"));
    execFileSync(KICAD!, ["pcb", "drc", "--format", "json", "-o", join(dir, "drc.json"), join(dir, "t.kicad_pcb")], { stdio: "pipe" });
    const rep = JSON.parse(readFileSync(join(dir, "drc.json"), "utf8"));
    const errs = rep.violations.map((v: { type: string; description: string }) => `${v.type}: ${v.description}`);
    assert.deepEqual(errs, []);
    assert.equal(rep.unconnected_items.length, 0);
  });
}

test("the Gerber ZIP opens with the system unzip", { skip: existsSync("/usr/bin/unzip") ? false : "unzip not installed" }, () => {
  const d = optimise(defaultSpec("flyback")).best!;
  const g = buildGeometry(d.mag.core, d.layers, d.terminalMm, d.viaGapMm);
  const dir = mkdtempSync(join(tmpdir(), "planar-zip-"));
  writeFileSync(join(dir, "g.zip"), gerberZip(d, g));
  const out = execFileSync("/usr/bin/unzip", ["-t", join(dir, "g.zip")]).toString();
  assert.match(out, /No errors detected/);
});
