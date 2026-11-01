import { useMemo } from "react";
import type { Design } from "../../../core/design.ts";
import type { Geometry } from "../../../core/geometry.ts";
import { layerSvg } from "../../../core/export/svg.ts";
import { stackupRows } from "../../../core/steps.ts";
import { fmt } from "../../../core/format.ts";
import { CSS_PALETTE, windingVar } from "./palette";

export function LayersView({ d, g, layer, setLayer }: { d: Design; g: Geometry; layer: number; setLayer: (l: number) => void }) {
  const svg = useMemo(() => layerSvg(d, g, Math.min(layer, d.layers.length - 1), CSS_PALETTE), [d, g, layer]);
  const rows = useMemo(() => stackupRows(d), [d]);
  return (
    <div className="split-view">
      <div className="layer-list" role="tablist" aria-label="Copper layers">
        {d.layers.map((l, i) => (
          <button key={i} role="tab" aria-selected={i === layer} className={`layer-btn ${i === layer ? "active" : ""}`} onClick={() => setLayer(i)} data-test={`layer-${i + 1}`}>
            <i className="qdot" style={{ background: windingVar(l.winding) }} />
            <span className="lname">L{i + 1}</span>
            <span className="lmeta">{l.winding} · {l.turns}t × {fmt(l.widthMm)} mm</span>
          </button>
        ))}
      </div>
      <div className="drawing" data-test="layer-drawing" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="stackup">
        <div className="eyebrow">Fabrication stack-up</div>
        <table>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`su-${r.kind}`}>
                <td>{r.name}</td>
                <td className="mono">{fmt(r.thick * 1000)}<small> µm</small></td>
                <td className="su-detail">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="su-total">Board <strong className="num">{fmt(d.boardMm)}<small>mm</small></strong> in a <strong className="num">{fmt(d.mag.core.hw)}<small>mm</small></strong> window</div>
      </div>
    </div>
  );
}
