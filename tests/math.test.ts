// The formula notation shared by the app and the report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mathHtml, mathText, richHtml } from "../core/math.ts";
import { optimise } from "../core/optimise.ts";
import { defaultSpec } from "../core/spec.ts";
import { designSteps } from "../core/steps.ts";
import { TOPOLOGIES } from "../core/topologies/index.ts";
import type { TopologyId } from "../core/types.ts";

test("sub/superscripts, fractions, roots, Greek and spacers", () => {
  assert.equal(mathHtml("V_{in,min} D_{max}"), '<span class="math">V<sub>in,min</sub> D<sub>max</sub></span>');
  assert.equal(mathText("N_p^2"), "N_p^2");
  assert.match(mathHtml("\\frac{a}{b}"), /m-frac.*m-num">a<.*m-den">b</);
  assert.match(mathHtml("\\sqrt{A_e}"), /√<span class="m-rad">A<sub>e<\/sub>/);
  assert.equal(mathText("\\mu_0 \\le \\Delta"), "μ_0 ≤ Δ");
  assert.equal(mathText("a\\;b\\,c"), "a b c");
  assert.equal(mathText("x < y & z"), "x < y & z");
  assert.match(richHtml("I_{out}"), /^<span class="rich">I<sub>out<\/sub>/);
});

test("every design step renders without a raw command name or a stray brace", () => {
  for (const id of TOPOLOGIES.map((t) => t.id) as TopologyId[]) {
    const d = optimise(defaultSpec(id)).best!;
    for (const sec of designSteps(d)) for (const st of sec.steps) {
      for (const field of [st.formula, st.result, st.why ?? "", st.note ?? "", ...(st.where ?? []).flat()]) {
        const text = mathText(field);
        assert.ok(!/\\[A-Za-z]|[{}]/.test(text), `${id} ${st.id}: "${text}" from "${field}"`);
        assert.ok(!/\b(left|right|frac|sqrt|text)\b/.test(text), `${id} ${st.id}: command name in "${text}"`);
      }
      assert.ok(st.id, `${id}: step "${st.title}" has no id`);
    }
  }
});
