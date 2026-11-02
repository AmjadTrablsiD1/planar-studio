// The design report: one self-contained HTML page (no network, no scripts
// beyond a print button) with the numbers, the checks, the design path, the
// stack-up, every layer drawn to scale and the cross-section. Print it to PDF.

import { C } from "../constants.ts";
import { fmt, si, pct } from "../format.ts";
import type { Design } from "../design.ts";
import type { Geometry } from "../geometry.ts";
import { designSteps, stackupRows } from "../steps.ts";
import { assumptions, notEvaluated } from "../coverage.ts";
import { layerSvg, sectionSvg, type Palette } from "./svg.ts";
import { minmax } from "../waveform.ts";
import { MATH_CSS, mathHtml, richHtml } from "../math.ts";
import type { Rationale } from "../rationale.ts";

export const PRINT_PALETTE: Palette = {
  pri: "#B5651D", sec: "#14806F", sec2: "#4C8A22", text: "#1F2F3C", muted: "#56697A", line: "#B8C4CE",
  board: "#E3EDE6", core: "#5A6068", iso: "#E7B04B", diel: "#9FC7AE", mmf: "#A8327F", via: "#7D8791", bg: "#FFFFFF",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function waveSvg(d: Design): string {
  const W = 640, H = 170, pad = 34;
  const series: { name: string; y: Float64Array; colour: string }[] = Object.entries(d.mag.op.currents).map(([w, y]) => ({
    name: `i${w}`, y, colour: w === "P" ? PRINT_PALETTE.pri : w === "S2" ? PRINT_PALETTE.sec2 : PRINT_PALETTE.sec,
  }));
  let lo = 0, hi = 0;
  for (const s of series) { const [a, b] = minmax(s.y); lo = Math.min(lo, a); hi = Math.max(hi, b); }
  const span = hi - lo || 1;
  const X = (i: number, n: number) => pad + ((W - 2 * pad) * i) / (n - 1);
  const Y = (v: number) => H - pad / 2 - ((H - pad) * (v - lo)) / span;
  const lines = series.map((s) => {
    const step = Math.max(1, Math.floor(s.y.length / 256));
    const pts: string[] = [];
    for (let i = 0; i < s.y.length; i += step) pts.push(`${X(i, s.y.length).toFixed(1)},${Y(s.y[i]).toFixed(1)}`);
    return `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.colour}" stroke-width="1.6"/>`;
  });
  const legend = series.map((s, i) => `<text x="${pad + i * 70}" y="12" font-size="11" fill="${s.colour}">${s.name}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%"><line x1="${pad}" x2="${W - pad}" y1="${Y(0)}" y2="${Y(0)}" stroke="${PRINT_PALETTE.line}"/>${lines.join("")}${legend}
<text x="${W - pad}" y="${H - 4}" font-size="10" text-anchor="end" fill="${PRINT_PALETTE.muted}">one period ${si(1 / d.spec.fsw, "s")} · ${fmt(lo)} … ${fmt(hi)} A</text></svg>`;
}

export function reportHtml(d: Design, g: Geometry, generated: string, why?: Rationale | null): string {
  const s = d.spec, m = d.mag;
  const title = `${m.topo.label} planar transformer — ${m.core.name}`;
  const metric = (k: string, v: string) => `<div class="m"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`;
  const checks = d.checks.map((c) => `<tr class="${c.severity}"><td>${c.severity === "fail" ? "✗" : c.severity === "warn" ? "!" : "✓"}</td><td>${esc(c.label)}</td><td>${esc(c.detail)}</td></tr>`).join("");
  const steps = designSteps(d).map((sec) => `<h3>${esc(sec.title)}</h3>${sec.steps.map((st) => `<div class="step" id="step-${st.id}">
<div class="st">${richHtml(st.title)}</div><div class="fx">${mathHtml(st.formula)}</div><div class="res">${richHtml(st.result)}</div>
${st.why ? `<div class="why"><b>Why:</b> ${richHtml(st.why)}</div>` : ""}${st.note ? `<div class="note">${richHtml(st.note)}</div>` : ""}
${st.where?.length ? `<div class="where">${st.where.map(([sym, txt]) => `<span>${mathHtml(sym)} — ${richHtml(txt)}</span>`).join("")}</div>` : ""}</div>`).join("")}`).join("");
  const whyHtml = why?.groups.length
    ? why.groups.map((gr) => `<h3>${esc(gr.title)} — ${esc(gr.question)}</h3>
<table class="why-t"><tr><th>Option</th><th>Total loss</th><th>Result</th><th></th></tr>${gr.rows.map((r) => `<tr class="${r.chosen ? "chosen" : r.feasible ? "" : "fail"}"><td>${r.chosen ? "▶ " : ""}${esc(r.label)}</td><td class="mono">${r.pTotal === null ? "—" : `${r.approx ? "≈ " : ""}${si(r.pTotal, "W")}`}</td><td>${r.feasible ? (r.chosen ? "chosen" : "passes") : `fails: ${esc(r.fails.join(", "))}`}</td><td class="muted">${r.extra ? richHtml(r.extra) : ""}</td></tr>`).join("")}</table>
<p class="verdict">${richHtml(gr.verdict)}</p>`).join("")
    : `<p class="sub">The comparison with neighbouring designs was not available when this report was made.</p>`;
  const stack = stackupRows(d).map((r) => `<tr class="${r.kind}"><td>${esc(r.name)}</td><td>${fmt(r.thick * 1000)} µm</td><td>${esc(r.detail)}</td></tr>`).join("");
  const layers = d.layers.map((_, i) => `<figure>${layerSvg(d, g, i, PRINT_PALETTE)}</figure>`).join("");
  const losses = Object.entries(d.copper.byWinding).map(([w, b]) => `<tr><td>${w}</td><td>${si(b.irms, "A")}</td><td>${si(b.rdc, "Ω")}</td><td>${si(b.rac, "Ω")}</td><td>${si(b.loss, "W")}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--t:${PRINT_PALETTE.text};--m:${PRINT_PALETTE.muted};--l:${PRINT_PALETTE.line}}
*{box-sizing:border-box}body{margin:0;background:#EEF2F5;color:var(--t);font:12px/1.55 Inter,-apple-system,"Segoe UI",Arial,sans-serif}
main{max-width:980px;margin:0 auto;padding:28px 32px;background:#fff}
h1{font-size:22px;letter-spacing:-.4px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--l)}
h3{font-size:12px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:1px;color:var(--m)}
.sub{color:var(--m)}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:16px}
.m{border:1px solid var(--l);border-radius:5px;padding:8px 10px}.m span{display:block;font-size:10px;color:var(--m)}.m strong{font:500 15px "JetBrains Mono",Menlo,monospace}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #E3E8EC;padding:5px 6px;text-align:left;vertical-align:top}
th{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--m)}tr.fail td{color:#B23A22}tr.warn td{color:#7C5000}
tr.iso td{background:#FBF1DC}tr.copper td:first-child{font-weight:600}
.step{margin:6px 0 10px;padding-left:10px;border-left:2px solid var(--l)}.st{font-weight:600}code{font:11px "JetBrains Mono",Menlo,monospace;color:#3E4F5D}
.res{font-family:"JetBrains Mono",Menlo,monospace}.note{color:var(--m);font-size:11px}
.layers{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0;border:1px solid var(--l);border-radius:5px;padding:6px;break-inside:avoid}
figure svg{width:100%;height:auto;display:block}
${MATH_CSS}
.fx{margin:3px 0;font-size:13px}.why{font-size:11.5px;margin-top:3px}.where{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:10.5px;color:var(--m);margin-top:3px}
.why-t td,.why-t th{font-size:11px}.why-t tr.chosen td{font-weight:600;background:#EEF4FA}.why-t tr.fail td{color:#8A3A2A}
.verdict{margin:4px 0 12px;font-size:11.5px}.muted{color:var(--m)}.mono{font-family:"JetBrains Mono",Menlo,monospace}ul{padding-left:18px}.print{position:fixed;top:14px;right:14px;padding:8px 14px;border-radius:6px;border:0;background:#1F64A8;color:#fff;font-weight:600;cursor:pointer}
@media print{body{background:#fff}main{padding:0}.print{display:none}h2{break-after:avoid}}
</style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><main>
<h1>${esc(title)}</h1>
<div class="sub">${esc(C.app.name)} ${C.app.version} · ${esc(generated)} · ${esc(m.mat.vendor)} ${esc(m.mat.id)} · ${d.choice.set} · ${d.layers.length} layers ${d.choice.oz} oz · ${d.feasible ? "all checks pass" : "CHECKS FAIL — see below"}</div>
<div class="grid">
${metric("Input", `${fmt(s.vinMin)}–${fmt(s.vinMax)} V`)}${metric("Output", `${fmt(s.vout)} V · ${fmt(s.iout)} A`)}${metric("Switching", si(s.fsw, "Hz"))}${metric("Np : Ns", `${m.np} : ${m.ns}`)}
${metric("Lm", si(m.lm, "H"))}${metric("Gap", m.gapMm === null ? "none" : `${fmt(m.gapMm)} mm`)}${metric("Peak flux", si(m.bPkWorst, "T"))}${metric("Leakage", si(d.leakage, "H"))}
${metric("Core loss", si(m.pCore, "W"))}${metric("Copper loss", si(d.pCopper, "W"))}${metric("Total", `${si(d.pTotal, "W")} (${pct(d.lossPct)})`)}${metric("ΔT", `${fmt(d.dT)} °C`)}
</div>
<h2>Checks</h2><table>${checks}</table>
<h2>Why this design</h2>
<p class="sub">Each table changes one thing about the chosen design, lets the search re-optimise the rest, and shows what the alternative costs or which check it fails. ≈ marks the search's quick estimate (within about 1 %).</p>
${whyHtml}
<h2>Design path — the mathematics</h2>${steps}
<h2>Winding losses</h2><table><tr><th>Winding</th><th>Irms</th><th>Rdc</th><th>Rac,eff</th><th>Loss</th></tr>${losses}</table>
<h2>Waveforms at ${fmt(m.op.vin)} V</h2>${waveSvg(d)}
<h2>Stack-up (fabrication)</h2><table><tr><th>Layer</th><th>Thickness</th><th>Content</th></tr>${stack}</table>
<p class="sub">Board ${fmt(d.boardMm)} mm in a ${fmt(m.core.hw)} mm window. Junction vias: ${g.vias.map((v) => `${v.winding} L${v.from + 1}–L${v.to + 1}`).join(", ") || "none"}.</p>
<h2>Window cross-section</h2><figure>${sectionSvg(d, PRINT_PALETTE)}</figure>
<h2>Copper layers (top view, to scale)</h2><div class="layers">${layers}</div>
<h2>Assumptions</h2><ul>${assumptions(d).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
<h2>Not evaluated</h2><ul>${notEvaluated(d).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
</main></body></html>`;
}
