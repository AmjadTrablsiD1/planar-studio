import { useEffect, useRef } from "react";
import type { Design } from "../../../core/design.ts";
import type { Geometry } from "../../../core/geometry.ts";
import { createScene, type SceneApi } from "../scene";
import { C } from "../constants";
import { themeColour } from "../theme";

export type Cam = "3d" | "top" | "front";
export type ViewState = { cam: Cam; explode: boolean; cut: boolean; showCore: boolean; visible: boolean[] };

export function Viewport3D({ d, g, theme, vs, picked, onPick, fitTick }: {
  d: Design; g: Geometry; theme: string; vs: ViewState; picked: number | null; onPick: (l: number | null) => void; fitTick: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<SceneApi | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const state = useRef(vs);
  state.current = vs;

  useEffect(() => {
    if (!host.current) return;
    const tc = (k: string) => themeColour(theme, k);
    api.current = createScene(host.current, d, g, {
      ferrite: tc("scene-ferrite"), pri: tc("scene-pri"), sec: tc("scene-sec"), sec2: tc("scene-sec2"),
      fr4: tc("scene-fr4"), via: tc("scene-via"), iso: tc("scene-iso"),
    }, C.ui.explode_gap_mm, (l) => pick.current(l));
    // A rebuilt scene starts from the current view state, not the defaults.
    const s = state.current;
    api.current.layers(s.visible);
    api.current.explode(s.explode);
    api.current.cut(s.cut);
    api.current.core(s.showCore);
    if (s.cam !== "3d") api.current.view(s.cam);
    return () => { api.current?.dispose(); api.current = null; };
  }, [d, g, theme]);

  useEffect(() => api.current?.view(vs.cam), [vs.cam]);
  useEffect(() => api.current?.explode(vs.explode), [vs.explode]);
  useEffect(() => api.current?.cut(vs.cut), [vs.cut]);
  useEffect(() => api.current?.core(vs.showCore), [vs.showCore]);
  useEffect(() => api.current?.layers(vs.visible), [vs.visible]);
  useEffect(() => api.current?.highlight(picked), [picked]);
  useEffect(() => { if (fitTick) api.current?.fit(); }, [fitTick]);

  return <div className="viewport-host" ref={host} data-test="viewport-3d" />;
}
