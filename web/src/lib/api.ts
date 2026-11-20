import type { ScenarioSpec, SimResponse } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function simulate(spec: ScenarioSpec): Promise<SimResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    });
  } catch {
    throw new Error(`Can't reach the engine at ${API_URL}. Is the backend running?`);
  }
  if (!res.ok) {
    let detail = `Engine error ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      /* keep the generic message */
    }
    throw new Error(detail);
  }
  return res.json();
}
