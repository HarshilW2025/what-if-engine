import copy
import json
import logging
import os

import anthropic
from anthropic import Anthropic
from pydantic import ValidationError

from app.ai import cards as card_lib
from app.ai.model_spec import ModelSpec
from app.ai.prompts import CARDS_NOTE, COMPOSER_SYSTEM
from app.engines import run_spec
from app.engines.errors import EngineError
from app.sandbox.runner import ModelError, run_model
from app.spec import ScenarioSpec, spec_json_schema

log = logging.getLogger("composer")

MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
TOOL_ORBITS = "simulate_orbits"
TOOL_MODEL = "write_model"
MAX_ATTEMPTS = 3  # first try plus two repairs


class ComposeError(Exception):
    """User facing message."""


class _KeyHeaderClient(Anthropic):
    """Newer SDKs send api_key as 'Authorization: Bearer'. Some keys are only accepted as 'x-api-key'."""

    @property
    def auth_headers(self) -> dict[str, str]:
        return {"X-Api-Key": self.api_key} if self.api_key else {}


_client: Anthropic | None = None


def get_client() -> Anthropic:
    global _client
    if _client is None:
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise ComposeError("The server has no ANTHROPIC_API_KEY set.")
        _client = _KeyHeaderClient(api_key=key, timeout=240)
    return _client


def _orbits_schema() -> dict:
    s = copy.deepcopy(spec_json_schema())
    params = s.get("properties", {}).get("params", {})
    keep = ("GravityParams", "NoSimParams")
    for key in ("oneOf", "anyOf"):
        if key in params:
            kept = [r for r in params[key] if r.get("$ref", "").split("/")[-1] in keep]
            if kept:
                params[key] = kept
    mapping = params.get("discriminator", {}).get("mapping")
    if mapping:
        kept_map = {k: v for k, v in mapping.items() if v.split("/")[-1] in keep}
        if kept_map:
            params["discriminator"]["mapping"] = kept_map
    return s


def _tools() -> list[dict]:
    return [
        {
            "name": TOOL_ORBITS,
            "description": "N-body gravity simulation for bodies moving under gravity. Also tier 'unknown' with engine 'none' for questions that are not physics.",
            "input_schema": _orbits_schema(),
        },
        {
            "name": TOOL_MODEL,
            "description": "Write and run a Python physics model (numpy, scipy and the wie toolkit) for any question the orbit engine does not cover.",
            "input_schema": ModelSpec.model_json_schema(),
        },
    ]


def _call(client: Anthropic, messages: list[dict]):
    try:
        return client.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=[{"type": "text", "text": COMPOSER_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            tools=_tools(),
            tool_choice={"type": "auto"},
            messages=messages,
        )
    except anthropic.APIError as e:
        log.exception("anthropic call failed")
        raise ComposeError(f"The AI service failed: {getattr(e, 'message', e)}") from e


def ask(question: str, progress=None) -> dict:
    """question -> Claude picks a tool -> validate -> run -> self checks. Up to two repair rounds.
    progress(stage, detail) is called at each real step (kept in meta.pipeline for debugging)."""
    report = progress or (lambda stage, detail: None)
    client = get_client()
    library, _ = card_lib.load_cards()
    found = card_lib.retrieve(question, library)
    by_id = {c.id: c for c in found}
    report("retrieve", f"Found {len(found)} relevant theory card{'s' if len(found) != 1 else ''}" if found else "No theory cards needed: established physics")
    content = f"Question: {question}"
    if found:
        content += "\n\n" + CARDS_NOTE + "\n" + "\n".join(f'<card id="{c.id}">{json.dumps(c.for_prompt())}</card>' for c in found)
    messages: list[dict] = [{"role": "user", "content": content}]
    meta = {"model": MODEL, "attempts": 0, "input_tokens": 0, "output_tokens": 0, "route": None, "cards_retrieved": list(by_id)}

    for attempt in range(1, MAX_ATTEMPTS + 1):
        meta["attempts"] = attempt
        report("compose", "Claude is writing the physics model" if attempt == 1 else f"Claude is fixing the model (attempt {attempt} of {MAX_ATTEMPTS})")
        resp = _call(client, messages)
        meta["input_tokens"] += resp.usage.input_tokens
        meta["output_tokens"] += resp.usage.output_tokens

        block = next((b for b in resp.content if b.type == "tool_use" and b.name in (TOOL_ORBITS, TOOL_MODEL)), None)
        if block is None:
            text = "".join(getattr(b, "text", "") for b in resp.content).strip() or "(no text)"
            messages.append({"role": "assistant", "content": text})
            messages.append({"role": "user", "content": f"Do not answer in prose. Call {TOOL_MODEL} or {TOOL_ORBITS} now."})
            continue

        meta["route"] = block.name
        report("run", "Running the N-body gravity integrator" if block.name == TOOL_ORBITS else "Running the model in the sandbox")
        try:
            if block.name == TOOL_ORBITS:
                spec = ScenarioSpec.model_validate(block.input).model_copy(update={"question": question})
                out = run_spec(spec)
                out["meta"] = meta
                return out

            m = ModelSpec.model_validate(block.input)
            scene = run_model(m.code)
            failed = [c for c in scene["diagnostics"]["checks"] if not c["passed"]]
            n_checks = len(scene["diagnostics"]["checks"])
            report("check", f"Self checks: {n_checks - len(failed)} of {n_checks} passed" + (", repairing" if failed and attempt < MAX_ATTEMPTS else ""))
            if failed and attempt < MAX_ATTEMPTS:
                problem = "Self checks failed: " + "; ".join(
                    f"{c['name']}: got {c['value']:.6g}, expected {c['expected']:.6g}" for c in failed
                ) + ". Fix the physics, do not loosen the checks."
            else:
                theories = []
                for th in m.theories:
                    d = th.model_dump()
                    if d.get("card") not in by_id:
                        d["card"] = None  # strip any citation to a card we did not supply
                    theories.append(d)
                used = sorted({d["card"] for d in theories if d["card"]})
                spec = {
                    "tier": m.tier,
                    "title": m.title,
                    "question": question,
                    "params": {"engine": "model", "code": m.code},
                    "cards": used,
                    "card_refs": [by_id[i].ref() for i in used],
                    "assumptions": m.assumptions,
                    "theories": theories,
                }
                return {"spec": spec, "result": scene, "meta": meta}
        except ValidationError as e:
            problem = f"The tool input failed validation:\n{e}"
        except EngineError as e:
            problem = f"The engine rejected the spec: {e}"
        except ModelError as e:
            problem = f"The model failed:\n{e}"

        log.warning("attempt %d failed: %s", attempt, problem[:500])
        report("repair", "Found a problem: " + problem.splitlines()[0][:110])
        messages.append({"role": "assistant", "content": [{"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}]})
        messages.append(
            {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": block.id, "is_error": True, "content": f"{problem}\nFix it and call a tool again."}],
            }
        )

    raise ComposeError("Couldn't build a working simulation for that question after 3 tries. Try rephrasing it.")
