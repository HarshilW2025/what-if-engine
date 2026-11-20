import type { ScenarioSpec, SimResponse } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Can't reach the engine at ${API_URL}. Is the backend running?`);
  }
  if (!res.ok) {
    let detail = `Engine error ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      /* keep the generic message */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const simulate = (spec: ScenarioSpec) => post<SimResponse>("/simulate", spec);
export const ask = (question: string) => post<SimResponse>("/ask", { question });

export interface ProgressStep {
  stage: string;
  detail: string;
  t: number;
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`);
  } catch {
    throw new Error(`Can't reach the engine at ${API_URL}. Is the backend running?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Engine error ${res.status}`);
  return data as T;
}

/** Starts the question as a job and polls once a second; stages are passed on for debugging. */
export async function askWithProgress(question: string, onSteps?: (steps: ProgressStep[]) => void): Promise<SimResponse> {
  const start = await post<{ job: string | null; done: boolean; result?: SimResponse }>("/ask/start", { question });
  if (start.done && start.result) return start.result;
  const t0 = Date.now();
  while (Date.now() - t0 < 6 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await getJson<{ steps: ProgressStep[]; done: boolean; error: string | null; result?: SimResponse }>(`/ask/status/${start.job}`);
    onSteps?.(st.steps);
    if (st.done) {
      if (st.error) throw new Error(st.error);
      if (st.result) return st.result;
      throw new Error("The engine finished without a result. Please try again.");
    }
  }
  throw new Error("This one is taking too long. Please try a simpler version of the question.");
}
