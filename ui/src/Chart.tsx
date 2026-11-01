// A small SVG chart. Chrome (gutters, ticks, labels, strokes) scales with the
// container width through one factor, so it reads the same on a laptop and a
// 4K screen. Series colours are CSS variables from the quantity palette.
import { useEffect, useRef, useState } from "react";
import { C } from "./constants";
import { fmt } from "../../core/format.ts";

export type Series = { name: string; x: number[]; y: number[]; colour: string; dash?: boolean };
export type Bars = { labels: string[]; stacks: { name: string; values: (number | null)[]; colour: string }[]; highlight?: number };

function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo, step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<[number, number]>([C.ui.chart_ref_width_px, 220]);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize([e.contentRect.width, e.contentRect.height]));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size[0], size[1]];
}

export function LineChart({ series, xLabel, yLabel, testId }: { series: Series[]; xLabel: string; yLabel: string; testId?: string }) {
  const [ref, W, H] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const k = Math.max(0.75, Math.min(1.6, W / C.ui.chart_ref_width_px));
  const pl = 52 * k, pr = 14 * k, pt = 22 * k, pb = 34 * k;
  const xs = series.flatMap((s) => s.x), ys = series.flatMap((s) => s.y).filter(Number.isFinite);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
  if (y1 === y0) y1 = y0 + 1;
  const pad = (y1 - y0) * 0.06; y0 -= y0 < 0 ? pad : 0; y1 += pad;
  const X = (v: number) => pl + ((W - pl - pr) * (v - x0)) / (x1 - x0 || 1);
  const Y = (v: number) => H - pb - ((H - pt - pb) * (v - y0)) / (y1 - y0);
  const xt = niceTicks(x0, x1, 6), yt = niceTicks(y0, y1, 5);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = x0 + ((e.clientX - r.left - pl) / (W - pl - pr)) * (x1 - x0);
    setHover(v >= x0 && v <= x1 ? v : null);
  };
  const at = (s: Series, v: number) => {
    let i = 0;
    while (i + 1 < s.x.length && s.x[i + 1] < v) i++;
    return s.y[i];
  };
  return (
    <div className="chart" ref={ref} data-test={testId}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${yLabel} against ${xLabel}`}>
        {yt.map((v) => <g key={`y${v}`}><line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} className="grid" strokeWidth={k} />
          <text x={pl - 6 * k} y={Y(v)} fontSize={10 * k} textAnchor="end" dominantBaseline="middle" className="tick">{fmt(v)}</text></g>)}
        {xt.map((v) => <text key={`x${v}`} x={X(v)} y={H - pb + 14 * k} fontSize={10 * k} textAnchor="middle" className="tick">{fmt(v)}</text>)}
        {y0 < 0 && y1 > 0 && <line x1={pl} x2={W - pr} y1={Y(0)} y2={Y(0)} className="axis" strokeWidth={k} />}
        <text x={pl} y={pt - 8 * k} fontSize={10 * k} className="axis-label">{yLabel}</text>
        <text x={W - pr} y={H - 4 * k} fontSize={10 * k} textAnchor="end" className="axis-label">{xLabel}</text>
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.colour} strokeWidth={1.8 * k} strokeDasharray={s.dash ? `${5 * k} ${4 * k}` : undefined} strokeLinejoin="round"
            points={s.x.map((v, i) => `${X(v).toFixed(1)},${Y(s.y[i]).toFixed(1)}`).join(" ")} />
        ))}
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={pt} y2={H - pb} className="crosshair" strokeWidth={k} />}
        <g transform={`translate(${pl + 8 * k},${pt + 4 * k})`}>
          {series.map((s, i) => (
            <text key={s.name} x={i * 120 * k} y={0} fontSize={10.5 * k} fill={s.colour} className="legend">
              {s.name}{hover !== null ? ` ${fmt(at(s, hover))}` : ""}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}

export function BarChart({ bars, yLabel, testId, onPick }: { bars: Bars; yLabel: string; testId?: string; onPick?: (i: number) => void }) {
  const [ref, W, H] = useWidth();
  const k = Math.max(0.75, Math.min(1.6, W / C.ui.chart_ref_width_px));
  const pl = 52 * k, pr = 10 * k, pt = 22 * k, pb = 40 * k;
  const totals = bars.labels.map((_, i) => bars.stacks.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const y1 = Math.max(1e-9, ...totals) * 1.08;
  const Y = (v: number) => H - pb - ((H - pt - pb) * v) / y1;
  const n = bars.labels.length, bw = (W - pl - pr) / Math.max(1, n);
  const yt = niceTicks(0, y1, 5);
  return (
    <div className="chart" ref={ref} data-test={testId}>
      <svg width={W} height={H} role="img" aria-label={yLabel}>
        {yt.map((v) => <g key={v}><line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} className="grid" strokeWidth={k} />
          <text x={pl - 6 * k} y={Y(v)} fontSize={10 * k} textAnchor="end" dominantBaseline="middle" className="tick">{fmt(v)}</text></g>)}
        <text x={pl} y={pt - 8 * k} fontSize={10 * k} className="axis-label">{yLabel}</text>
        {bars.labels.map((lab, i) => {
          let acc = 0;
          const empty = bars.stacks.every((s) => s.values[i] === null);
          return (
            <g key={lab} onClick={() => onPick?.(i)} style={{ cursor: onPick ? "pointer" : undefined }}>
              {i === bars.highlight && <rect x={pl + i * bw + 1} y={pt} width={bw - 2} height={H - pt - pb} className="bar-hl" />}
              {bars.stacks.map((s) => {
                const v = s.values[i] ?? 0;
                const r = <rect key={s.name} x={pl + i * bw + bw * 0.18} width={bw * 0.64} y={Y(acc + v)} height={Math.max(0, Y(acc) - Y(acc + v))} fill={s.colour} rx={2 * k} />;
                acc += v;
                return r;
              })}
              {empty && <text x={pl + i * bw + bw / 2} y={H - pb - 6 * k} fontSize={9 * k} textAnchor="middle" className="tick">—</text>}
              <text x={pl + i * bw + bw / 2} y={H - pb + 14 * k} fontSize={9.5 * k} textAnchor="middle" className="tick">{lab}</text>
            </g>
          );
        })}
        <g transform={`translate(${W - pr - bars.stacks.length * 92 * k},${pt - 8 * k})`}>
          {bars.stacks.map((s, i) => <text key={s.name} x={i * 92 * k} y={0} fontSize={10.5 * k} fill={s.colour} className="legend">■ {s.name}</text>)}
        </g>
      </svg>
    </div>
  );
}
