// Themes are data (shared/themes.json); this applies one as CSS variables.
import { C, THEMES, THEME_IDS } from "./constants";

export function initialTheme(): string {
  try {
    const saved = localStorage.getItem(C.ui.storage_key_theme);
    if (saved && THEME_IDS.includes(saved)) return saved;
  } catch { /* storage blocked: fall through */ }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? C.ui.default_theme_light : C.ui.default_theme_dark;
}

export function applyTheme(name: string): void {
  const t = THEMES[name];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t)) {
    if (k === "label" || k === "scheme") continue;
    root.style.setProperty(`--${k}`, v);
  }
  root.style.colorScheme = t.scheme;
  root.dataset.theme = name;
  try { localStorage.setItem(C.ui.storage_key_theme, name); } catch { /* ignore */ }
}

export function themeColour(name: string, token: string): string {
  return THEMES[name][token];
}

export function store<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s === null ? fallback : (JSON.parse(s) as T);
  } catch { return fallback; }
}

export function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
