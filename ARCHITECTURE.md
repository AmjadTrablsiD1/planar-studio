# Planar Studio — architecture

Design a planar transformer on a multilayer PCB: give it the converter
(topology, Vin, Vout, Iout, fsw, isolation), it searches cores × materials ×
turns × layer stack-ups, and shows the winning design as a 3D stack, per-layer
copper drawings, an MMF cross-section, waveforms, trade-off charts and the
step-by-step design path. It exports a KiCad board, Gerbers + drill, DXF and a
printable report.

All TypeScript. No Python anywhere (see TODO "Won't do").

## Layers and the one-way rule

```
shared/      constants.json (rule 11), themes.json, library.json (cores + ferrites)
   ↑
core/        pure physics + geometry + exporters. No DOM, no Node APIs.
   ↑            Runs under `node --test` and inside the browser worker.
server/      HTTP only: whoami + static ui/dist. No logic worth testing.
ui/          React 19 + three.js. Imports core/ directly, runs the optimiser
             in a Web Worker (ui/src/optimiser.worker.ts).
main.ts      launcher entry: port 0, reuse a running server, verify by token.
```

`core/` never imports from `ui/` or `server/`. The UI never re-implements a
formula: every number, every chart series, every drawing coordinate comes from
`core/`.

## Core modules

| File | Job |
|---|---|
| `core/constants.ts` | loads `shared/constants.json` + `library.json` |
| `core/format.ts` | rule 16: `fmt`, `fmtSI` — the only place numbers are rounded |
| `core/waveform.ts` | sampled periodic waveforms, DFT, rms |
| `core/materials.ts` | Steinmetz params, iGSE core loss on any flux waveform |
| `core/cores.ts` | core geometry → Ae, le, Ve, window, surface area |
| `core/topologies/*.ts` | **registry**: turns ratio, Lm, flux, winding currents per topology |
| `core/stack.ts` | layer plan: which winding on which layer, series/parallel, stack orders |
| `core/winding.ts` | 1-D Dowell/Ferreira layer loss per harmonic, leakage, capacitance |
| `core/gap.ts` | air gap with fringing correction |
| `core/checks.ts` | isolation (DTI, creepage via the core), thermal, fab rules |
| `core/design.ts` | `evaluate(spec, choice)` → one complete `Design` with every check |
| `core/optimise.ts` | enumerate choices, rank, keep trade-off series |
| `core/geometry.ts` | turn centrelines (lines + arcs), cosine transitions, via rings, leads, outline, cut-outs |
| `core/coverage.ts` | assumptions and what was not evaluated, per design |
| `core/spec.ts` | default specs per topology and input validation (names the field) |
| `core/steps.ts` | the design path as data (formula, numbers, result) — UI and report share it |
| `core/export/*.ts` | **registry**: KiCad `.kicad_pcb`, Gerber zip, DXF, HTML report, JSON |

A `Design` is plain data. Geometry is a separate pass (`buildGeometry(design)`)
so the optimiser can score a hundred thousand candidates without drawing them.

## How to add a new topology

1. `core/topologies/<name>.ts` exporting a `Topology` object
   (`size()` → turns ratio target + Np floor, `operate()` → sampled winding
   currents and primary voltage). Copy `forward.ts`; it is the shortest.
2. Add it to the array in `core/topologies/index.ts`.
3. Add its defaults under `topology_defaults` in `shared/constants.json`.
4. A test in `tests/topologies.test.ts` with a worked example *from a
   different source* than the one the formula came from (rule 15).

The UI picks it up from the registry: the topology segmented control, its
extra input fields (`fields` on the object) and the steps all read from it.

## How to add a core or a ferrite

Data only: append to `shared/library.json`. A core needs its dimension set;
Ae/le are taken from the catalogue when given and computed from the dimensions
otherwise (the inspector says which). A ferrite needs Steinmetz `k, alpha,
beta` at 100 °C, `bsat_T`, `mu_i` and a frequency range.

## How to add an exporter

`core/export/<name>.ts` exporting `{ id, label, ext, mime, build(design, geom) }`
and one line in `core/export/index.ts`. The Export menu reads the registry.

## Copper geometry, in one paragraph

Every layer of a winding jogs in the same short zone at the front (+y for the
primary, −y for the secondaries): a turn runs from s = +J/2 round to −J/2 and a
cosine-ramped transition steps it to the next turn. Consecutive series layers
meet at a junction via on a ring no copper uses — inside the innermost turn
(inward spirals, single turns) or outside the outermost one (outward spirals) —
so no via ever passes another winding's copper. Turns are exported as flat-ended
copper areas (KiCad zones, Gerber regions); stubs and leads as round tracks. The
same primitives feed the 3D, the SVG drawings, KiCad, Gerber and DXF.

## Coordinates

Board coordinates are millimetres, origin at the centre-leg axis, x along the
core length, y along the core depth with **+y = primary terminal side**,
−y = secondary terminal side (creepage). Layer 0 is the top copper. three.js
maps board (x, y) → scene (x, −z) and stack height → scene y.
