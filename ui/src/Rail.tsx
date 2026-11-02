// The design inputs. Every field names its unit; topology-specific fields
// come from the topology registry, so a new topology brings its own inputs.
import { useEffect, useState } from "react";
import type { Locks, Spec, TopologyId } from "../../core/types.ts";
import type { FieldError } from "../../core/spec.ts";
import { TOPOLOGIES } from "../../core/topologies/index.ts";
import { CORES } from "../../core/cores.ts";
import { MATERIALS } from "../../core/materials.ts";
import { C } from "./constants";
import { save, store } from "./theme";

type NumDef = { key: keyof Spec; label: string; unit: string; scale: number; hint?: string };

const ELECTRICAL: NumDef[] = [
  { key: "vout", label: "Vout", unit: "V", scale: 1 },
  { key: "iout", label: "Iout", unit: "A", scale: 1 },
  { key: "fsw", label: "Switching", unit: "kHz", scale: 1e3 },
  { key: "eta", label: "Converter η", unit: "%", scale: 0.01, hint: "Sets Pin from Pout" },
  { key: "vf", label: "Rectifier drop", unit: "V", scale: 1 },
];
const TOPO_FIELDS: Partial<Record<keyof Spec, NumDef>> = {
  dMax: { key: "dMax", label: "Dmax", unit: "%", scale: 0.01, hint: "Duty at Vin min" },
  ripple: { key: "ripple", label: "Ripple ratio r", unit: "ΔI/I", scale: 1, hint: "2 = CCM/DCM boundary" },
  tDead: { key: "tDead", label: "Dead time", unit: "ns", scale: 1e-9, hint: "Sets Lm for ZVS" },
  coss: { key: "coss", label: "Coss per switch", unit: "pF", scale: 1e-12 },
};
const HEAT: NumDef[] = [
  { key: "vWork", label: "Working voltage", unit: "Vrms", scale: 1, hint: "Across the barrier" },
  { key: "tAmb", label: "Ambient", unit: "°C", scale: 1 },
  { key: "dTMax", label: "Allowed rise", unit: "°C", scale: 1 },
  { key: "lossBudget", label: "Loss budget", unit: "% Pout", scale: 1, hint: "Stops the search from picking the biggest core" },
];

function NumField({ def, spec, set, error }: { def: NumDef; spec: Spec; set: (k: keyof Spec, v: number) => void; error?: string }) {
  const value = spec[def.key] as number;
  const shown = Number((value / def.scale).toPrecision(6)).toString();
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const id = `f-${def.key}`;
  return (
    <div className={`field ${error ? "invalid" : ""}`}>
      <label htmlFor={id}>{def.label}</label>
      <div className="input-unit">
        <input id={id} inputMode="decimal" value={text} data-test={id} aria-invalid={Boolean(error)}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value.replace(",", "."));
            if (e.target.value.trim() !== "" && Number.isFinite(v)) set(def.key, v * def.scale);
          }}
          onBlur={() => setText(shown)} />
        <span className="unit">{def.unit}</span>
      </div>
      {error ? <span className="hint err">{error}</span> : def.hint && <span className="hint">{def.hint}</span>}
    </div>
  );
}

function Select<T extends string | number>({ id, label, value, options, onChange, hint }: {
  id: string; label: string; value: T; options: [T, string][]; onChange: (v: T) => void; hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} data-test={id} value={String(value)} onChange={(e) => {
        const o = options.find(([v]) => String(v) === e.target.value);
        if (o) onChange(o[0]);
      }}>
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** A foldable group of inputs; whether it is open is remembered per browser. */
function Sec({ id, title, children, extra }: { id: string; title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  const key = `${C.ui.storage_key_view}.rail.${id}`;
  const [open, setOpen] = useState(() => store(key, true));
  return (
    <details className="rail-sec" open={open} onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; setOpen(o); save(key, o); }} data-test={`sec-${id}`}>
      <summary className="eyebrow">{title}{extra}</summary>
      {children}
    </details>
  );
}

export function Rail({ spec, setSpec, locks, setLocks, errors, onTopology, onPinAll, pinnedAll }: {
  spec: Spec; setSpec: (s: Spec) => void; locks: Locks; setLocks: (l: Locks) => void; errors: FieldError[];
  onTopology: (t: TopologyId) => void; onPinAll: () => void; pinnedAll: boolean;
}) {
  const set = (k: keyof Spec, v: unknown) => setSpec({ ...spec, [k]: v });
  const err = (k: keyof Spec) => errors.find((e) => e.field === k)?.message;
  const topo = TOPOLOGIES.find((t) => t.id === spec.topology)!;
  const lock = <K extends keyof Locks>(k: K, v: Locks[K] | "auto") => {
    const next = { ...locks };
    if (v === "auto") delete next[k]; else next[k] = v as Locks[K];
    setLocks(next);
  };
  const pinCount = Object.keys(locks).length;
  return (
    <aside className="rail" aria-label="Design inputs">
      <div className="eyebrow">Converter</div>
      <div className="segmented topo" role="radiogroup" aria-label="Topology">
        {TOPOLOGIES.map((t) => (
          <button key={t.id} role="radio" aria-checked={t.id === spec.topology} className={t.id === spec.topology ? "active" : ""}
            onClick={() => onTopology(t.id)} title={t.description} data-test={`topo-${t.id}`}>{t.short}</button>
        ))}
      </div>
      <p className="topo-desc">{topo.label} — {topo.description}</p>

      <div className="row3">
        {(["vinMin", "vinNom", "vinMax"] as const).map((k) => (
          <NumField key={k} def={{ key: k, label: k === "vinMin" ? "Vin min" : k === "vinNom" ? "nom" : "max", unit: "V", scale: 1 }} spec={spec} set={set} error={err(k)} />
        ))}
      </div>
      <div className="row2">
        {ELECTRICAL.map((f) => <NumField key={f.key} def={f} spec={spec} set={set} error={err(f.key)} />)}
        {topo.fields.filter((k) => TOPO_FIELDS[k]).map((k) => <NumField key={k} def={TOPO_FIELDS[k]!} spec={spec} set={set} error={err(k)} />)}
        {topo.fields.includes("rectifier") && (
          <Select id="f-rectifier" label="Rectifier" value={spec.rectifier} onChange={(v) => set("rectifier", v)}
            options={[["fullbridge", "Full bridge"], ["centertap", "Centre tap"]]} />
        )}
      </div>

      <Sec id="heat" title="Isolation and heat">
      <div className="row2">
        <Select id="f-insulation" label="Insulation" value={spec.insulation} onChange={(v) => set("insulation", v)}
          options={C.isolation.classes.map((c) => [c as Spec["insulation"], c[0].toUpperCase() + c.slice(1)])} />
        {HEAT.map((f) => <NumField key={f.key} def={f} spec={spec} set={set} error={err(f.key)} />)}
      </div>

      </Sec>

      <Sec id="board" title="Board">
      <div className="row2">
        <Select id="f-maxLayers" label="Max layers" value={spec.maxLayers} onChange={(v) => set("maxLayers", v)}
          options={C.pcb.layer_counts.map((n) => [n, `${n} layers`] as [number, string])} />
        <NumField def={{ key: "dielectric", label: "Dielectric", unit: "mm", scale: 1, hint: "Between same-side layers" }} spec={spec} set={set} error={err("dielectric")} />
      </div>
      <div className="field">
        <span className="label">Copper weights allowed</span>
        <div className="chips" role="group" aria-label="Copper weights">
          {C.pcb.copper_options.map((oz) => {
            const on = spec.copper.includes(oz);
            return (
              <button key={oz} className={`chip ${on ? "on" : ""}`} aria-pressed={on} data-test={`oz-${oz}`}
                onClick={() => set("copper", on ? spec.copper.filter((x) => x !== oz) : [...spec.copper, oz].sort())}>{oz} oz</button>
            );
          })}
        </div>
        {err("copper") && <span className="hint err">{err("copper")}</span>}
      </div>
      <div className="field">
        <span className="label">Single-turn layers</span>
        <div className="chips" role="radiogroup" aria-label="Single-turn layers">
          {([[true, "Allow"], [false, "Avoid"]] as const).map(([v, label]) => (
            <button key={label} role="radio" aria-checked={spec.singleTurnLayers === v} className={`chip ${spec.singleTurnLayers === v ? "on" : ""}`}
              onClick={() => set("singleTurnLayers", v)} data-test={`single-${label.toLowerCase()}`}>{label}</button>
          ))}
        </div>
        <span className="hint">{spec.singleTurnLayers
          ? "One wide turn per layer is allowed: lowest resistance, a via per turn."
          : "Turns spread as spirals of two or more per layer (a one-turn winding is exempt)."}</span>
      </div>

      </Sec>

      <Sec id="search" title="Search">
      <div className="row2">
        <Select id="f-objective" label="Objective" value={spec.objective} onChange={(v) => set("objective", v)}
          options={C.optimiser.objectives.map((o) => [o as Spec["objective"], C.optimiser.objective_labels[o as keyof typeof C.optimiser.objective_labels]])} />
        <Select id="f-operatingPoint" label="Losses at" value={spec.operatingPoint} onChange={(v) => set("operatingPoint", v)}
          options={[["min", "Vin min"], ["nom", "Vin nom"], ["max", "Vin max"]]} />
        <Select id="f-family" label="Core family" value={spec.family} onChange={(v) => set("family", v)}
          options={[["all", "E and ER"], ["E", "E / ELP"], ["ER", "ER planar"]]} />
        <Select id="f-material" label="Ferrite" value={spec.material} onChange={(v) => set("material", v)}
          options={[["auto", "Auto (by fsw)"], ...MATERIALS.map((m) => [m.id, `${m.id} · ${m.vendor}`] as [string, string])]} />
      </div>

      </Sec>

      <Sec id="pins" title="Pins" extra={<span className="pin-tools"><span className="count-pill">{pinCount}</span></span>}>
        <div className="pin-actions">
          <button className="link-btn" onClick={() => setLocks({})} disabled={!pinCount} data-test="unpin-all">clear pins</button>
          <button className="link-btn" onClick={onPinAll} disabled={pinnedAll} data-test="pin-all" title="Pin every choice of the selected design, then change one">pin the selected design</button>
        </div>
      <div className="row2">
        <Select id="pin-core" label="Core" value={locks.core ?? "auto"} onChange={(v) => lock("core", v)}
          options={[["auto", "Auto"], ...CORES.filter((c) => spec.family === "all" || c.family === spec.family).map((c) => [c.id, c.id] as [string, string])]} />
        <Select id="pin-set" label="Set" value={locks.set ?? "auto"} onChange={(v) => lock("set", v as Locks["set"] | "auto")}
          options={[["auto", "Auto"], ["E+PLT", "E + plate"], ["E+E", "E + E"]]} />
        <Select id="pin-layers" label="Layers" value={locks.layers ?? "auto"} onChange={(v) => lock("layers", v)}
          options={[["auto", "Auto"], ...C.pcb.layer_counts.map((n) => [n, String(n)] as [number, string])]} />
        <Select id="pin-oz" label="Copper" value={locks.oz ?? "auto"} onChange={(v) => lock("oz", v)}
          options={[["auto", "Auto"], ...C.pcb.copper_options.map((o) => [o, `${o} oz`] as [string, string])]} />
        <Select id="pin-ns" label="Ns" value={locks.ns ?? "auto"} onChange={(v) => lock("ns", v)}
          options={[["auto", "Auto"], ...Array.from({ length: C.optimiser.ns_max }, (_, i) => [i + 1, String(i + 1)] as [number, string])]} />
        <Select id="pin-pattern" label="Stack" value={locks.pattern ?? "auto"} onChange={(v) => lock("pattern", v as Locks["pattern"] | "auto")}
          options={[["auto", "Auto"], ...C.optimiser.patterns.map((p) => [p, C.optimiser.pattern_labels[p as keyof typeof C.optimiser.pattern_labels]] as [string, string])]} />
      </div>
      </Sec>
    </aside>
  );
}
