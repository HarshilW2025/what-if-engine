import os
import time
from collections import defaultdict, deque
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from app.ai import cache  # noqa: E402
from app.ai.composer import ComposeError, ask  # noqa: E402
from app.engines import run_spec  # noqa: E402
from app.engines.errors import EngineError  # noqa: E402
from app.spec import ScenarioSpec  # noqa: E402

app = FastAPI(title="What If Engine")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

PER_VISITOR_PER_HOUR = int(os.getenv("ASK_LIMIT_PER_HOUR", "30"))
GLOBAL_PER_HOUR = int(os.getenv("ASK_GLOBAL_PER_HOUR", "300"))
_hits: dict[str, deque] = defaultdict(deque)
_all_hits: deque = deque()


def _allow(ip: str) -> bool:
    now = time.time()
    for q in (_hits[ip], _all_hits):
        while q and now - q[0] > 3600:
            q.popleft()
    if len(_hits[ip]) >= PER_VISITOR_PER_HOUR or len(_all_hits) >= GLOBAL_PER_HOUR:
        return False
    _hits[ip].append(now)
    _all_hits.append(now)
    return True


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/version")
def version():
    return {"cache_version": cache.version()}


@app.post("/simulate")
def simulate(spec: ScenarioSpec):
    try:
        return run_spec(spec)
    except EngineError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/ask")
def ask_endpoint(body: AskRequest, request: Request, fresh: bool = False):
    q = body.question.strip()
    if not fresh:
        hit = cache.get(q)
        if hit:
            hit.setdefault("meta", {})["cached"] = True
            return hit
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")
    if not _allow(ip):
        raise HTTPException(status_code=429, detail="Too many questions this hour. Try again a bit later.")
    try:
        out = ask(q)
    except ComposeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    cache.put(q, out)
    return out
