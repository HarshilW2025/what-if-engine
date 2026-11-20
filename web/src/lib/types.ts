export type Vec3 = [number, number, number];
export type Tier = "exact" | "theory" | "unknown";

export interface ScenarioSpec {
  tier: Tier;
  title: string;
  question: string;
  params: { engine: string } & Record<string, unknown>;
  cards?: string[];
  assumptions?: string[];
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

export type EngineResult = GravityResult | NoSimResult;

export interface SimResponse {
  spec: ScenarioSpec;
  result: EngineResult;
}
