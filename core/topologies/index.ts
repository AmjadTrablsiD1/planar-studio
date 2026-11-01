// The topology registry. Add a topology: one file, one line here
// (ARCHITECTURE.md "How to add a new topology").

import type { Topology } from "./types.ts";
import { flyback } from "./flyback.ts";
import { forward } from "./forward.ts";
import { llc } from "./llc.ts";
import { fullbridge } from "./fullbridge.ts";

export const TOPOLOGIES: Topology[] = [flyback, forward, llc, fullbridge];

export function topology(id: string): Topology {
  const t = TOPOLOGIES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown topology "${id}".`);
  return t;
}

export type { Topology, Step } from "./types.ts";
