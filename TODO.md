# TODO

## Done
- Design core: topology registry (flyback, forward, LLC half-bridge, full bridge), core/ferrite library, iGSE core loss, Dowell/Ferreira per-layer per-harmonic copper loss, gap with fringing, leakage, P–S capacitance, isolation (DTI, creepage via the core), thermal, loss budget.
- Optimiser over core × set × ferrite × turns × layers × copper × series/parallel × interleave pattern, with lower-bound pruning; pins (locks) for any choice; explains an impossible spec.
- Geometry: spiral turns as lines + arcs, smooth cosine transitions, junction vias on free rings, terminal leads that never cross, cut-outs with router-radius corners.
- Exports: KiCad project (zones, blind/buried vias, stack-up, rules), Gerber X2 + Excellon per span, DXF, HTML report (print to PDF), design JSON.
- UI: instrument shell, 3D (explode, section, top/front, pick), layers to scale, section + MMF, waveforms, trade-offs, design steps, inspector with evidence/checks/coverage, both themes.
- Tests: 41 core (independent second routes; KiCad DRC on six boards), 9 Playwright (both themes, axe, fold probe).
- Launchers: .command, .app with drawn icon, App Launcher tile, Windows .bat (untested).

## Doing
- (nothing)

## Next
1. Run `run-planar-studio.bat` on the Windows 11 machine and fix what breaks.
2. Check the core catalogue against the Ferroxcube/TDK datasheets; add exact ER data and the ELP set from TDK.
3. Local via pocket at the front instead of a full inner ring (gives the breadth back).
4. KiCad footprint (`.kicad_mod`) export so the winding drops into an existing board.
5. LTspice model export (Lm, Llk, Rac per winding as a coupled-inductor subcircuit) — the LTspice MCP is already on this Mac.
6. Unequal current sharing between parallel layers (solve the layer impedance matrix).
7. LLC resonant tank: Lr/Cr/Q from the gain curve; off-resonance flux at Vin min.
8. Open the Gerbers in GerbView by hand once and compare with the KiCad board.

## Someday
- 2-D field check of the chosen design (FEMM or openEMS) to calibrate the 1-D model.
- Shield layers between P and S for common-mode noise, with their own loss.
- More than one output (several secondaries with different turns).
- Thermal model through the board copper and the core to a heatsink.
- User-editable core library inside the app.

## Won't do (and why)
- A Python core: his newer apps are all TypeScript; the maths here needs nothing numpy offers.
- Electron: a Node server plus the browser runs the same on macOS and Windows with less to package.
