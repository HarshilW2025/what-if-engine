"""Independent physics reviewer. A separate Claude call that never saw the composer's reasoning.
It audits the model and recomputes headline numbers as plain formulas, which we evaluate ourselves."""
import ast
import json

from app.ai.apiopts import api_create
import logging
import math
import operator as op

log = logging.getLogger("reviewer")

RECOMPUTE_RTOL = 0.05

REVIEW_SYSTEM = """You are an independent physics referee. Another model wrote a simulation to answer a what if question. You did not write it. Your job is to catch real physics errors before the public sees them.

Check:
1. The equations are the right physics for this question, in the right regime (Newtonian vs relativistic, classical vs quantum).
2. Units and constants are correct, and initial conditions match the question.
3. The reality baseline check compares against a true measured value (not one derived from the model's own code).
4. The qualitative behaviour (what moves where, what happens first) is what physics predicts.
5. The answer text, the detailed explanation and the On Earth panel claim nothing the model did not compute, and the On Earth values are physically right for people on Earth.
6. What is drawn shows what the answer says happens: a star that swells into a red giant grows and reddens on screen, a body that is destroyed disappears, and light comes only from bodies that exist in the scene. A clear mismatch between the picture and the answer is a failure.

Simplifications are fine when they are stated in the assumptions and do not change the conclusion. Fail only for errors that change a headline number by more than 5% or get the behaviour wrong. Do not fail for style.

Then independently recompute 2 or 3 of the headline numbers by your own route, as plain formulas. Each line except the last may be an assignment like `w = 3000*2*pi/86164.0905`; the last line is the result, in the same unit as that number. Use only arithmetic, pi, sqrt, exp, log, log10, sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh, hypot, abs, min, max and these SI constants: CONSTANTS.

Call the review tool with your verdict."""

REVIEW_TOOL = {
    "name": "review",
    "description": "Report the physics review verdict.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["pass", "fail"]},
            "problems": {"type": "array", "items": {"type": "string"}, "description": "Each real physics problem, with the fix. Empty when passing."},
            "recompute": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "number_index": {"type": "integer"},
                        "lines": {"type": "array", "items": {"type": "string"}},
                        "why": {"type": "string"},
                    },
                    "required": ["number_index", "lines"],
                },
            },
        },
        "required": ["verdict", "problems", "recompute"],
    },
}

_OPS = {ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul, ast.Div: op.truediv, ast.Pow: op.pow, ast.USub: op.neg, ast.UAdd: op.pos}
_FUNCS = {n: getattr(math, n) for n in ("sqrt", "exp", "log", "log10", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "hypot")}
_FUNCS.update(abs=abs, min=min, max=max)


def constants() -> dict:
    from app.sandbox import wie
    d = {k: float(v) for k, v in vars(wie).items() if not k.startswith("_") and isinstance(v, (int, float)) and not isinstance(v, bool)}
    d.update(pi=math.pi)
    return d


def _ev(n, names):
    if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
        return float(n.value)
    if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
        a, b = _ev(n.left, names), _ev(n.right, names)
        if isinstance(n.op, ast.Pow) and abs(b) > 64:
            raise ValueError("exponent too large")
        return float(_OPS[type(n.op)](a, b))
    if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
        return float(_OPS[type(n.op)](_ev(n.operand, names)))
    if isinstance(n, ast.Name) and n.id in names:
        return names[n.id]
    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in _FUNCS and not n.keywords:
        return float(_FUNCS[n.func.id](*[_ev(a, names) for a in n.args]))
    raise ValueError(f"not allowed: {type(n).__name__}")


def evaluate(lines: list[str], names: dict) -> float:
    """Evaluates a short list of formula lines with no access to anything but arithmetic and constants."""
    if not lines or len(lines) > 12 or any(len(l) > 300 for l in lines):
        raise ValueError("bad formula")
    env = dict(names)
    for line in lines[:-1]:
        tree = ast.parse(line.strip(), mode="exec")
        if len(tree.body) != 1 or not isinstance(tree.body[0], ast.Assign) or len(tree.body[0].targets) != 1 or not isinstance(tree.body[0].targets[0], ast.Name):
            raise ValueError("only simple assignments allowed")
        env[tree.body[0].targets[0].id] = _ev(tree.body[0].value, env)
    last = lines[-1].strip()
    if "=" in last and "==" not in last:
        last = last.split("=", 1)[1]
    v = _ev(ast.parse(last.strip(), mode="eval").body, env)
    if not math.isfinite(v):
        raise ValueError("not finite")
    return v


def judge(review: dict, scene: dict, names: dict) -> dict:
    """Turns the reviewer's output into a verdict, comparing its recomputed numbers against ours."""
    numbers = scene.get("numbers", [])
    matched, mismatches = [], []
    for item in review.get("recompute", [])[:4]:
        i = item.get("number_index")
        if not isinstance(i, int) or not 0 <= i < len(numbers):
            continue
        try:
            theirs = evaluate(item.get("lines", []), names)
        except Exception as e:
            log.info("recompute skipped: %s", e)
            continue
        ours = float(numbers[i]["value"])
        rel = abs(theirs - ours) / max(abs(ours), abs(theirs), 1e-300)
        rec = {"name": numbers[i]["name"], "ours": ours, "theirs": theirs, "unit": numbers[i].get("unit", ""), "rel": rel}
        (mismatches if rel > RECOMPUTE_RTOL else matched).append(rec)
    problems = _as_list(review.get("problems"))
    ok = review.get("verdict") == "pass" and not mismatches
    return {"status": "pass" if ok else "fail", "problems": problems, "matched": matched, "mismatches": mismatches}


def as_check(result: dict) -> dict:
    """Shows the review as one line in the self checks list."""
    n = len(result["matched"]) + len(result["mismatches"])
    if result["status"] == "pass":
        name = f"Independent review: physics audited, {n} headline number{'s' if n != 1 else ''} recomputed by a separate route and matched within 5%"
        return {"name": name, "value": float(n), "expected": float(n), "rtol": 0.0, "atol": 0.0, "passed": True, "source": "review"}
    bits = list(result["problems"])
    for m in result["mismatches"]:
        bits.append(f"'{m['name']}' is {m['ours']:.4g} {m['unit']} but an independent recompute gives {m['theirs']:.4g} {m['unit']}")
    return {"name": "Independent review failed: " + " | ".join(bits)[:1500], "value": float(len(result["matched"])), "expected": float(n), "rtol": 0.0, "atol": 0.0, "passed": False, "source": "review"}


def review(client, model: str, question: str, code: str, scene: dict) -> dict | None:
    """Runs the reviewer. Returns a judged result, or None if the reviewer was unavailable (never blocks an answer)."""
    try:
        names = constants()
        system = REVIEW_SYSTEM.replace("CONSTANTS", ", ".join(sorted(names)))
        nums = [{"index": i, "name": n["name"], "value": n["value"], "unit": n.get("unit", "")} for i, n in enumerate(scene.get("numbers", []))]
        checks = [{k: c.get(k) for k in ("name", "value", "expected", "passed")} for c in scene["diagnostics"]["checks"] if c.get("source") is None]
        user = (
            f"Question: {question}\n\nModel code:\n```python\n{code}\n```\n\n"
            f"Headline numbers it reported:\n{json.dumps(nums, indent=1)}\n\n"
            f"Its self checks:\n{json.dumps(checks, indent=1)}\n\nAnswer text: {scene.get('answer', '')}\n\nDetailed explanation: {scene.get('explanation', '')}\n\nOn Earth panel: {json.dumps(_earth_brief(scene))}"
        )
        resp = api_create(client, 
            model=model, max_tokens=4000, system=system, tools=[REVIEW_TOOL], tool_choice={"type": "auto"},
            messages=[{"role": "user", "content": user}],
        )
        block = next((b for b in resp.content if getattr(b, "type", "") == "tool_use" and b.name == "review"), None)
        if block is None:  # one nudge before giving up
            said = "".join(getattr(b, "text", "") for b in resp.content).strip() or "(no text)"
            resp = api_create(client, model=model, max_tokens=4000, system=system, tools=[REVIEW_TOOL], tool_choice={"type": "auto"},
                              messages=[{"role": "user", "content": user}, {"role": "assistant", "content": said},
                                        {"role": "user", "content": "Call the review tool now with your verdict."}])
            block = next((b for b in resp.content if getattr(b, "type", "") == "tool_use" and b.name == "review"), None)
        if block is None:
            log.warning("reviewer did not call the tool")
            return None
        out = judge(block.input, scene, names)
        out["tokens"] = {"input": resp.usage.input_tokens, "output": resp.usage.output_tokens}
        return out
    except Exception:
        log.exception("reviewer unavailable")
        return None


ORBIT_SYSTEM = """You are an independent physics referee. Another model set up an N-body gravity simulation to answer a what if question. A trusted integrator (REBOUND IAS15) ran it, so the integration itself is correct. Your job is to check the setup, because a wrong setup gives a precise answer to the wrong question.

Units: masses in solar masses, positions in AU, velocities in AU per year (a circular orbit at 1 AU around the Sun is 6.2832 AU/yr; the Moon orbits Earth at 0.2154 AU/yr relative to it at 0.00257 AU).

Check:
1. The bodies, masses, distances and velocities match the question and real data where the question keeps something real.
2. Velocities give the intended orbits (circular, bound, escaping) for that distance and mass.
3. The bodies included are the ones the question is about, and nothing that changes the answer is missing.
4. The duration is long enough to show the effect, and the physics flags (relativity, collisions, gravity speed) suit the question.
5. The outcome summary (closest approaches, final distances, events) is what physics predicts for this setup.

Fail only for errors that change the outcome or a headline number by more than 5%. Do not fail for style or for reasonable simplifications. Call the review tool with your verdict.

Then write for the public, using ONLY the numbers in Computed results and On Earth (copy them to 3 significant figures, keep the units):
- answer: the short answer, 2 or 3 plain sentences a 12 year old can follow, under 350 characters, the most important result first, including what it means for people on Earth when Earth is in the run. No jargon.
- explanation: the detailed explanation, 150 to 300 words in 3 to 5 short paragraphs separated by a blank line: the laws used by name (Newton's law of universal gravitation, Kepler's laws, conservation of energy and angular momentum, the Roche limit where relevant), the key equations in plain text (for example v = sqrt(G M / r)), the reasoning step by step with the numbers, and the proper terms (perihelion, eccentricity, Hill sphere, insolation). Say plainly that the On Earth temperatures are estimates from the sunlight balance.
Write both even when the verdict is fail."""

ORBIT_TOOL = {
    "name": "review",
    "description": "Report the setup review verdict.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["pass", "fail"]},
            "problems": {"type": "array", "items": {"type": "string"}, "description": "Each real problem, with the fix. Empty when passing."},
            "answer": {"type": "string", "description": "Short plain answer, 2 or 3 sentences, numbers only from Computed results and On Earth."},
            "explanation": {"type": "string", "description": "Detailed explanation: laws by name, equations, step by step reasoning, proper terms."},
        },
        "required": ["verdict", "problems", "answer", "explanation"],
    },
}


def orbit_summary(res: dict) -> dict:
    """Compact outcome of a gravity run: each body's distance from the heaviest body over time, and events."""
    import numpy as np

    bodies = res.get("bodies", [])
    frames = res.get("positions", [])
    if not bodies or not frames:
        return {}
    P = np.array([[p if p is not None else [np.nan] * 3 for p in fr] for fr in frames], dtype=float)
    h = int(np.argmax([b.get("mass_msun", 0) for b in bodies]))
    rows = []
    for i, b in enumerate(bodies):
        if i == h:
            continue
        d = np.linalg.norm(P[:, i] - P[:, h], axis=1)
        ok = np.isfinite(d)
        if not ok.any():
            continue
        rows.append({"body": b["name"], "from": bodies[h]["name"], "start_au": float(d[ok][0]), "min_au": float(d[ok].min()),
                     "max_au": float(d[ok].max()), "end_au": float(d[ok][-1]), "survives": bool(ok[-1])})
    pairs = []
    for i in range(len(bodies)):
        for j in range(i + 1, len(bodies)):
            d = np.linalg.norm(P[:, i] - P[:, j], axis=1)
            if np.isfinite(d).any():
                pairs.append((float(np.nanmin(d)), bodies[i]["name"], bodies[j]["name"]))
    pairs.sort()
    t = res.get("times", [])
    return {"duration": t[-1] if t else None, "units": res.get("units"), "distances": rows[:20],
            "closest_pairs_au": [{"a": a, "b": b, "min_au": m} for m, a, b in pairs[:5]],
            "events": res.get("events", [])[:10],
            "energy_error_rel": res.get("diagnostics", {}).get("energy_error_rel")}


def orbit_check(result: dict) -> dict:
    if result["status"] == "pass":
        return {"name": "Independent review: setup audited (masses, distances, velocities, duration) and the outcome matches physics",
                "value": 1.0, "expected": 1.0, "rtol": 0.0, "atol": 0.0, "passed": True, "source": "review"}
    return {"name": "Independent review failed: " + " | ".join(result["problems"])[:1500],
            "value": 0.0, "expected": 1.0, "rtol": 0.0, "atol": 0.0, "passed": False, "source": "review"}


def review_orbits(client, model: str, question: str, spec_input: dict, res: dict, numbers: list | None = None) -> dict | None:
    """Audits a gravity setup. Returns {status, problems, tokens}, or None if the reviewer was unavailable."""
    try:
        user = (f"Question: {question}\n\nSetup the other model chose:\n{json.dumps(spec_input, indent=1)}\n\n"
                f"What the integrator produced:\n{json.dumps(orbit_summary(res), indent=1)}\n\nComputed results (cite only these numbers):\n{json.dumps(numbers or [], indent=1)}\n\nOn Earth, computed from the orbits:\n{json.dumps(_earth_brief(res), indent=1)}")
        resp = api_create(client, 
            model=model, max_tokens=3000, system=ORBIT_SYSTEM, tools=[ORBIT_TOOL], tool_choice={"type": "auto"},
            messages=[{"role": "user", "content": user}],
        )
        block = next((b for b in resp.content if getattr(b, "type", "") == "tool_use" and b.name == "review"), None)
        if block is None:  # one nudge before giving up
            said = "".join(getattr(b, "text", "") for b in resp.content).strip() or "(no text)"
            resp = api_create(client, model=model, max_tokens=3000, system=ORBIT_SYSTEM, tools=[ORBIT_TOOL], tool_choice={"type": "auto"},
                              messages=[{"role": "user", "content": user}, {"role": "assistant", "content": said},
                                        {"role": "user", "content": "Call the review tool now with your verdict."}])
            block = next((b for b in resp.content if getattr(b, "type", "") == "tool_use" and b.name == "review"), None)
        if block is None:
            log.warning("orbit reviewer did not call the tool")
            return None
        problems = _as_list(block.input.get("problems"))
        ok = block.input.get("verdict") == "pass"
        return {"status": "pass" if ok else "fail", "problems": problems, "answer": str(block.input.get("answer") or "").strip(), "explanation": str(block.input.get("explanation") or "").strip(),
                "tokens": {"input": resp.usage.input_tokens, "output": resp.usage.output_tokens}}
    except Exception:
        log.exception("orbit reviewer unavailable")
        return None


def _as_list(v) -> list[str]:
    """Problems as a list, even when the model sends them as one string (sometimes wrapped in <item> tags)."""
    if v is None:
        return []
    if isinstance(v, str):
        parts = _re.split(r"</?item>", v) if "<item>" in v else [v]
        return [p.strip() for p in parts if p.strip()]
    return [str(p).strip() for p in v if str(p).strip()]


# shared list repair
from app.ai.coerce import as_list as _as_list  # noqa: E402,F811


# ---------- orbit answers: headline numbers, grounding, fallback ----------
def _g(v):
    return f"{v:.3g}"


def _earth_brief(obj) -> dict:
    """Compact On Earth panel for the reviewers: each gauge's start, range and end, plus the moments."""
    e = (obj or {}).get("earth") or {}
    out = {"series": [], "events": (e.get("events") or [])[:8]}
    for s in (e.get("series") or [])[:4]:
        v = [x for x in s.get("values", []) if x is not None]
        if v:
            out["series"].append({"name": s["name"], "unit": s.get("unit", ""), "today": s.get("today"),
                                  "start": v[0], "min": min(v), "max": max(v), "end": v[-1]})
    return out


def orbit_numbers(res: dict) -> list[dict]:
    """Headline results computed from a gravity run, for the panel and for the reviewer to cite."""
    s = orbit_summary(res)
    rows = sorted(s.get("distances", []), key=lambda r: 0 if "earth" in r["body"].lower() else 1)[:4]
    out = []
    for r in rows:
        note = (f"starts {_g(r['start_au'])} AU, ends {_g(r['end_au'])} AU" if r["survives"]
                else f"starts {_g(r['start_au'])} AU, destroyed before the end")
        out.append({"name": f"{r['body']}: closest to {r['from']}", "value": round(r["min_au"], 6), "unit": "AU", "note": note})
    for se in ((res.get("earth") or {}).get("series") or []):
        vals = [v for v in se["values"] if v is not None]
        if not vals:
            continue
        if se["name"] == "Average temperature":
            out.append({"name": "Hottest average on Earth", "value": max(vals), "unit": "°C", "note": "estimate from the sunlight balance"})
            if max(vals) - min(vals) > 1:
                out.append({"name": "Coldest average on Earth", "value": min(vals), "unit": "°C", "note": "today 15 °C"})
        elif se["name"] == "Tides vs today":
            out.append({"name": "Strongest tides on Earth", "value": max(vals), "unit": "× today", "note": "from the Moon's and stars' distances"})
    t = res.get("times") or []
    if t:
        out.append({"name": "Time simulated", "value": float(t[-1]) - float(t[0]), "unit": "years", "note": ""})
    return out[:8]


def ground_text(text: str, numbers: list[dict]) -> dict:
    from app.sandbox.runner import ground_answer
    return ground_answer({"answer": text or "", "numbers": numbers, "captions": [], "series": [], "times": []}, [])


def fallback_answer(numbers: list[dict]) -> str:
    if not numbers:
        return "The simulation ran; the computed results are below."
    return "; ".join(f"{n['name']}: {_g(n['value'])} {n['unit']}".strip() for n in numbers[:3]) + "."


def fallback_answer(numbers: list[dict]) -> str:  # noqa: F811  (replaces the list version above)
    if not numbers:
        return "The simulation ran; the computed results are below."
    by = {n["name"]: n for n in numbers}
    parts = []
    first = numbers[0]
    if first["unit"] == "AU" and ": closest to " in first["name"]:
        body, _, other = first["name"].partition(": closest to ")
        gone = "destroyed" in first.get("note", "")
        parts.append(f"{body} comes within {_g(first['value'])} AU of {other}" + (" and is destroyed before the end." if gone else "."))
    if "Hottest average on Earth" in by:
        parts.append(f"Earth's average temperature peaks at {_g(by['Hottest average on Earth']['value'])} °C, against 15 °C today.")
    if "Strongest tides on Earth" in by:
        parts.append(f"Tides reach {_g(by['Strongest tides on Earth']['value'])} times today's.")
    if "Time simulated" in by:
        parts.append(f"The simulation covers {_g(by['Time simulated']['value'])} years.")
    return " ".join(parts) or "; ".join(f"{n['name']}: {_g(n['value'])} {n['unit']}" for n in numbers[:3]) + "."
