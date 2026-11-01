import { useMemo } from "react";
import type { Design } from "../../../core/design.ts";
import { sectionSvg } from "../../../core/export/svg.ts";
import { BarChart } from "../Chart";
import { CSS_PALETTE } from "./palette";

export function SectionView({ d, picked, onPick }: { d: Design; picked: number | null; onPick: (l: number) => void }) {
  const svg = useMemo(() => sectionSvg(d, CSS_PALETTE), [d]);
  const windings = [...new Set(d.layers.map((l) => l.winding))];
  const bars = {
    labels: d.layers.map((_, i) => `L${i + 1}`),
    stacks: windings.map((w) => ({
      name: w, colour: w === "P" ? "var(--q-pri)" : w === "S2" ? "var(--q-sec2)" : "var(--q-sec)",
      values: d.copper.layers.map((r) => (r.winding === w ? r.loss : null)),
    })),
    highlight: picked ?? undefined,
  };
  return (
    <div className="section-view">
      <div className="drawing wide" data-test="section-drawing" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="section-side">
        <div className="eyebrow">Copper loss per layer (W) — click to inspect</div>
        <BarChart bars={bars} yLabel="W" testId="layer-loss-chart" onPick={onPick} />
        <p className="body-text">
          The MMF across the window is what drives proximity loss: each layer loses in proportion to the field on its two faces.
          Interleaving primary and secondary keeps that field small and lets it change sign between layers.
        </p>
      </div>
    </div>
  );
}
