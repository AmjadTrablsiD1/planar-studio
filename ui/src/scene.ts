/* The 3D transformer: ferrite halves, the PCB stack with every copper layer
 * extruded from the same outlines the Gerber and KiCad exports use, junction
 * vias and terminals. React owns the state; this owns the scene and is driven
 * through the returned setters. Rebuilt only when the design or palette changes.
 *
 * Scene units are mm. Board (x, y) → scene (x, −z); stack height → scene y,
 * with the bottom of the core window at y = 0.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Design } from "../../core/design.ts";
import { outline, type Geometry, type Pt } from "../../core/geometry.ts";

export type ScenePalette = { ferrite: string; pri: string; sec: string; sec2: string; fr4: string; via: string; iso: string };

export type SceneApi = {
  view: (v: "3d" | "top" | "front") => void;
  explode: (on: boolean) => void;
  cut: (on: boolean) => void;
  layers: (visible: boolean[]) => void;
  highlight: (layer: number | null) => void;
  core: (visible: boolean) => void;
  fit: () => void;
  dispose: () => void;
};

export function createScene(
  host: HTMLDivElement, d: Design, g: Geometry, pal: ScenePalette, explodeGap: number, onPick: (layer: number | null) => void,
): SceneApi {
  const core = d.mag.core;
  const extent = Math.max(g.half[0], g.half[1]) * 2;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.025);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xc9e9ff, 0x152e25, 0.6));
  const key = new THREE.DirectionalLight(0xffedcc, 2.0);
  key.position.set(-extent, extent * 2, extent);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.1, far: extent * 6 });
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.03;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8dc5ff, 0.7);
  fill.position.set(extent, extent, -extent);
  scene.add(fill);

  /* --------------------------------------------------- bookkeeping */
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const geo = <T extends THREE.BufferGeometry>(x: T) => { geometries.add(x); return x; };
  const mat = <T extends THREE.Material>(x: T) => { materials.add(x); return x; };
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

  const ferrite = mat(new THREE.MeshStandardMaterial({ color: pal.ferrite, roughness: 0.62, metalness: 0.15, side: THREE.DoubleSide }));
  const copper = (c: string) => mat(new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide }));
  const cu: Record<string, THREE.MeshStandardMaterial> = { P: copper(pal.pri), S: copper(pal.sec), S2: copper(pal.sec2) };
  const cuHot = mat(new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: pal.pri, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.7, side: THREE.DoubleSide }));
  const fr4 = mat(new THREE.MeshStandardMaterial({ color: pal.fr4, roughness: 0.8, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
  const iso = mat(new THREE.MeshStandardMaterial({ color: pal.iso, roughness: 0.8, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
  const viaMat = mat(new THREE.MeshStandardMaterial({ color: pal.via, roughness: 0.25, metalness: 0.9 }));

  const root = new THREE.Group();
  scene.add(root);
  const meshes: THREE.Mesh[] = [];
  const add = (parent: THREE.Object3D, m: THREE.Mesh) => { m.castShadow = true; m.receiveShadow = true; parent.add(m); meshes.push(m); return m; };

  /** A flat 2-D shape in board coordinates, extruded upward by h from y0. */
  function slab(shape: THREE.Shape, y0: number, h: number, m: THREE.Material): THREE.Mesh {
    const eg = geo(new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 24 }));
    eg.rotateX(-Math.PI / 2);
    eg.translate(0, y0, 0);
    return new THREE.Mesh(eg, m);
  }
  const shapeOf = (pts: Pt[]) => new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  const box = (x: number, y: number, z: number, w: number, h: number, dz: number, m: THREE.Material) => {
    const b = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, dz)), m);
    b.position.set(x, y + h / 2, z);
    return b;
  };

  /* --------------------------------------------------------- core */
  const hw = core.hw, yoke = core.B - core.E, gap = d.mag.gapMm ?? 0;
  const coreBottom = new THREE.Group(), coreTop = new THREE.Group();
  root.add(coreBottom, coreTop);
  const legs = (group: THREE.Group, y0: number, h: number, centreH: number, centreY0: number) => {
    if (core.family === "ER") {
      const c = new THREE.Mesh(geo(new THREE.CylinderGeometry(core.F / 2, core.F / 2, centreH, 64)), ferrite);
      c.position.set(0, centreY0 + centreH / 2, 0);
      add(group, c);
      const R = core.D / 2, yC = core.Cd / 2, th = Math.asin(Math.min(1, yC / R));
      for (const sgn of [1, -1]) {
        const pts: Pt[] = [];
        for (let k = 0; k <= 32; k++) { const a = -th + (2 * th * k) / 32; pts.push([sgn * R * Math.cos(a), R * Math.sin(a)]); }
        pts.push([sgn * core.A / 2, yC], [sgn * core.A / 2, -yC]);
        add(group, slab(shapeOf(pts), y0, h, ferrite));
      }
    } else {
      add(group, box(0, centreY0, 0, core.F, centreH, core.Cd, ferrite));
      const ow = (core.A - core.D) / 2;
      for (const sgn of [1, -1]) add(group, box(sgn * (core.D / 2 + ow / 2), y0, 0, ow, h, core.Cd, ferrite));
    }
  };
  add(coreBottom, box(0, -yoke, 0, core.A, yoke, core.Cd, ferrite));
  if (d.choice.set === "E+PLT") {
    legs(coreBottom, 0, hw, hw - gap, 0);
    add(coreTop, box(0, hw, 0, core.A, core.tp, core.Cd, ferrite));
  } else {
    legs(coreBottom, 0, hw / 2, hw / 2 - gap / 2, 0);
    legs(coreTop, hw / 2, hw / 2, hw / 2 - gap / 2, hw / 2 + gap / 2);
    add(coreTop, box(0, hw, 0, core.A, yoke, core.Cd, ferrite));
  }

  /* -------------------------------------------------------- board */
  const L = d.layers.length;
  const t = d.boardMm;
  const mask = (t - d.layers.reduce((a, l) => a + l.hMm, 0) - d.diel.reduce((a, x) => a + x, 0)) / 2;
  let y = (hw - t) / 2 + t - mask;
  const layerY: number[] = [];
  const layerGroups: THREE.Group[] = [];
  const dielGroups: THREE.Group[] = [];
  const board = shapeOf(g.board);
  for (const c of g.cutouts) board.holes.push(new THREE.Path(c.map((p) => new THREE.Vector2(p[0], p[1]))));
  for (let i = 0; i < L; i++) {
    const l = d.layers[i];
    y -= l.hMm;
    layerY.push(y);
    const grp = new THREE.Group();
    grp.userData = { baseY: 0, index: i };
    for (const tr of g.traces.filter((x) => x.layer === i)) {
      const m = add(grp, slab(shapeOf(outline(tr.prims, tr.width, 0.15)), y, l.hMm, cu[tr.winding] ?? cu.S));
      m.userData = { layer: i, winding: tr.winding };
    }
    root.add(grp);
    layerGroups.push(grp);
    if (i < L - 1) {
      y -= d.diel[i];
      const dg = new THREE.Group();
      const cross = l.side !== d.layers[i + 1].side;
      const m = slab(board, y, d.diel[i], cross ? iso : fr4);
      m.renderOrder = 2;
      dg.add(m);
      root.add(dg);
      dielGroups.push(dg);
    }
  }
  // Vias and terminal pins join the layer groups they span, so explode keeps them honest.
  const viaGroup = new THREE.Group();
  root.add(viaGroup);
  for (const v of g.vias) {
    const top = layerY[v.from] + d.layers[v.from].hMm, bot = layerY[v.to];
    const c = new THREE.Mesh(geo(new THREE.CylinderGeometry(v.pad / 2, v.pad / 2, top - bot, 20)), viaMat);
    c.position.set(v.at[0], (top + bot) / 2, -v.at[1]);
    c.userData = { from: v.from, to: v.to };
    add(viaGroup, c);
  }
  for (const tm of g.terminals) {
    const top = layerY[0] + d.layers[0].hMm + 1.2, bot = layerY[L - 1] - 1.2;
    const c = new THREE.Mesh(geo(new THREE.CylinderGeometry(tm.drill / 2, tm.drill / 2, top - bot, 20)), viaMat);
    c.position.set(tm.at[0], (top + bot) / 2, -tm.at[1]);
    c.userData = { terminal: true };
    add(viaGroup, c);
  }

  /* ------------------------------------------------------- cameras */
  const near = Math.max(0.05, extent * 0.002);
  const perspective = new THREE.PerspectiveCamera(35, 1, near, extent * 20);
  const ortho = new THREE.OrthographicCamera(-extent, extent, extent, -extent, near, extent * 20);
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspective;
  let controls: OrbitControls;
  let mode: "3d" | "top" | "front" = "3d";
  const centre = new THREE.Vector3(0, hw / 2, 0);
  function bindControls() {
    controls?.dispose();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = extent * 0.08;
    controls.maxDistance = extent * 8;
    controls.minZoom = 0.2;
    controls.maxZoom = 60;
    controls.enableRotate = camera === perspective;
    controls.mouseButtons.LEFT = camera === perspective ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.target.copy(centre);
  }
  bindControls();

  function fit() {
    controls.target.copy(centre);
    const [bx, by] = g.half;
    if (camera === perspective) {
      const dir = new THREE.Vector3(0.55, 0.62, 0.78).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
      const up = new THREE.Vector3().crossVectors(dir, right).normalize();
      const tan = Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
      let dist = extent * 0.4;
      const hTop = hw + Math.max(core.tp, yoke) + (exploded ? L * explodeGap : 0);
      for (const x of [-bx, bx]) for (const z of [-by, by]) for (const yy of [-yoke - (exploded ? L * explodeGap : 0), hTop]) {
        const p = new THREE.Vector3(x, yy, z).sub(centre);
        dist = Math.max(dist, p.dot(dir) + Math.abs(p.dot(up)) / tan, p.dot(dir) + Math.abs(p.dot(right)) / (tan * perspective.aspect));
      }
      camera.position.copy(centre).addScaledVector(dir, dist * 1.05);
    } else {
      if (mode === "top") camera.position.set(0, extent * 4, 0.0001);
      else camera.position.set(0, hw / 2, extent * 4);
      const w = mode === "top" ? 2 * bx : core.A * 1.2, h = mode === "top" ? 2 * by : (hw + 2 * yoke) * 2.2;
      camera.zoom = Math.min((ortho.right - ortho.left) / w, (ortho.top - ortho.bottom) / h) * 0.86;
      camera.updateProjectionMatrix();
    }
    controls.update();
  }

  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    perspective.aspect = width / height;
    perspective.updateProjectionMatrix();
    ortho.left = -extent * (width / height) * 0.6;
    ortho.right = -ortho.left;
    ortho.top = extent * 0.6;
    ortho.bottom = -ortho.top;
    ortho.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  /* ---------------------------------------------------------- loop */
  let disposed = false, frame = 0, exploded = false;
  let visible = d.layers.map(() => true);
  resize();
  fit();
  const offsets = () => {
    // Exploded: layers fan out downward from the top layer, the core halves move clear.
    const lay = layerGroups.map((_, i) => (exploded ? -i * explodeGap + ((L - 1) * explodeGap) / 2 : 0));
    const die = dielGroups.map((_, i) => (lay[i] + lay[i + 1]) / 2);
    return { lay, die, top: exploded ? ((L - 1) * explodeGap) / 2 + explodeGap * 2 : 0, bottom: exploded ? -((L - 1) * explodeGap) / 2 - explodeGap * 2 : 0 };
  };
  const animate = () => {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const o = offsets();
    const k = 0.14;
    layerGroups.forEach((grp, i) => { grp.position.y = THREE.MathUtils.lerp(grp.position.y, o.lay[i], k); grp.visible = visible[i]; });
    dielGroups.forEach((grp, i) => { grp.position.y = THREE.MathUtils.lerp(grp.position.y, o.die[i], k); grp.visible = visible[i] || visible[i + 1]; });
    coreTop.position.y = THREE.MathUtils.lerp(coreTop.position.y, o.top, k);
    coreBottom.position.y = THREE.MathUtils.lerp(coreBottom.position.y, o.bottom, k);
    // A via follows the midpoint of the layers it joins.
    viaGroup.children.forEach((m) => {
      const u = m.userData as { from?: number; to?: number };
      if (u.from === undefined) { m.visible = !exploded; return; }
      m.position.y = THREE.MathUtils.lerp(m.position.y, (layerY[u.from] + layerY[u.to!]) / 2 + d.layers[u.from].hMm / 2 + (layerGroups[u.from].position.y + layerGroups[u.to!].position.y) / 2, k);
      m.scale.y = exploded ? 1 + ((u.to! - u.from) * explodeGap) / Math.max(1e-3, layerY[u.from] - layerY[u.to!] + d.layers[u.from].hMm) : 1;
      m.visible = visible.slice(u.from, u.to! + 1).some(Boolean);
    });
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  /* ------------------------------------------------------- picking */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down: [number, number] = [0, 0];
  const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
  const onUp = (e: PointerEvent) => {
    if (e.button !== 0 || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const rect = host.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(layerGroups.filter((x) => x.visible), true);
    const hit = hits.find((h) => !cutOn || h.point.z <= 0);
    onPick(hit ? (hit.object.userData.layer as number) : null);
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);

  let cutOn = false;
  let hot: number | null = null;
  const paint = () => {
    for (const grp of layerGroups) for (const m of grp.children as THREE.Mesh[]) {
      m.material = hot === m.userData.layer ? cuHot : cu[m.userData.winding as string] ?? cu.S;
    }
    for (const m of materials) m.clippingPlanes = cutOn ? [clip] : [];
  };

  return {
    view(v) {
      mode = v;
      camera = v === "3d" ? perspective : ortho;
      camera.up.set(0, v === "top" ? 0 : 1, v === "top" ? -1 : 0);
      bindControls();
      resize();
      fit();
    },
    explode(on) { exploded = on; },
    cut(on) { cutOn = on; paint(); },
    layers(v) { visible = v; },
    highlight(layer) { hot = layer; paint(); },
    core(show) { coreTop.visible = show; coreBottom.visible = show; },
    fit,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      geometries.forEach((x) => x.dispose());
      materials.forEach((x) => x.dispose());
      environment.dispose();
      pmrem.dispose();
      room.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
