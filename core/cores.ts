// Core geometry → magnetic and thermal parameters. Every length here is mm,
// every area mm², volume mm³; callers convert to SI at the boundary.

import { C, LIB } from "./constants.ts";
import type { CoreSet } from "./types.ts";

export type CoreData = (typeof LIB.cores)[number] & { Ae?: number; le_plt?: number; le_ee?: number };

export const CORES: CoreData[] = LIB.cores as CoreData[];

/** Mean magnetic path from the dimensions; 0.87 is the corner short-cut factor fitted to the sixteen E-family catalogue le values (E+PLT and E+E), all within 5 %. */
const LE_CORNER_FACTOR = 0.87;

export type CoreInfo = {
  id: string;
  name: string;
  family: "E" | "ER";
  set: CoreSet;
  A: number; B: number; Cd: number; D: number; E: number; F: number; tp: number;
  Ae: number;            // mm²
  le: number;            // mm
  Ve: number;            // mm³
  source: "catalogue" | "computed";
  window: number;        // window breadth, centre-leg face to outer-leg face, mm
  hw: number;            // window height for this set, mm
  height: number;        // assembled height, mm
  surface: number;       // outer surface of the assembled core, mm²
  outerLeg: number;      // outer leg width along x (E) or at y = 0 (ER), mm
  legHalf: [number, number]; // half-size of the centre-leg cut-out base shape (x, y)
  legRadius: number;     // ER: centre-leg radius; E: 0
  opening: number;       // half-width of the free exit between the outer legs, where the copper leaves the core, mm
};

export function coreData(id: string): CoreData {
  const c = CORES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown core "${id}".`);
  return c;
}

export function coreInfo(id: string, set: CoreSet): CoreInfo {
  const c = coreData(id);
  const family = c.family as "E" | "ER";
  const window = (c.D - c.F) / 2;
  const outerLeg = (c.A - c.D) / 2;
  const hw = set === "E+PLT" ? c.E : 2 * c.E;
  const yoke = c.B - c.E;
  const height = set === "E+PLT" ? c.B + c.tp : 2 * c.B;
  const plate = set === "E+PLT" ? c.tp : yoke;

  let Ae: number, le: number, source: "catalogue" | "computed";
  const catalogueLe = set === "E+PLT" ? c.le_plt : c.le_ee;
  if (c.Ae !== undefined && catalogueLe !== undefined) {
    Ae = c.Ae; le = catalogueLe; source = "catalogue";
  } else {
    Ae = family === "ER" ? (Math.PI * c.F * c.F) / 4 : c.F * c.C;
    const x = c.F / 2 + window + outerLeg / 2;
    const y = hw + yoke / 2 + plate / 2;
    le = LE_CORNER_FACTOR * 2 * (x + y);
    source = "computed";
  }
  const surface = 2 * c.A * c.C + 2 * (c.A + c.C) * height;
  const clr = C.pcb.cutout_clearance_mm;
  const edge = family === "ER"
    ? Math.sqrt(Math.max(0, (c.D / 2 - clr) ** 2 - (c.C / 2 + clr) ** 2))
    : c.D / 2 - clr;
  return {
    id: c.id, name: c.name, family, set,
    A: c.A, B: c.B, Cd: c.C, D: c.D, E: c.E, F: c.F, tp: c.tp,
    Ae, le, Ve: Ae * le, source, window, hw, height, surface, outerLeg,
    legHalf: family === "ER" ? [0, 0] : [c.F / 2, c.C / 2],
    legRadius: family === "ER" ? c.F / 2 : 0,
    opening: edge - C.pcb.copper_pullback_mm,
  };
}

/**
 * Perimeter of the turn whose centre line sits `offset` mm from the centre-leg
 * face: a rounded rectangle around an E leg, a circle around an ER leg.
 */
export function turnLength(core: CoreInfo, offset: number): number {
  const [ax, ay] = core.legHalf;
  return 4 * ax + 4 * ay + 2 * Math.PI * (core.legRadius + offset);
}

/** Board half-extent (x, y) around the core: the copper leaves the core at ±y towards the terminals. */
export function boardHalf(core: CoreInfo, terminalMm: number): [number, number] {
  return [core.A / 2 + C.pcb.board_margin_mm, core.Cd / 2 + core.window + terminalMm];
}
