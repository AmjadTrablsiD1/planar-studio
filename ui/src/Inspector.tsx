import { useMemo, useState, type ReactNode } from "react";
import type { Design } from "../../core/design.ts";
import { assumptions, notEvaluated } from "../../core/coverage.ts";
import { fmt, pct } from "../../core/format.ts";
import { designSteps } from "../../core/steps.ts";
import { mathHtml, richHtml } from "../../core/math.ts";
import type { Step } from "../../core/topologies/index.ts";
import { Metric, V } from "./Num";

type Tab = "evidence" | "checks" | "coverage";

/** The step behind a value: its formula, the numbers, and why — under the row that asked. */
function InfoBox({ step, onOpen }: { step: Step; onOpen: () => void }) {
  return (
    <div className="info-box" data-test={`info-${step.id}`}>
      <div className="info-title" dangerouslySetInnerHTML={{ __html: richHtml(step.title) }} />
      <div className="formula" dangerouslySetInnerHTML={{ __html: mathHtml(step.formula) }} />
      <div className="step-result" dangerouslySetInnerHTML={{ __html: richHtml(step.result) }} />
      {step.why && <div className="step-why" dangerouslySetInnerHTML={{ __html: richHtml(step.why) }} />}
      <button className="link-btn" onClick={onOpen}>All the steps and the alternatives →</button>
    </div>
  );
}

export function Inspector({ d, picked, clearPick, onOpenStep }: {
  d: Design | null; picked: number | null; clearPick: () => void; onOpenStep: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("evidence");
  const [open, setOpen] = useState<string | null>(null);
  const steps = useMemo(() => new Map((d ? designSteps(d) : []).flatMap((s) => s.steps).map((st) => [st.id, st])), [d]);

  /** A row whose value has an ⓘ: the button opens that value's step right under it. */
  const Row = ({ label, info, q, children }: { label: string; info: string; q?: string; children: ReactNode }) => {
    const st = steps.get(info);
    return (
      <>
        <div className="metric-row">
          <span>{q && <i className="qdot" style={{ background: `var(--${q})` }} />}{label}
            {st && <button className={`info-btn ${open === label ? "on" : ""}`} aria-expanded={open === label} aria-label={`How the ${label.toLowerCase()} is worked out`}
              onClick={() => setOpen(open === label ? null : label)} data-test={`info-btn-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>i</button>}
          </span>
          {children}
        </div>
        {st && open === label && <InfoBox step={st} onOpen={() => onOpenStep(info)} />}
      </>
    );
  };
  if (!d) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector-head">Inspector</div>
        <div className="inspector-scroll" tabIndex={0} role="region" aria-label="Inspector details"><p className="body-text">No design yet. Adjust the inputs on the left; the search runs as you type.</p></div>
      </aside>
    );
  }
  const m = d.mag;
  const fails = d.checks.filter((c) => c.severity === "fail");
  const warns = d.checks.filter((c) => c.severity === "warn");
  const sev = fails.length ? "high" : warns.length ? "medium" : "low";
  const L = picked !== null ? d.layers[picked] : null;
  const R = picked !== null ? d.copper.layers[picked] : null;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector-head">
        <span>{m.topo.label} · {m.core.id} {d.choice.set}</span>
        <span className={`badge ${sev}`} data-test="verdict">{fails.length ? `${fails.length} fail` : warns.length ? `${warns.length} warn` : "all checks pass"}</span>
      </div>
      <div className="hero">
        <div>
          <div className="eyebrow">Transformer loss</div>
          <div className="hero-value" data-test="hero-loss"><V v={d.pTotal} unit="W" /></div>
          <div className="hero-sub">{pct(d.lossPct)} of Pout · ΔT ≈ {fmt(d.dT, 2)} °C</div>
        </div>
        <div className="hero-split">
          <div><i className="qdot" style={{ background: "var(--q-pcore)" }} />core <V v={m.pCore} unit="W" /></div>
          <div><i className="qdot" style={{ background: "var(--q-pcu)" }} />copper <V v={d.pCopper} unit="W" /></div>
        </div>
      </div>
      <div className="inspector-tabs" role="tablist">
        {(["evidence", "checks", "coverage"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)} data-test={`tab-${t}`}>
            {t === "evidence" ? "Evidence" : t === "checks" ? `Checks${fails.length + warns.length ? ` (${fails.length + warns.length})` : ""}` : "Coverage"}
          </button>
        ))}
      </div>
      <div className="inspector-scroll" tabIndex={0} role="region" aria-label="Inspector details">
        {tab === "evidence" && (
          <>
            {L && R && (
              <section className="inspector-section picked" data-test="picked-layer">
                <div className="section-title">Layer L{picked! + 1} · {L.winding} <button className="link-btn" onClick={clearPick}>close</button></div>
                <Metric label="Turns × width" v={L.widthMm} unit="mm" title={`${L.turns} turns`} />
                <div className="metric-row"><span>Turns, connection</span><strong className="num">{L.turns}<small>{L.dir === "single" ? "single" : `spirals ${L.dir}`}, series {L.series + 1}{L.parallel > 1 ? ` · copy ${L.copy + 1}/${L.parallel}` : ""}</small></strong></div>
                <Metric label="Rdc (this layer)" v={R.rdc} unit="Ω" />
                <Metric label="Irms per turn" v={R.irms} unit="A" />
                <Metric label="Current density" v={R.jRms} unit="A/mm²" />
                <Metric label="Loss" v={R.loss} unit="W" q="q-pcu" />
                <Metric label="Fr = P / Pdc" v={R.fr} unit="×" />
                <Metric label="MMF top / bottom (fund.)" v={R.mmfTop} unit="" title={`bottom ${fmt(R.mmfBottom)} A·t`} />
              </section>
            )}
            <section className="inspector-section">
              <div className="section-title">Magnetics</div>
              <Row label="Core" info="core"><strong className="num">{m.core.name}<small>{d.choice.set} · {m.mat.id}</small></strong></Row>
              <Row label="Turns Np : Ns" info="ratio"><strong className="num" data-test="turns">{m.np} : {m.ns}<small>n = {fmt(m.n)} (target {fmt(m.nTarget)})</small></strong></Row>
              <Row label="Magnetising inductance" info={m.topo.gapped ? "lm" : "gap"}><V v={m.lm} unit="H" /></Row>
              <Row label="Gap" info="gap"><strong className="num">{m.gapMm === null ? "none" : fmt(m.gapMm)}<small>{m.gapMm === null ? "" : "mm centre leg"}</small></strong></Row>
              <Row label="Peak flux at Amin" info="flux" q="q-B"><V v={m.bPkAmin} unit="T" /></Row>
              <Row label="Flux swing p-p" info="flux" q="q-B"><V v={m.dBpp} unit="T" /></Row>
              <Row label="Core loss (iGSE)" info="coreloss" q="q-pcore"><V v={m.pCore} unit="W" /></Row>
              <Row label="Ae / Amin" info="core"><strong className="num">{fmt(m.core.Ae)} / {fmt(m.core.Amin)}<small>mm²</small></strong></Row>
              <Row label="le · Ve" info="core"><strong className="num">{fmt(m.core.le)}<small>mm</small> {fmt(m.core.Ve / 1000)}<small>cm³ {m.core.source}</small></strong></Row>
            </section>
            <section className="inspector-section">
              <div className="section-title">Windings</div>
              {Object.entries(d.copper.byWinding).map(([w, b]) => (
                <Row key={w} label={`${w} winding`} info="layerloss" q={w === "P" ? "q-pri" : w === "S2" ? "q-sec2" : "q-sec"}>
                  <span className="num-pair"><V v={b.irms} unit="A" /> · R<sub>dc</sub> <V v={b.rdc} unit="Ω" /> · <V v={b.loss} unit="W" /></span>
                </Row>
              ))}
              <Row label="Leakage (to primary)" info="leakage"><V v={d.leakage} unit="H" /></Row>
              <Row label="P–S capacitance" info="cps"><V v={d.cps} unit="F" /></Row>
            </section>
            <section className="inspector-section">
              <div className="section-title">Board</div>
              <Row label="Stack" info="stack"><strong className="num">{d.layers.length}<small>layers · {d.choice.oz} oz · {d.order.join("")}</small></strong></Row>
              <Row label="Trace widths" info="width"><strong className="num">{[...new Set(d.layers.map((l) => fmt(l.widthMm)))].join(" / ")}<small>mm</small></strong></Row>
              <Row label="Thickness" info="board"><V v={d.boardMm} unit="mm" /></Row>
              <Row label="P–S dielectric" info="iso"><V v={d.iso.layerMm} unit="mm" /></Row>
              <Row label="Temperature rise" info="thermal"><V v={d.dT} unit="°C" sig={2} /></Row>
              <Row label="Copper temperature" info="thermal"><V v={d.copperTempC} unit="°C" /></Row>
            </section>
          </>
        )}
        {tab === "checks" && (
          <ul className="checks" data-test="checks">
            {[...d.checks].sort((a, b) => ["fail", "warn", "info"].indexOf(a.severity) - ["fail", "warn", "info"].indexOf(b.severity)).map((c) => (
              <li key={c.id} className={c.severity}>
                <span className={`severity-dot ${c.severity === "fail" ? "high" : c.severity === "warn" ? "medium" : "low"}`} />
                <div><strong>{c.label}</strong><p>{c.detail}</p></div>
              </li>
            ))}
          </ul>
        )}
        {tab === "coverage" && (
          <>
            <section className="inspector-section"><div className="section-title">Assumptions</div>
              <ul className="assumption-list">{assumptions(d).map((a) => <li key={a}>{a}</li>)}</ul></section>
            <section className="inspector-section"><div className="section-title">Not evaluated</div>
              <ul className="assumption-list">{notEvaluated(d).map((a) => <li key={a}>{a}</li>)}</ul></section>
          </>
        )}
      </div>
    </aside>
  );
}
