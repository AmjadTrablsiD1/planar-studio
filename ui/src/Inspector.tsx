import { useState } from "react";
import type { Design } from "../../core/design.ts";
import { assumptions, notEvaluated } from "../../core/coverage.ts";
import { fmt, pct } from "../../core/format.ts";
import { Metric, V } from "./Num";

type Tab = "evidence" | "checks" | "coverage";

export function Inspector({ d, picked, clearPick }: { d: Design | null; picked: number | null; clearPick: () => void }) {
  const [tab, setTab] = useState<Tab>("evidence");
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
              <div className="metric-row"><span>Core</span><strong className="num">{m.core.name}<small>{d.choice.set} · {m.mat.id}</small></strong></div>
              <div className="metric-row"><span>Turns Np : Ns</span><strong className="num" data-test="turns">{m.np} : {m.ns}<small>n = {fmt(m.n)} (target {fmt(m.nTarget)})</small></strong></div>
              <Metric label="Magnetising inductance" v={m.lm} unit="H" />
              <div className="metric-row"><span>Gap</span><strong className="num">{m.gapMm === null ? "none" : fmt(m.gapMm)}<small>{m.gapMm === null ? "" : "mm centre leg"}</small></strong></div>
              <Metric label="Peak flux at Amin (worst line)" v={m.bPkAmin} unit="T" q="q-B" />
              <Metric label="Flux swing p-p" v={m.dBpp} unit="T" q="q-B" />
              <Metric label="Core loss (iGSE)" v={m.pCore} unit="W" q="q-pcore" />
              <div className="metric-row"><span>Ae · le · Ve</span><strong className="num">{fmt(m.core.Ae)}<small>mm²</small> {fmt(m.core.le)}<small>mm</small> {fmt(m.core.Ve / 1000)}<small>cm³ {m.core.source}</small></strong></div>
            </section>
            <section className="inspector-section">
              <div className="section-title">Windings</div>
              {Object.entries(d.copper.byWinding).map(([w, b]) => (
                <div key={w} className="metric-row"><span><i className="qdot" style={{ background: w === "P" ? "var(--q-pri)" : w === "S2" ? "var(--q-sec2)" : "var(--q-sec)" }} />{w} · Irms <V v={b.irms} unit="A" /></span>
                  <span className="num-pair">Rdc <V v={b.rdc} unit="Ω" /> · <V v={b.loss} unit="W" /></span></div>
              ))}
              <Metric label="Leakage (to primary)" v={d.leakage} unit="H" />
              <Metric label="P–S capacitance" v={d.cps} unit="F" />
            </section>
            <section className="inspector-section">
              <div className="section-title">Board</div>
              <div className="metric-row"><span>Stack</span><strong className="num">{d.layers.length}<small>layers · {d.choice.oz} oz · {d.order.join("")}</small></strong></div>
              <Metric label="Thickness" v={d.boardMm} unit="mm" />
              <Metric label="P–S dielectric" v={d.iso.layerMm} unit="mm" />
              <Metric label="Copper temperature" v={d.copperTempC} unit="°C" />
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
