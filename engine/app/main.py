import logging
import os
import threading
import time
import uuid
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


_jobs: dict[str, dict] = {}
JOB_TTL_S = 900


def _prune_jobs() -> None:
    now = time.time()
    for jid in [j for j, job in _jobs.items() if now - job["t0"] > JOB_TTL_S]:
        _jobs.pop(jid, None)


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


@app.post("/ask/start")
def ask_start(body: AskRequest, request: Request, fresh: bool = False):
    """Starts a question as a background job; poll /ask/status/{job}. Short polls survive proxy timeouts."""
    q = body.question.strip()
    if not fresh:
        hit = cache.get(q)
        if hit:
            hit.setdefault("meta", {})["cached"] = True
            return {"job": None, "done": True, "result": hit}
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")
    if not _allow(ip):
        raise HTTPException(status_code=429, detail="Too many questions this hour. Try again a bit later.")
    _prune_jobs()
    jid = uuid.uuid4().hex
    job = {"t0": time.time(), "stage": "queued", "detail": "Starting", "steps": [], "done": False, "result": None, "error": None}
    _jobs[jid] = job

    def progress(stage: str, detail: str) -> None:
        job["stage"], job["detail"] = stage, detail
        job["steps"].append({"stage": stage, "detail": detail, "t": round(time.time() - job["t0"], 1)})

    def work() -> None:
        try:
            from app.ai import bank
            out, tri = bank.answer_from_bank(q, progress)  # a verified banked answer if one matches, in seconds
            if out is None:
                out = ask(q, progress, hint=tri)
            out.setdefault("meta", {})["pipeline"] = job["steps"]
            cache.put(q, out)
            job["result"] = out
        except ComposeError as e:
            job["error"] = str(e)
        except Exception:
            logging.getLogger("jobs").exception("job failed")
            job["error"] = "Something went wrong on the server. Please try again."
        finally:
            job["done"] = True

    threading.Thread(target=work, daemon=True).start()
    return {"job": jid, "done": False}


@app.get("/ask/status/{jid}")
def ask_status(jid: str):
    job = _jobs.get(jid)
    if job is None:
        raise HTTPException(status_code=404, detail="That question expired. Please ask again.")
    out = {k: job[k] for k in ("stage", "detail", "steps", "done", "error")}
    if job["done"] and job["result"] is not None:
        out["result"] = job["result"]
    return out
