import type { Candidate } from "../../core/optimise.ts";
import { fmt } from "../../core/format.ts";
import { C } from "./constants";

export function Candidates({ list, selected, onSelect }: { list: Candidate[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="results" data-test="candidates">
      <div className="result-head cand">
        <span>#</span><span>Core</span><span>Ferrite</span><span>Stack</span><span>Np:Ns</span>
        <span className="r">Core</span><span className="r">Copper</span><span className="r">Total</span><span className="r">ΔT</span><span>Status</span>
      </div>
      <div className="results-scroll">
        {list.map((c, i) => (
          <button key={i} className={`result-row cand ${i === selected ? "active" : ""}`} onClick={() => onSelect(i)} data-test={`cand-${i}`}>
            <span className="mono muted">{i + 1}</span>
            <span>{c.choice.core} <small>{c.choice.set}</small></span>
            <span>{c.choice.material}</span>
            <span>{c.choice.layers}L {c.choice.oz} oz <small>{C.optimiser.pattern_labels[c.choice.pattern as keyof typeof C.optimiser.pattern_labels]}</small></span>
            <span className="mono">{c.choice.np}:{c.choice.ns}</span>
            <span className="mono r">{fmt(c.pCore)}</span>
            <span className="mono r">{fmt(c.pCopper)}</span>
            <span className="mono r strong">{fmt(c.pTotal)} <small>W</small></span>
            <span className="mono r">{fmt(c.dT, 2)}</span>
            <span>{c.feasible ? <span className="badge low">ok</span> : <span className="badge high" title={c.fails.join(", ")}>{c.fails[0] ?? "fails"}</span>}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
