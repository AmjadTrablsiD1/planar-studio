import type { Design } from "../../../core/design.ts";
import type { Tradeoffs } from "../../../core/optimise.ts";
import { BarChart, LineChart } from "../Chart";

export function TradeoffsView({ d, t }: { d: Design; t: Tradeoffs }) {
  const set = d.choice.set;
  const cores = t.byCore.filter((c) => c.set === set);
  const byCore = {
    labels: cores.map((c) => c.core),
    stacks: [
      { name: "core", colour: "var(--q-pcore)", values: cores.map((c) => c.pCore) },
      { name: "copper", colour: "var(--q-pcu)", values: cores.map((c) => c.pCopper) },
    ],
    highlight: cores.findIndex((c) => c.core === d.choice.core),
  };
  const ns = t.byNs[`${d.choice.core}|${set}`] ?? [];
  const x = ns.map((r) => r.ns);
  const fr = {
    labels: d.copper.layers.map((_, i) => `L${i + 1}`),
    stacks: [{ name: "Fr = P/Pdc", colour: "var(--q-mmf)", values: d.copper.layers.map((r) => r.fr) }],
  };
  return (
    <div className="trade-view">
      <div className="wave-cell"><div className="eyebrow">Best feasible loss per core ({set}) — a dash means no design passes</div>
        <BarChart bars={byCore} yLabel="W" testId="chart-by-core" /></div>
      <div className="wave-cell"><div className="eyebrow">{d.choice.core} {set}: loss against secondary turns (fewer turns → more flux → more core loss)</div>
        {ns.length > 1
          ? <LineChart testId="chart-by-ns" xLabel="Ns" yLabel="W" series={[
              { name: "core", x, y: ns.map((r) => r.pCore), colour: "var(--q-pcore)" },
              { name: "copper", x, y: ns.map((r) => r.pCopper), colour: "var(--q-pcu)" },
              { name: "total", x, y: ns.map((r) => r.pTotal), colour: "var(--text)", dash: true },
            ]} />
          : <div className="chart-empty">Only one turn count passes on this core.</div>}
      </div>
      <div className="wave-cell"><div className="eyebrow">AC resistance factor per layer (all harmonics)</div>
        <BarChart bars={fr} yLabel="×" testId="chart-fr" /></div>
    </div>
  );
}
