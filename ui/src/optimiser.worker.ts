// The search runs here so the interface never stalls. The worker posts back
// only plain data (choices, scores, trade-off series); the main thread
// re-evaluates the chosen candidate with the same core, which takes a few ms.
import { optimise } from "../../core/optimise.ts";
import type { Locks, Spec } from "../../core/types.ts";

export type Request = { id: number; spec: Spec; locks: Locks };
export type Reply =
  | { id: number; kind: "progress"; done: number; total: number }
  | { id: number; kind: "done"; candidates: ReturnType<typeof optimise>["candidates"]; evaluated: number; feasibleCount: number;
      pruned: number; tally: Record<string, number>; tradeoffs: ReturnType<typeof optimise>["tradeoffs"]; ms: number }
  | { id: number; kind: "error"; message: string };

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, spec, locks } = e.data;
  try {
    const r = optimise(spec, locks, (done, total) => (self as unknown as Worker).postMessage({ id, kind: "progress", done, total } satisfies Reply));
    const reply: Reply = {
      id, kind: "done", candidates: r.candidates, evaluated: r.evaluated, feasibleCount: r.feasibleCount,
      pruned: r.pruned, tally: r.tally, tradeoffs: r.tradeoffs, ms: r.ms,
    };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, kind: "error", message: err instanceof Error ? err.message : String(err) } satisfies Reply);
  }
};
