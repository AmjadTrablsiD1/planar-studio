import { useMemo } from "react";
import type { Design } from "../../../core/design.ts";
import { designSteps } from "../../../core/steps.ts";

export function StepsView({ d }: { d: Design }) {
  const sections = useMemo(() => designSteps(d), [d]);
  return (
    <div className="steps-view" data-test="steps" tabIndex={0} role="region" aria-label="Design steps">
      {sections.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          {s.steps.map((st) => (
            <div className="step" key={st.title}>
              <div className="step-title">{st.title}</div>
              <code className="formula">{st.formula}</code>
              <div className="step-result">{st.result}</div>
              {st.note && <div className="step-note">{st.note}</div>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
