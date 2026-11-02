// A small TeX-like notation for the design formulas, rendered to HTML that
// needs no font or script: the app and the printed report both use it, so a
// formula reads the same in both. Supported:
//   X_{sub}  X_a   X^{sup}  X^2   \frac{a}{b}   \sqrt{x}   \hat{B}   \overline{x}
//   \text{words}   Greek and operators by name (\alpha … \Delta, \cdot, \le …)
// Anything else is printed as written (HTML-escaped).

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", varepsilon: "ε", eta: "η",
  theta: "θ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ", Sigma: "Σ", tau: "τ", phi: "φ", Phi: "Φ", omega: "ω",
  cdot: "·", times: "×", le: "≤", ge: "≥", approx: "≈", ne: "≠", to: "→", Rightarrow: "⇒", infty: "∞",
  int: "∫", sum: "Σ", pm: "±", partial: "∂", deg: "°", left: "", right: "", ln: "ln\u2009", max: "max", min: "min", exp: "exp", ",": " ", " ": " ", ";": " ",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A formula: math font, sub/superscripts, fractions. */
export function mathHtml(src: string): string {
  return render(src, "math");
}

/** Prose with inline notation (V_{in}, \\frac …) in the normal text font. */
export function richHtml(src: string): string {
  return render(src, "rich");
}

function render(src: string, cls: string): string {
  let i = 0;
  const peek = () => src[i];

  /** One argument: a {group}, a \command, or a single character. */
  function arg(): string {
    if (peek() === "{") {
      i++;
      const out = seq("}");
      i++;
      return out;
    }
    if (peek() === "\\") return command();
    return esc(src[i++] ?? "");
  }

  function command(): string {
    i++; // backslash
    let name = "";
    if (/[A-Za-z]/.test(peek() ?? "")) while (/[A-Za-z]/.test(peek() ?? "")) name += src[i++];
    else name = src[i++] ?? "";
    switch (name) {
      case "frac": {
        const a = arg(), b = arg();
        return `<span class="m-frac"><span class="m-num">${a}</span><span class="m-den">${b}</span></span>`;
      }
      case "sqrt": return `<span class="m-sqrt">√<span class="m-rad">${arg()}</span></span>`;
      case "hat": return `<span class="m-hat">${arg()}̂</span>`;
      case "overline": return `<span class="m-bar">${arg()}</span>`;
      case "text": return `<span class="m-text">${arg()}</span>`;
      default: return SYMBOLS[name] ?? esc(name);
    }
  }

  function seq(stop?: string): string {
    let out = "";
    while (i < src.length && peek() !== stop) {
      const ch = peek();
      if (ch === "\\") out += command();
      else if (ch === "_") { i++; out += `<sub>${arg()}</sub>`; }
      else if (ch === "^") { i++; out += `<sup>${arg()}</sup>`; }
      else if (ch === "{") { i++; out += seq("}"); i++; }
      else { out += esc(ch); i++; }
    }
    return out;
  }

  return `<span class="${cls}">${seq()}</span>`;
}

/** Plain text of a formula, for tooltips and accessibility. */
export function mathText(src: string): string {
  return mathHtml(src).replace(/<sub>/g, "_").replace(/<sup>/g, "^").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** The CSS the markup needs; the app has it in app.css, the report inlines this. */
export const MATH_CSS = `.math{font-family:"Cambria Math","STIX Two Math","Times New Roman",serif;font-size:1.08em;white-space:normal}
.math sub,.math sup,.rich sub,.rich sup{font-size:.72em;line-height:0}
.m-frac{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 .15em}
.m-num{border-bottom:1px solid currentColor;padding:0 .2em}.m-den{padding:0 .2em}
.m-sqrt .m-rad{border-top:1px solid currentColor;padding:0 .1em}.m-bar{border-top:1px solid currentColor}
.m-text{font-family:Inter,Arial,sans-serif;font-size:.9em}`;
