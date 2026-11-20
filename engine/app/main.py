from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.engines import EngineError, run_spec
from app.spec import ScenarioSpec

app = FastAPI(title="What If Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/simulate")
def simulate(spec: ScenarioSpec) -> dict:
    # a plain def runs in FastAPI's thread pool, so a long simulation never blocks the server
    try:
        return run_spec(spec)
    except EngineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
