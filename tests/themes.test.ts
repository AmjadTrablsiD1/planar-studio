// Both themes stay readable: text, quantity colours and accents against all
// four surfaces; WCAG 2 contrast, 4.5 for text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const THEMES = JSON.parse(readFileSync(new URL("../shared/themes.json", import.meta.url), "utf8")) as Record<string, Record<string, string>>;
const ids = Object.keys(THEMES).filter((k) => !k.startsWith("_"));
const lum = (hex: string) => {
  const c = hex.replace("#", "").match(/../g)!.map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const TEXT = ["text", "secondary", "muted", "blue", "positive", "gold", "coral", "q-pri", "q-sec", "q-sec2", "q-B", "q-mmf", "q-pcore", "q-pcu"];
const SURFACES = ["bg", "surface", "surface2", "raised"];

test("one dark and one light theme", () => {
  assert.ok(ids.some((i) => THEMES[i].scheme === "dark"));
  assert.ok(ids.some((i) => THEMES[i].scheme === "light"));
});

for (const id of ids) test(`theme ${id}: every token present and readable`, () => {
  const t = THEMES[id], ref = THEMES[ids[0]];
  for (const k of Object.keys(ref)) assert.ok(k in t, `${id}: missing ${k}`);
  const bad: string[] = [];
  for (const k of TEXT) for (const s of SURFACES) { const r = contrast(t[k], t[s]); if (r < 4.5) bad.push(`${k} on ${s}: ${r.toFixed(2)}`); }
  const r = contrast(t.accentText, t.blue); if (r < 4.5) bad.push(`accentText on blue: ${r.toFixed(2)}`);
  assert.deepEqual(bad, [], `${id}: ${bad.join(", ")}`);
});
