export type Vec3 = [number, number, number];
export type Tier = "exact" | "theory" | "unknown";
export type Num = number | null;

export interface Theory {
  name: string;
  proponents: string;
  support: "consensus" | "mainstream-candidate" | "significant-minority" | "minority" | "fringe";
  summary: string;
  simulated: boolean;
}

export interface ScenarioSpec {
  tier: Tier;
  title: string;
  question: string;
  params: { engine: string } & Record<string, unknown>;
  cards?: string[];
  assumptions?: string[];
  theories?: Theory[];
}

export interface BodyInfo {
  id: number;
  name: string;
  mass_msun: number;
  radius_au: number;
  color: string;
}

export interface GravityDiagnostics {
  integrator: string;
  physics: string[];
  conservative: boolean;
  energy_error_rel: number;
  angular_momentum_error_rel: number;
  prediction_horizon_yr: number | null;
  horizon_checked: boolean;
  horizon_definition?: string;
  truncated: boolean;
  frames: number;
  wall_time_s: number;
}

export interface MergeEvent {
  t_yr: number;
  type: "merge";
  body: string;
  into: string | null;
}

export interface GravityResult {
  engine: "gravity";
  units: { length: string; time: string; mass: string };
  bodies: BodyInfo[];
  times: number[];
  positions: (Vec3 | null)[][];
  events: MergeEvent[];
  diagnostics: GravityDiagnostics;
}

export interface NoSimResult {
  engine: "none";
  reason: string;
}

export type BodyKind = "star" | "planet" | "earth" | "moon" | "rock" | "blackhole" | "ship" | "particle" | "light" | "generic";

export interface SceneBody {
  name: string;
  kind: BodyKind;
  color: string | null;
  spin: number;
  positions: Num[][];
  radius: Num[];
  temperature?: Num[];
  scale?: Num[][];
}

export interface SceneCurve {
  name: string;
  color: string | null;
  width: number;
  static: boolean;
  points: Num[][] | Num[][][];
}

export interface SceneCloud {
  name: string;
  color: string | null;
  size: number;
  points: Num[][][];
  temperature?: Num[];
}

export interface SceneCheck {
  name: string;
  value: number;
  expected: number;
  rtol: number;
  atol: number;
  passed: boolean;
}

export interface SceneResult {
  engine: "scene";
  time_unit: string;
  length_unit: string;
  times: number[];
  bodies: SceneBody[];
  curves: SceneCurve[];
  clouds: SceneCloud[];
  captions: { t: number; text: string }[];
  series: { name: string; unit: string; values: Num[] }[];
  numbers: { name: string; value: number; unit: string; note: string }[];
  camera: { focus: string | null; view: "free" | "top" | "side" };
  diagnostics: { runtime_s: number; checks: SceneCheck[]; log: string };
}

export type EngineResult = GravityResult | NoSimResult | SceneResult;

export interface AskMeta {
  model: string;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  route?: string | null;
}

export interface SimResponse {
  spec: ScenarioSpec;
  result: EngineResult;
  meta?: AskMeta;
}
