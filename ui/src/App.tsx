import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locks, Spec, TopologyId } from "../../core/types.ts";
import { defaultSpec, validate } from "../../core/spec.ts";
import { evaluate } from "../../core/design.ts";
import { buildGeometry } from "../../core/geometry.ts";
import { EXPORTERS, baseName } from "../../core/export/index.ts";
import type { Candidate, Tradeoffs } from "../../core/optimise.ts";
import { fmt, si } from "../../core/format.ts";
import { C } from "./constants";
import { applyTheme, initialTheme, save, store } from "./theme";
import { Rail } from "./Rail";
import { Inspector } from "./Inspector";
import { Candidates } from "./Candidates";
import { Viewport3D, type ViewState, type Cam } from "./views/Viewport3D";
import { LayersView } from "./views/LayersView";
import { SectionView } from "./views/SectionView";
import { WaveformsView } from "./views/WaveformsView";
import { TradeoffsView } from "./views/TradeoffsView";
import { StepsView } from "./views/StepsView";
import type { Reply, Request } from "./optimiser.worker";

type View = "3d" | "layers" | "section" | "waveforms" | "tradeoffs" | "steps";
type Run = {
  status: "idle" | "running" | "done" | "error";
  progress: number;
  spec?: Spec;
  candidates: Candidate[];
  tradeoffs?: Tradeoffs;
  evaluated: number; feasibleCount: number; pruned: number; ms: number;
  tally: Record<string, number>;
  error?: string;
};

const EMPTY: Run = { status: "idle", progress: 0, candidates: [], evaluated: 0, feasibleCount: 0, pruned: 0, ms: 0, tally: {} };

function loadSpec(): Spec {
  const s = store<Spec | null>(C.ui.storage_key_spec, null);
  if (!s) return defaultSpec("flyback");
  // A stored spec from an older version may miss fields: fill them from the defaults.
  return { ...defaultSpec(s.topology ?? "flyback"), ...s };
}

function download(name: string, data: string | Uint8Array, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [spec, setSpecRaw] = useState<Spec>(loadSpec);
  const [locks, setLocks] = useState<Locks>(() => store<Locks>(`${C.ui.storage_key_spec}.locks`, {}));
  const [run, setRun] = useState<Run>(EMPTY);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<View>(() => store<View>(C.ui.storage_key_view, "3d"));
  const [picked, setPicked] = useState<number | null>(null);
  const [layerView, setLayerView] = useState(0);
  const [vs, setVs] = useState<ViewState>({ cam: "3d", explode: false, cut: false, showCore: true, visible: [] });
  const [fitTick, setFitTick] = useState(0);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const runId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => save(C.ui.storage_key_spec, spec), [spec]);
  useEffect(() => save(`${C.ui.storage_key_spec}.locks`, locks), [locks]);
  useEffect(() => save(C.ui.storage_key_view, view), [view]);

  const setSpec = useCallback((s: Spec) => setSpecRaw(s), []);
  const errors = useMemo(() => validate(spec), [spec]);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), C.ui.toast_ms);
  }, []);

  /* ------------------------------------------------ search in a worker */
  useEffect(() => {
    if (errors.length) return;
    const timer = window.setTimeout(() => {
      // A new edit supersedes the running search: terminate it rather than queue.
      worker.current?.terminate();
      const w = new Worker(new URL("./optimiser.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      const id = ++runId.current;
      const runSpec = spec;
      setRun((r) => ({ ...r, status: "running", progress: 0 }));
      w.onmessage = (e: MessageEvent<Reply>) => {
        const m = e.data;
        if (m.id !== runId.current) return;
        if (m.kind === "progress") setRun((r) => ({ ...r, progress: m.done / m.total }));
        else if (m.kind === "error") { setRun((r) => ({ ...r, status: "error", error: m.message })); w.terminate(); }
        else {
          setRun({ status: "done", progress: 1, spec: runSpec, candidates: m.candidates, tradeoffs: m.tradeoffs,
            evaluated: m.evaluated, feasibleCount: m.feasibleCount, pruned: m.pruned, ms: m.ms, tally: m.tally });
          setSelected(0);
          setPicked(null);
          w.terminate();
          if (worker.current === w) worker.current = null;
        }
      };
      w.onerror = (e) => { setRun((r) => ({ ...r, status: "error", error: e.message || "The search worker failed to start." })); };
      w.postMessage({ id, spec: runSpec, locks } satisfies Request);
    }, C.ui.debounce_ms);
    return () => window.clearTimeout(timer);
  }, [spec, locks, errors.length]);
  useEffect(() => () => worker.current?.terminate(), []);

  /* ------------------------------------------------ the selected design */
  const cand = run.candidates[selected] ?? null;
  const design = useMemo(() => {
    if (!cand || !run.spec || !Number.isFinite(cand.pTotal)) return null;
    try { return evaluate(run.spec, cand.choice); } catch { return null; }
  }, [cand, run.spec]);
  const geom = useMemo(() => (design ? buildGeometry(design.mag.core, design.layers, design.terminalMm, design.viaGapMm) : null), [design]);
  useEffect(() => {
    if (design) setVs((v) => ({ ...v, visible: design.layers.map((_, i) => v.visible[i] ?? true) }));
  }, [design]);
  useEffect(() => { if (design && layerView >= design.layers.length) setLayerView(0); }, [design, layerView]);

  const onTopology = (t: TopologyId) => {
    const d = defaultSpec(t);
    // Keep the board and search settings; take the converter defaults of the new topology.
    setSpecRaw({ ...d, tAmb: spec.tAmb, dTMax: spec.dTMax, lossBudget: spec.lossBudget, maxLayers: spec.maxLayers, copper: spec.copper,
      dielectric: spec.dielectric, singleTurnLayers: spec.singleTurnLayers, family: spec.family, material: spec.material, objective: spec.objective, operatingPoint: spec.operatingPoint });
    setLocks({});
  };
  const pinAll = () => {
    if (!design) return;
    const c = design.choice;
    setLocks({ core: c.core, set: c.set, material: c.material, layers: c.layers, oz: c.oz, ns: c.ns, np: c.np, pattern: c.pattern });
    say("Pinned every choice of this design — change one pin to explore around it.");
  };

  const doExport = (id: string) => {
    setMenu(false);
    if (!design || !geom) return;
    const ex = EXPORTERS.find((e) => e.id === id)!;
    try {
      download(`${baseName(design)}.${ex.ext}`, ex.build(design, geom), ex.mime);
      say(`${ex.label} saved as ${baseName(design)}.${ex.ext}`);
    } catch (e) { setLoadError(`Export failed: ${e instanceof Error ? e.message : String(e)}. Nothing was written; the design is unchanged.`); }
  };
  const saveDesign = () => {
    const body = JSON.stringify({ app: C.app.id, version: C.app.version, spec, locks, choice: design?.choice ?? null }, null, 2);
    download(`${design ? baseName(design) : "planar-design"}.planar.json`, body, "application/json");
    say("Design saved.");
  };
  const openDesign = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== C.app.id || !j.spec) throw new Error("this is not a Planar Studio design file");
      const s: Spec = { ...defaultSpec(j.spec.topology), ...j.spec };
      const errs = validate(s);
      if (errs.length) throw new Error(errs[0].message);
      setSpecRaw(s);
      setLocks(j.choice ? { core: j.choice.core, set: j.choice.set, material: j.choice.material, layers: j.choice.layers, oz: j.choice.oz, ns: j.choice.ns, np: j.choice.np, pattern: j.choice.pattern } : j.locks ?? {});
      say(`Opened ${f.name}`);
    } catch (e) {
      setLoadError(`Could not open ${f.name}: ${e instanceof Error ? e.message : String(e)}. The current design is unchanged.`);
    }
  };

  /* ------------------------------------------------ keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      const views = C.ui.views as View[];
      if (/^[1-6]$/.test(e.key)) setView(views[Number(e.key) - 1]);
      else if (e.key === "f" || e.key === "F") setFitTick((n) => n + 1);
      else if (e.key === "e" || e.key === "E") setVs((v) => ({ ...v, explode: !v.explode }));
      else if (e.key === "x" || e.key === "X") setVs((v) => ({ ...v, cut: !v.cut }));
      else if (e.key === "c" || e.key === "C") setVs((v) => ({ ...v, showCore: !v.showCore }));
      else if (e.key === "Escape") { setMenu(false); setPicked(null); setLoadError(null); }
      else if (e.key === "ArrowDown" && run.candidates.length) { e.preventDefault(); setSelected((i) => Math.min(run.candidates.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run.candidates.length]);

  const s = spec;
  const busy = run.status === "running";
  const noneFeasible = run.status === "done" && run.feasibleCount === 0;
  const tallyTop = Object.entries(run.tally).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const pinnedAll = Boolean(design && locks.core === design.choice.core && locks.layers === design.choice.layers && locks.ns === design.choice.ns && locks.np === design.choice.np);

  const cam = (c: Cam, label: string, key: string) => (
    <button className={vs.cam === c ? "active" : ""} onClick={() => setVs((v) => ({ ...v, cam: c }))} aria-pressed={vs.cam === c} data-test={`cam-${c}`} title={key}>{label}</button>
  );

  return (
    <div className={`app ${busy ? "busy" : ""}`}>
      <header className="app-header">
        <div className="mark" aria-hidden><img src="/favicon.svg" alt="" width={26} height={26} /></div>
        <div className="title-block">
          <div className="app-name">{C.app.name}</div>
          <div className="doc-line" data-test="doc-line">
            {s.topology.toUpperCase()} · {fmt(s.vinMin)}–{fmt(s.vinMax)} V → {fmt(s.vout)} V × {fmt(s.iout)} A · {si(s.fsw, "Hz")}
            {design && <> · <strong>{design.mag.core.id} {design.choice.set}</strong> · {design.mag.np}:{design.mag.ns} · {design.layers.length}L {design.choice.oz} oz</>}
          </div>
        </div>
        <div className="header-spacer" />
        <button className="ghost-btn" onClick={() => fileInput.current?.click()} data-test="open">Open</button>
        <input ref={fileInput} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void openDesign(f); e.target.value = ""; }} />
        <button className="ghost-btn" onClick={saveDesign} data-test="save">Save</button>
        <button className="ghost-btn" onClick={() => setTheme(theme === C.ui.default_theme_dark ? C.ui.default_theme_light : C.ui.default_theme_dark)} data-test="theme" title="Switch theme">
          {theme === C.ui.default_theme_dark ? "Light" : "Dark"}
        </button>
        <div className="menu-wrap">
          <button className="primary-btn" onClick={() => setMenu((m) => !m)} disabled={!design} aria-expanded={menu} data-test="export">Export ▾</button>
          {menu && design && (
            <div className="menu" role="menu">
              {EXPORTERS.map((e) => (
                <button key={e.id} role="menuitem" onClick={() => doExport(e.id)} data-test={`export-${e.id}`}>
                  <strong>{e.label}</strong><span>{e.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <Rail spec={spec} setSpec={setSpec} locks={locks} setLocks={setLocks} errors={errors} onTopology={onTopology} onPinAll={pinAll} pinnedAll={pinnedAll} />

      <main className={`workspace ${run.candidates.length ? "" : "no-results"}`}>
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Views">
            {(C.ui.views as View[]).map((v, i) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)} data-test={`view-${v}`} title={`${i + 1}`}>
                {C.ui.view_labels[v]}
              </button>
            ))}
          </div>
          <div className="header-spacer" />
          {busy && <div className="progress" aria-label="Search progress"><div style={{ width: `${Math.round(run.progress * 100)}%` }} /></div>}
        </div>

        <div className="viewport">
          {design && geom && view === "3d" && (
            <>
              <Viewport3D d={design} g={geom} theme={theme} vs={vs} picked={picked} onPick={setPicked} fitTick={fitTick} />
              <div className="view-tools" data-test="view-tools">
                <div className="segmented small">{cam("3d", "Orbit", "")}{cam("top", "Top", "")}{cam("front", "Front", "")}</div>
                <button className={`toggle ${vs.explode ? "on" : ""}`} aria-pressed={vs.explode} onClick={() => setVs((v) => ({ ...v, explode: !v.explode }))} data-test="explode">Explode <kbd>E</kbd></button>
                <button className={`toggle ${vs.cut ? "on" : ""}`} aria-pressed={vs.cut} onClick={() => setVs((v) => ({ ...v, cut: !v.cut }))} data-test="cut">Section <kbd>X</kbd></button>
                <button className={`toggle ${vs.showCore ? "on" : ""}`} aria-pressed={vs.showCore} onClick={() => setVs((v) => ({ ...v, showCore: !v.showCore }))} data-test="core">Core <kbd>C</kbd></button>
                <button className="toggle" onClick={() => setFitTick((n) => n + 1)} data-test="fit">Fit <kbd>F</kbd></button>
              </div>
              <div className="viewport-caption"><span className="live-dot" />{design.mag.core.name} · {design.choice.set} · {design.layers.length} layers · {design.mag.mat.id}</div>
              <div className="layer-chips" role="group" aria-label="Layer visibility">
                {design.layers.map((l, i) => (
                  <button key={i} className={`lchip ${vs.visible[i] !== false ? "on" : ""} ${picked === i ? "picked" : ""}`} aria-pressed={vs.visible[i] !== false}
                    onClick={() => setVs((v) => ({ ...v, visible: v.visible.map((x, j) => (j === i ? !x : x)) }))}
                    onDoubleClick={() => setVs((v) => ({ ...v, visible: v.visible.map((_, j) => j === i) }))}
                    title="Click to hide, double-click to show only this layer" data-test={`lchip-${i + 1}`}>
                    <i className="qdot" style={{ background: l.winding === "P" ? "var(--q-pri)" : l.winding === "S2" ? "var(--q-sec2)" : "var(--q-sec)" }} />L{i + 1}
                  </button>
                ))}
                <button className="lchip" onClick={() => setVs((v) => ({ ...v, visible: v.visible.map(() => true) }))}>all</button>
              </div>
              <div className="viewport-hints">drag to orbit · right-drag to pan · wheel to zoom · click a layer to inspect it</div>
            </>
          )}
          {design && geom && view === "layers" && <LayersView d={design} g={geom} layer={layerView} setLayer={setLayerView} />}
          {design && view === "section" && <SectionView d={design} picked={picked} onPick={setPicked} />}
          {design && view === "waveforms" && <WaveformsView d={design} />}
          {design && view === "tradeoffs" && run.tradeoffs && <TradeoffsView d={design} t={run.tradeoffs} />}
          {design && view === "steps" && <StepsView d={design} />}

          {!design && run.status !== "error" && !errors.length && !noneFeasible && (
            <div className="empty-state"><img src="/favicon.svg" alt="" width={44} height={44} /><div>Searching cores, turns and stack-ups…</div></div>
          )}
          {errors.length > 0 && (
            <div className="empty-state" data-test="input-errors"><strong>Fix the inputs to design</strong>
              <ul>{errors.map((e) => <li key={e.field}>{e.message}</li>)}</ul>
              <span>The last valid design stays below.</span></div>
          )}
          {noneFeasible && !errors.length && (
            <div className={`notice ${design ? "floating" : ""}`} data-test="none-feasible">
              <strong>No design passes every check.</strong> Closest candidates are listed below with what they fail.
              {tallyTop.length > 0 && <> Most common reasons: {tallyTop.map(([k, n]) => `${k} (${n})`).join(", ")}.</>}
              {" "}Try more layers, heavier copper, a larger loss budget or a higher allowed rise.
            </div>
          )}
          {run.status === "error" && <div className="empty-state"><strong>The search failed</strong><span>{run.error}</span></div>}
        </div>

        {run.candidates.length > 0 && <Candidates list={run.candidates} selected={selected} onSelect={(i) => { setSelected(i); setPicked(null); }} />}
      </main>

      <Inspector d={design} picked={picked} clearPick={() => setPicked(null)} />

      <footer className="status-bar">
        <span data-test="status">
          {busy ? `Searching… ${Math.round(run.progress * 100)} %` : run.status === "done"
            ? `${run.feasibleCount.toLocaleString()} feasible of ${run.evaluated.toLocaleString()} stack-ups evaluated (${run.pruned.toLocaleString()} pruned) in ${run.ms} ms`
            : run.status === "error" ? "Search failed" : "Ready"}
        </span>
        <span className="keys"><span className="status-key">1–6</span> views <span className="status-key">E</span> explode <span className="status-key">X</span> section <span className="status-key">F</span> fit <span className="status-key">↑↓</span> candidates <span className="status-key">Esc</span> close</span>
        <span>{C.app.name} {C.app.version}</span>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
      {loadError && (
        <div className="inline-error" role="alert"><span>{loadError}</span><button className="ghost-btn" onClick={() => setLoadError(null)}>Dismiss</button></div>
      )}
    </div>
  );
}
