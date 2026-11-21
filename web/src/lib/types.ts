export type Vec3 = [number, number, number];
export type Tier = "exact" | "theory" | "unknown";
export type Num = number | null;

export interface Theory {
  name: string;
  proponents: string;
  support: "consensus" | "mainstream-candidate" | "significant-minority" | "minority" | "fringe";
  summary: string;
  simulated: boolean;
  card?: string | null;
}

export interface ScenarioSpec {
  tier: Tier;
  title: string;
  question: string;
  params: { engine: string } & Record<string, unknown>;
  cards?: string[];
  assumptions?: string[];
  theories?: Theory[];
  card_refs?: { id: string; title: string; sources: { title: string; authors: string; year: number | null; url: string }[] }[];
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
  checks?: SceneCheck[];
  grounding?: { numbers: number; ungrounded: number[] };
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
  answer?: string;
  explanation?: string;
  earth?: EarthPanel | null;
  change?: { t: number; label: string } | null;
  numbers?: { name: string; value: number; unit: string; note: string }[];
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
  disk?: boolean;
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
  temperature_each?: Num[][];
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
  answer?: string;
  explanation?: string;
  earth?: EarthPanel | null;
  change?: { t: number; label: string } | null;
  diagnostics: { runtime_s: number; checks: SceneCheck[]; log: string; grounding?: { numbers: number; ungrounded: number[] } };
}

export type EngineResult = GravityResult | NoSimResult | SceneResult;

export interface AskMeta {
  model: string;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  route?: string | null;
  triage?: string | null;
  bank?: boolean;
  asked?: string;
}

export interface SimResponse {
  spec: ScenarioSpec;
  result: EngineResult;
  meta?: AskMeta;
}

export interface EarthSeries {
  name: string;
  unit: string;
  values: (number | null)[];
  today?: number | null;
}

export interface EarthPanel {
  series: EarthSeries[];
  events: { t: number; text: string }[];
  note?: string;
}
