// Drawings inline core SVG with CSS variables, so they follow the theme live.
import type { Palette } from "../../../core/export/svg.ts";

export const CSS_PALETTE: Palette = {
  pri: "var(--q-pri)", sec: "var(--q-sec)", sec2: "var(--q-sec2)", text: "var(--text)", muted: "var(--muted)",
  line: "var(--line)", board: "var(--surface2)", core: "var(--secondary)", iso: "var(--gold)", diel: "var(--scene-fr4)",
  mmf: "var(--q-mmf)", via: "var(--secondary)", bg: "var(--bg)",
};

export const windingVar = (w: string) => (w === "P" ? "var(--q-pri)" : w === "S2" ? "var(--q-sec2)" : "var(--q-sec)");
