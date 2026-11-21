"""The answer bank: verified physics models for questions people are likely to ask.

Each entry stores the verified model (its code, or its orbit setup), its answer and its review, not the heavy
result, so the bank fits in the repo and survives deploys. A matched entry is re-run, so the visitor still gets a
real simulation, in seconds and with no API cost. Only answers that passed every check and the review get in.
"""
import json
import logging
import os
import re
import threading
from pathlib import Path

log = logging.getLogger("bank")
BANK_FILE = Path(__file__).resolve().parents[2] / "bank" / "entries.jsonl"
TRIAGE_MODEL = os.getenv("TRIAGE_MODEL", "claude-haiku-5-5")
_lock = threading.Lock()
_entries: list[dict] | None = None
_bm25 = None
_mtime = 0.0


def norm(q: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9.%]+", " ", q.lower().replace(",", "")).split())


def _tokens(q: str) -> list[str]:
    return norm(q).split()


def load(force: bool = False) -> list[dict]:
    global _entries, _bm25, _mtime
    with _lock:
        m = BANK_FILE.stat().st_mtime if BANK_FILE.exists() else 0.0
        if _entries is None or force or m != _mtime:  # picks up entries the builder adds while the server runs
            _mtime = m
            _entries = []
            if BANK_FILE.exists():
                for line in BANK_FILE.read_text().splitlines():
                    if line.strip():
                        try:
                            _entries.append(json.loads(line))
                        except json.JSONDecodeError:
                            log.warning("skipped a bad bank line")
            if _entries:
                from rank_bm25 import BM25Okapi
                _bm25 = BM25Okapi([_tokens(e["question"]) for e in _entries])
            else:
                _bm25 = None
        return _entries


def add(entry: dict) -> None:
    with _lock:
        BANK_FILE.parent.mkdir(parents=True, exist_ok=True)
        with BANK_FILE.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    load(force=True)


def has(question: str) -> bool:
    n = norm(question)
    return any(norm(e["question"]) == n for e in load())


def entry_from(question: str, out: dict) -> dict | None:
    """A bank entry for a finished answer, or None unless it passed every check and the review."""
    spec, res, meta = out.get("spec", {}), out.get("result", {}), out.get("meta", {})
    eng = res.get("engine")
    if eng == "none":
        return {"question": question, "engine": "none", "spec": spec, "reason": res.get("reason", ""), "triage": meta.get("triage")}
    rv = meta.get("review") or {}
    checks = (res.get("diagnostics") or {}).get("checks", [])
    if eng not in ("scene", "gravity") or not checks or not all(c.get("passed") for c in checks) or rv.get("status") != "pass":
        return None
    e = {
        "question": question,
        "engine": eng,
        "spec": spec,
        "review": {k: rv.get(k) for k in ("status", "problems", "matched", "mismatches")},
        "review_check": next((c for c in checks if c.get("source") == "review"), None),
        "triage": meta.get("triage"),
    }
    if eng == "gravity":
        e["answer"] = res.get("answer", "")
    return e


def candidates(question: str, k: int = 5) -> list[tuple[dict, float]]:
    es = load()
    if not es or _bm25 is None:
        return []
    scores = _bm25.get_scores(_tokens(question))
    order = sorted(range(len(es)), key=lambda i: -scores[i])[:k]
    return [(es[i], float(scores[i])) for i in order if scores[i] > 0]


TRIAGE_TOOL = {
    "name": "triage",
    "description": "Classify the question and pick a banked question that asks exactly the same thing.",
    "input_schema": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["exact", "thought", "theory", "outside"]},
            "match": {"type": "integer", "description": "Number of the banked question asking about exactly the same scenario, or 0 if none does."},
        },
        "required": ["kind", "match"],
    },
}
TRIAGE_SYSTEM = """You sort what if questions for a physics simulator.
kind: exact = real objects and established physics; thought = real physics applied to an impossible premise (a Sun made of ice cream, an Earth shaped like a donut); theory = scientists genuinely disagree (black hole interiors, the end of the universe, before the Big Bang); outside = not physics (emotions, magic, biology, history).
match: a banked question counts only if it asks about exactly the same scenario: the same objects, the same change and the same numbers. "Twice as close" and "twice as far" are different. "3,000 times faster" and "3 times faster" are different. When unsure, answer 0.
Call the triage tool."""


def triage(client, question: str, cands: list[tuple[dict, float]]) -> dict:
    """Fast Haiku call: what kind of question this is, and which banked question (if any) is the same one."""
    listing = "\n".join(f"{i + 1}. {e['question']}" for i, (e, _) in enumerate(cands)) or "(none)"
    try:
        resp = client.messages.create(
            model=TRIAGE_MODEL, max_tokens=400, system=TRIAGE_SYSTEM, tools=[TRIAGE_TOOL], tool_choice={"type": "auto"},
            messages=[{"role": "user", "content": f"Question: {question}\n\nBanked questions:\n{listing}"}],
        )
        block = next((b for b in resp.content if getattr(b, "type", "") == "tool_use"), None)
        if block is None:
            return {"kind": None, "match": 0}
        m = int(block.input.get("match") or 0)
        kind = block.input.get("kind")
        return {"kind": kind if kind in ("exact", "thought", "theory", "outside") else None, "match": m if 0 <= m <= len(cands) else 0}
    except Exception:
        log.exception("triage unavailable")
        return {"kind": None, "match": 0}


def replay(entry: dict, asked: str) -> dict:
    """Re-runs a banked model: a real simulation, in seconds, with no API cost."""
    spec = dict(entry["spec"])
    eng = entry["engine"]
    if eng == "none":
        result = {"engine": "none", "reason": entry.get("reason", "")}
    elif eng == "scene":
        from app.sandbox.runner import run_model
        result = run_model(spec["params"]["code"])
        if entry.get("review_check"):
            result["diagnostics"]["checks"].append(entry["review_check"])
    elif eng == "gravity":
        from app.ai.composer import ScenarioSpec, run_spec
        from app.ai.reviewer import fallback_answer, ground_text, orbit_numbers
        result = run_spec(ScenarioSpec.model_validate(spec))["result"]
        from app.ai.earth import earth_from_orbits
        result["earth"] = earth_from_orbits(result)
        result["numbers"] = orbit_numbers(result)
        result["answer"] = entry.get("answer") or fallback_answer(result["numbers"])
        result.setdefault("diagnostics", {})["grounding"] = ground_text(result["answer"], result["numbers"])
        if entry.get("review_check"):
            result["diagnostics"].setdefault("checks", []).append(entry["review_check"])
    else:
        raise ValueError(f"unknown bank engine {eng!r}")
    return {"spec": spec, "result": result, "meta": {"bank": True, "asked": asked, "triage": entry.get("triage"), "review": entry.get("review")}}


def answer_from_bank(question: str, progress=None) -> tuple[dict | None, dict]:
    """(answer or None, triage). Exact match first, otherwise Haiku decides whether a close banked question is the same one."""
    report = progress or (lambda stage, detail: None)
    es = load()
    n = norm(question)
    exact = next((e for e in es if norm(e["question"]) == n), None)
    cands = candidates(question)
    from app.ai.composer import get_client
    tri = triage(get_client(), question, cands)
    pick = exact or (cands[tri["match"] - 1][0] if tri["match"] else None)
    if pick is None:
        return None, tri
    report("bank", f"Found a verified answer to a matching question: {pick['question']}")
    try:
        return replay(pick, question), tri
    except Exception:
        log.exception("bank replay failed, building live instead")
        return None, tri


def examples_for(question: str, k: int = 2, max_chars: int = 9000) -> str:
    """The closest verified models, as worked examples for a new question (shorter code, fewer repairs)."""
    picks = [(e, s) for e, s in candidates(question, 6) if e["engine"] == "scene" and s >= 3.0][:k]
    if not picks:
        return ""
    parts = ["Verified models written for similar questions. Each passed every check and an independent review. "
             "Adapt their physics where it fits; never copy a number that the new question changes."]
    for e, _ in picks:
        parts.append(f'<example question="{e["question"]}">\n{e["spec"]["params"]["code"][: max_chars // k]}\n</example>')
    return "\n\n".join(parts)
