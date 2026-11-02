import { useEffect, useMemo, useRef } from "react";
import type { Design } from "../../../core/design.ts";
import type { Rationale } from "../../../core/rationale.ts";
import { designSteps } from "../../../core/steps.ts";
import { mathHtml, richHtml } from "../../../core/math.ts";
import { si } from "../../../core/format.ts";

const H = (html: string) => ({ __html: html });

export function StepsView({ d, why, focus, onFocused }: { d: Design; why: Rationale | null; focus: string | null; onFocused: () => void }) {
  const sections = useMemo(() => designSteps(d), [d]);
  const host = useRef<HTMLDivElement>(null);

  // An ⓘ button sent us here: bring that step into view and mark it briefly.
  useEffect(() => {
    if (!focus || !host.current) return;
    const el = host.current.querySelector<HTMLElement>(`[data-step="${focus}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      const t = window.setTimeout(() => { el.classList.remove("flash"); onFocused(); }, 1600);
      return () => window.clearTimeout(t);
    }
    onFocused();
  }, [focus, onFocused]);

  return (
    <div className="steps-view" data-test="steps" tabIndex={0} role="region" aria-label="Design steps" ref={host}>
      <section className="why-sec" data-test="why">
        <h3>Why this design</h3>
        <p className="step-note">Each table changes one thing about this design, lets the search re-optimise the rest, and shows what the alternative costs or which check it fails. ≈ is the search's quick estimate (within about 1 %).</p>
        {!why && <div className="why-wait">Working out the alternatives…</div>}
        {why?.groups.map((g) => (
          <div className="why-group" key={g.aspect} data-why={g.aspect}>
            <div className="step-title">{g.title} — <span className="q">{g.question}</span></div>
            <table className="why-t">
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.label} className={r.chosen ? "chosen" : r.feasible ? "" : "fail"}>
                    <td>{r.chosen ? "▶ " : ""}{r.label}</td>
                    <td className="mono">{r.pTotal === null ? "—" : `${r.approx ? "≈ " : ""}${si(r.pTotal, "W")}`}</td>
                    <td>{r.feasible ? (r.chosen ? "chosen" : "passes") : `fails: ${r.fails.join(", ")}`}</td>
                    <td className="muted" dangerouslySetInnerHTML={H(r.extra ? richHtml(r.extra) : "")} />
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="verdict" dangerouslySetInnerHTML={H(richHtml(g.verdict))} />
          </div>
        ))}
      </section>
      {sections.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          {s.steps.map((st) => (
            <div className="step" key={st.id} data-step={st.id}>
              <div className="step-title" dangerouslySetInnerHTML={H(richHtml(st.title))} />
              <div className="formula" dangerouslySetInnerHTML={H(mathHtml(st.formula))} />
              <div className="step-result" dangerouslySetInnerHTML={H(richHtml(st.result))} />
              {st.why && <div className="step-why"><b>Why</b> <span dangerouslySetInnerHTML={H(richHtml(st.why))} /></div>}
              {st.note && <div className="step-note" dangerouslySetInnerHTML={H(richHtml(st.note))} />}
              {st.where?.length ? (
                <div className="step-where">{st.where.map(([sym, txt]) => (
                  <span key={sym}><span dangerouslySetInnerHTML={H(mathHtml(sym))} /> — <span dangerouslySetInnerHTML={H(richHtml(txt))} /></span>
                ))}</div>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
