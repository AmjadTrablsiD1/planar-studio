// The data that flows between modules. Plain objects only, so a Design can be
// posted from the worker, saved as JSON and loaded back unchanged.

export type TopologyId = "flyback" | "forward" | "llc" | "fullbridge";
export type Insulation = "functional" | "basic" | "reinforced";
export type Rectifier = "fullbridge" | "centertap";
export type CoreSet = "E+PLT" | "E+E";
export type Pattern = "interleaved" | "sandwich" | "split";
export type Objective = "loss" | "size" | "layers";
export type OpPoint = "min" | "nom" | "max";

export type Spec = {
  topology: TopologyId;
  vinMin: number; vinNom: number; vinMax: number;
  vout: number; iout: number; vf: number;
  fsw: number; eta: number;
  dMax: number; ripple: number;
  rectifier: Rectifier;
  tDead: number; coss: number;
  vWork: number; insulation: Insulation;
  tAmb: number; dTMax: number; lossBudget: number;
  maxLayers: number; copper: string[]; dielectric: number;
  family: "all" | "E" | "ER"; material: string; objective: Objective;
  operatingPoint: OpPoint;
};

/** Anything the user pins; the optimiser enumerates the rest. */
export type Locks = Partial<{
  core: string; set: CoreSet; material: string; layers: number; oz: string;
  ns: number; np: number; pattern: Pattern;
}>;

export type WindingPlan = { winding: string; layers: number; series: number; parallel: number };

export type Choice = {
  core: string; set: CoreSet; material: string;
  layers: number; oz: string;
  np: number; ns: number;
  pattern: Pattern;
  plan: WindingPlan[];
};

export type WindingDef = { id: string; label: string; turns: "P" | "S"; side: "pri" | "sec" };

export type Operation = {
  vin: number;
  duty: number;
  mode: string;
  /** Winding currents in the magnetising sense: Σ N_w·i_w(t) is the core MMF. */
  currents: Record<string, Float64Array>;
  /** Primary winding voltage. */
  vPri: Float64Array;
  notes: string[];
};

export type Direction = "in" | "out" | "single";

export type Layer = {
  index: number;
  winding: string;
  side: "pri" | "sec";
  series: number;
  copy: number;
  parallel: number;
  turns: number;
  dir: Direction;
  oz: string;           // copper weight
  hMm: number;          // copper thickness
  pullMm: number;       // copper keep-back at the inner edge (centre-leg side)
  pullOutMm: number;    // copper keep-back at the outer edge (outer-leg side)
  widthMm: number;      // trace width of every turn on this layer
  spaceMm: number;      // turn-to-turn gap
  jogMm: number;        // length of the transition zone where each turn steps to the next
  offsetsMm: number[];  // centre-line offset of each turn from the centre-leg face, inner first
  mltMm: number;        // mean turn length
  porosity: number;     // copper fraction of the window breadth
};

export type Check = {
  id: string;
  label: string;
  ok: boolean;
  severity: "fail" | "warn" | "info";
  value: number;
  limit: number;
  unit: string;
  detail: string;
};

export type LayerResult = {
  index: number;
  winding: string;
  rdc: number;          // Ω, this layer alone
  irms: number;         // A per turn
  loss: number;         // W
  lossDc: number;       // W at DC resistance
  fr: number;           // loss / lossDc
  mmfTop: number;       // rms MMF at the top face, A·turns (fundamental)
  mmfBottom: number;
  jRms: number;         // A/mm²
};
