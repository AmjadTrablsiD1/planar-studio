// The search, and the "why" comparisons around a chosen design, run here so
// the interface never stalls. The worker posts back only plain data (choices,
// scores, trade-off series, rationale tables); the main thread re-evaluates the
// chosen candidate with the same core, which takes a few ms.
import { optimise, type Tradeoffs } from "../../core/optimise.ts";
import { explain, type Rationale } from "../../core/rationale.ts";
import type { Choice, Locks, Spec } from "../../core/types.ts";

export type Request =
  | { id: number; kind: "search"; spec: Spec; locks: Locks }
  | { id: number; kind: "explain"; spec: Spec; locks: Locks; choice: Choice; tradeoffs: Tradeoffs | null };

export type Reply =
  | { id: number; kind: "progress"; done: number; total: number }
  | { id: number; kind: "done"; candidates: ReturnType<typeof optimise>["candidates"]; evaluated: number; feasibleCount: number;
      pruned: number; tally: Record<string, number>; tradeoffs: Tradeoffs; ms: number }
  | { id: number; kind: "explained"; why: Rationale }
  | { id: number; kind: "error"; message: string };

const post = (r: Reply) => (self as unknown as Worker).postMessage(r);

self.onmessage = (e: MessageEvent<Request>) => {
  const q = e.data;
  try {
    if (q.kind === "explain") {
      post({ id: q.id, kind: "explained", why: explain(q.spec, q.choice, q.tradeoffs, q.locks) });
      return;
    }
    const r = optimise(q.spec, q.locks, (done, total) => post({ id: q.id, kind: "progress", done, total }));
    post({
      id: q.id, kind: "done", candidates: r.candidates, evaluated: r.evaluated, feasibleCount: r.feasibleCount,
      pruned: r.pruned, tally: r.tally, tradeoffs: r.tradeoffs, ms: r.ms,
    });
  } catch (err) {
    post({ id: q.id, kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
