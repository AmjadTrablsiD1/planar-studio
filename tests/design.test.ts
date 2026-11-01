import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSpec, validate } from "../core/spec.ts";
import { magnetic, evaluate } from "../core/design.ts";
import { optimise } from "../core/optimise.ts";
import { TOPOLOGIES } from "../core/topologies/index.ts";
import { turnsSplit, chainValid, stackOrder, directions } from "../core/stack.ts";
import { loopPrims, perimeter, walk, buildGeometry, startOf, endOf } from "../core/geometry.ts";
import { coreInfo, turnLength } from "../core/cores.ts";
import { mean } from "../core/waveform.ts";
import { designSteps } from "../core/steps.ts";
import { MM } from "../core/constants.ts";
import type { TopologyId } from "../core/types.ts";

const near = (a: number, b: number, rel: number, msg = "") =>
  assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} ${a} vs ${b}`);
const IDS = TOPOLOGIES.map((t) => t.id) as TopologyId[];

test("every default spec validates", () => {
  for (const id of IDS) assert.deepEqual(validate(defaultSpec(id)), [], id);
  const bad = { ...defaultSpec("flyback"), vinMin: 70 };
  assert.ok(validate(bad).some((e) => e.field === "vinNom"));
});

test("flux from the currents equals ∫v dt / (Np·Ae) — two derivations agree", () => {
  for (const id of IDS) {
    const s = defaultSpec(id);
    const t = TOPOLOGIES.find((x) => x.id === id)!;
    const ns = 2, np = Math.max(1, Math.round(t.ratio(s) * ns));
    const m = magnetic(s, "E32", "E+E", "N87", np, ns);
    const N = m.b.length, dt = 1 / s.fsw / N, ae = m.core.Ae * MM * MM;
    const errs: number[] = [];
    for (let k = 0; k + 1 < N; k++) {
      const dB = m.b[k + 1] - m.b[k];
      const want = (m.op.vPri[k] * dt) / (np * ae);
      if (Math.abs(m.op.vPri[k + 1] - m.op.vPri[k]) > 1e-9) continue; // a switching edge inside this step
      errs.push(Math.abs(dB - want) / (Math.abs(m.dBpp) / N));
    }
    errs.sort((a, b) => a - b);
    assert.ok(errs[Math.floor(errs.length / 2)] < 0.02, `${id}: median error ${errs[Math.floor(errs.length / 2)]}`);
  }
});

test("energy and charge balance of the winding currents", () => {
  const fly = defaultSpec("flyback");
  for (const vin of [fly.vinMin, fly.vinMax * 3]) {
    // At 3× the line voltage the same Lm runs discontinuous: both modes must deliver Pin.
    const m = magnetic({ ...fly, vinNom: vin, vinMax: Math.max(vin, fly.vinMax) }, "E32", "E+E", "N87", 6, 2);
    near(mean(m.op.currents.S) * (fly.vout + fly.vf), (fly.vout * fly.iout) / fly.eta, 0.01, `flyback ${m.op.mode}`);
  }
  const llc = defaultSpec("llc");
  const ml = magnetic(llc, "E32", "E+E", "3F36", 16, 1);
  const abs = (x: Float64Array) => mean(Float64Array.from(x, Math.abs));
  near(abs(ml.op.currents.S) + abs(ml.op.currents.S2), llc.iout, 0.01, "LLC centre tap");
  const fb = defaultSpec("fullbridge");
  const mf = magnetic(fb, "E43", "E+PLT", "N97", 10, 2);
  near(abs(mf.op.currents.S), fb.iout * mf.op.duty, 0.02, "full bridge");
  const fw = defaultSpec("forward");
  const mw = magnetic(fw, "E32", "E+PLT", "N87", 6, 2);
  near(-mean(mw.op.currents.S), fw.iout * mw.op.duty, 0.02, "forward");
});

test("stack: turn splits, chain rule, stack orders", () => {
  assert.deepEqual(turnsSplit(7, 2), [4, 3]);
  assert.ok(chainValid([3, 2]));
  assert.ok(!chainValid([2, 1]));
  assert.ok(chainValid([1, 1, 1]));
  assert.deepEqual(directions([3, 3, 1]), ["in", "out", "single"]);
  const defs = TOPOLOGIES[0].windings(defaultSpec("flyback"));
  assert.equal(stackOrder(defs, { P: 4, S: 4 }, "interleaved").join(""), "SPSPSPSP");
  assert.equal(stackOrder(defs, { P: 4, S: 4 }, "sandwich").join(""), "PPSSSSPP");
  assert.equal(stackOrder(defs, { P: 2, S: 2 }, "split").join(""), "PPSS");
});

test("geometry: a loop is as long as the turn the loss model uses; walks keep length", () => {
  for (const id of ["E32", "ER18"]) {
    const c = coreInfo(id, id.startsWith("ER") ? "E+E" : "E+PLT");
    const loop = loopPrims(c, 1.3);
    near(perimeter(loop), turnLength(c, 1.3), 1e-9, id);
    near(perimeter(walk(loop, 2, perimeter(loop) - 1.5)), perimeter(loop) - 1.5, 1e-9, id);
  }
});

for (const id of IDS) {
  test(`optimiser finds a feasible ${id} design, and its geometry is continuous`, () => {
    const r = optimise(defaultSpec(id));
    assert.ok(r.best && r.best.feasible, `${id}: ${JSON.stringify(r.tally)}`);
    const d = r.best!;
    assert.ok(r.candidates.length > 1 && r.candidates[0].score <= r.candidates[1].score);
    const g = buildGeometry(d.mag.core, d.layers, d.terminalMm, d.viaGapMm);
    assert.equal(g.traces.filter((t) => t.caps === "flat").length, d.layers.length);
    for (const t of g.traces.filter((x) => x.caps === "flat")) {
      for (let i = 0; i + 1 < t.prims.length; i++) {
        const a = endOf(t.prims[i]), b = startOf(t.prims[i + 1]);
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `${id} L${t.layer + 1} break after prim ${i}`);
      }
    }
    const [bx, by] = g.half;
    for (const t of g.terminals) assert.ok(Math.abs(t.at[0]) < bx && Math.abs(t.at[1]) < by);
    assert.ok(designSteps(d).length >= 6);
    // The table and a fresh evaluation of the winner agree.
    near(evaluate(d.spec, d.choice).pTotal, r.candidates[0].pTotal, 1e-9);
  });
}

test("locks are honoured", () => {
  const r = optimise(defaultSpec("forward"), { core: "E32", layers: 6, pattern: "interleaved" });
  assert.ok(r.candidates.length > 0);
  for (const c of r.candidates) {
    assert.equal(c.choice.core, "E32");
    assert.equal(c.choice.layers, 6);
    assert.equal(c.choice.pattern, "interleaved");
  }
});

test("an impossible spec explains itself instead of returning nothing", () => {
  const s = { ...defaultSpec("forward"), iout: 300, maxLayers: 4, lossBudget: 0.1 };
  const r = optimise(s);
  assert.equal(r.feasibleCount, 0);
  assert.ok(Object.keys(r.tally).length > 0);
  assert.ok(!r.best || !r.best.feasible);
});

test("SVG arcs bend the right way: the midpoint of every drawn arc lies on its circle", async () => {
  // Rasterising is out of reach in node, so check the arc command geometrically:
  // for SVG endpoint arcs, the centre implied by (flags, endpoints, r) must be the real centre.
  const { pathData } = await import("../core/export/svg.ts");
  const prim = { kind: "arc" as const, c: [0, 0] as [number, number], r: 5, a0: Math.PI / 2, a1: 0 };
  const d = pathData([prim]);
  const m = d.match(/M([-\d.]+) ([-\d.]+)A([\d.]+) [\d.]+ 0 (\d) (\d) ([-\d.]+) ([-\d.]+)/)!;
  const [x1, y1, r, , sweep, x2, y2] = m.slice(1).map(Number);
  // Screen frame: from (0,−5) to (5,0) with r = 5. Sweep 1 (clockwise on screen) puts the centre at (0,0).
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, q = Math.hypot(dx, dy);
  const h = Math.sqrt(r * r - (q / 2) ** 2);
  const sign = sweep === 1 ? 1 : -1;
  const cx = mx - (sign * h * dy) / q, cy = my + (sign * h * dx) / q;
  assert.ok(Math.hypot(cx, cy) < 1e-6, `implied centre ${cx},${cy}`);
});
