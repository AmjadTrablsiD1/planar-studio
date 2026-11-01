import { useMemo } from "react";
import type { Design } from "../../../core/design.ts";
import { LineChart } from "../Chart";
import { windingVar } from "./palette";

const down = (x: Float64Array, n = 256) => {
  const step = Math.max(1, Math.floor(x.length / n));
  const out: number[] = [];
  for (let i = 0; i < x.length; i += step) out.push(x[i]);
  out.push(x[0]);
  return out;
};

export function WaveformsView({ d }: { d: Design }) {
  const T = 1 / d.spec.fsw;
  const data = useMemo(() => {
    const ys = Object.entries(d.mag.op.currents);
    const n = down(ys[0][1]).length;
    const t = Array.from({ length: n }, (_, i) => (i / (n - 1)) * T * 1e6);
    return {
      currents: ys.map(([w, y]) => ({ name: `i${w} (A)`, x: t, y: down(y), colour: windingVar(w) })),
      flux: [{ name: "B (mT)", x: t, y: down(d.mag.b).map((v) => v * 1000), colour: "var(--q-B)" }],
      volts: [{ name: "vP (V)", x: t, y: down(d.mag.op.vPri), colour: "var(--q-pri)" }],
    };
  }, [d, T]);
  return (
    <div className="wave-view">
      <div className="wave-cell"><div className="eyebrow">Winding currents · magnetising sense · {d.mag.op.mode} at {d.mag.op.vin} V</div>
        <LineChart series={data.currents} xLabel="t (µs)" yLabel="A" testId="chart-currents" /></div>
      <div className="wave-cell"><div className="eyebrow">Flux density in the centre leg</div>
        <LineChart series={data.flux} xLabel="t (µs)" yLabel="mT" testId="chart-flux" /></div>
      <div className="wave-cell"><div className="eyebrow">Primary winding voltage</div>
        <LineChart series={data.volts} xLabel="t (µs)" yLabel="V" testId="chart-volts" /></div>
    </div>
  );
}
