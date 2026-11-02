import type { Candidate } from "../../core/optimise.ts";
import { fmt } from "../../core/format.ts";
import { C } from "./constants";

const SHORT: Record<string, string> = { interleaved: "interleaved", sandwich: "sandwich", split: "split" };

export function Candidates({ list, selected, onSelect, open, onToggle }: {
  list: Candidate[]; selected: number; onSelect: (i: number) => void; open: boolean; onToggle: () => void;
}) {
  const feasible = list.filter((c) => c.feasible).length;
  return (
    <div className={`results ${open ? "" : "folded"}`} data-test="candidates">
      <button className="results-bar" onClick={onToggle} aria-expanded={open} data-test="toggle-results">
        <span className="eyebrow">Candidates</span>
        <span className="count-pill">{feasible} pass · {list.length} shown</span>
        <span className="fold">{open ? "▾ hide" : "▸ show"}</span>
      </button>
      {open && <div className="result-head cand">
        <span>#</span><span>Core</span><span>Ferrite</span><span>Stack</span><span>Np:Ns</span>
        <span className="r">Core</span><span className="r">Copper</span><span className="r">Total</span><span className="r">ΔT</span><span>Status</span>
      </div>}
      {open && <div className="results-scroll">
        {list.map((c, i) => (
          <button key={i} className={`result-row cand ${i === selected ? "active" : ""}`} onClick={() => onSelect(i)} data-test={`cand-${i}`}>
            <span className="mono muted">{i + 1}</span>
            <span className="cell">{c.choice.core} <small>{c.choice.set}</small></span>
            <span className="cell">{c.choice.material}</span>
            <span className="cell" title={C.optimiser.pattern_labels[c.choice.pattern as keyof typeof C.optimiser.pattern_labels]}>{c.choice.layers}L · {c.choice.oz} oz <small>{SHORT[c.choice.pattern]}</small></span>
            <span className="mono">{c.choice.np}:{c.choice.ns}</span>
            <span className="mono r">{fmt(c.pCore)}</span>
            <span className="mono r">{fmt(c.pCopper)}</span>
            <span className="mono r strong">{fmt(c.pTotal)} <small>W</small></span>
            <span className="mono r">{fmt(c.dT, 2)}</span>
            <span className="cell">{c.feasible ? <span className="badge low">ok</span> : <span className="badge high" title={c.fails.join(", ")}>{c.fails[0] ?? "fails"}</span>}</span>
          </button>
        ))}
      </div>}
    </div>
  );
}
