// Numbers are typeset, not printed: mono digits, unit split off, rule-16 digits.
import { fmtSI } from "../../core/format.ts";

export function V({ v, unit, sig = 3 }: { v: number; unit: string; sig?: number }) {
  const r = fmtSI(v, unit, sig);
  return <strong className="num">{r.num}{r.unit && <small>{r.unit}</small>}</strong>;
}

export function Metric({ label, v, unit, sig, q, title }: { label: string; v: number; unit: string; sig?: number; q?: string; title?: string }) {
  return (
    <div className="metric-row" title={title}>
      <span>{q && <i className="qdot" style={{ background: `var(--${q})` }} />}{label}</span>
      <V v={v} unit={unit} sig={sig} />
    </div>
  );
}
