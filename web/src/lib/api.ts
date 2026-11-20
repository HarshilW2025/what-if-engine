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
