import logging
import os

import anthropic
from anthropic import Anthropic
from pydantic import ValidationError

from app.ai.model_spec import ModelSpec
from app.ai.prompts import COMPOSER_SYSTEM
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


def _tools() -> list[dict]:
    return [
        {
            "name": TOOL_ORBITS,
            "description": "N-body gravity simulation for bodies moving under gravity. Also tier 'unknown' with engine 'none' for questions that are not physics.",
            "input_schema": spec_json_schema(),
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


def ask(question: str) -> dict:
    """question -> Claude picks a tool -> validate -> run -> self checks. Up to two repair rounds."""
    client = get_client()
    messages: list[dict] = [{"role": "user", "content": f"Question: {question}"}]
    meta = {"model": MODEL, "attempts": 0, "input_tokens": 0, "output_tokens": 0, "route": None}

    for attempt in range(1, MAX_ATTEMPTS + 1):
        meta["attempts"] = attempt
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
        try:
            if block.name == TOOL_ORBITS:
                spec = ScenarioSpec.model_validate(block.input).model_copy(update={"question": question})
                out = run_spec(spec)
                out["meta"] = meta
                return out

            m = ModelSpec.model_validate(block.input)
            scene = run_model(m.code)
            failed = [c for c in scene["diagnostics"]["checks"] if not c["passed"]]
            if failed and attempt < MAX_ATTEMPTS:
                problem = "Self checks failed: " + "; ".join(
                    f"{c['name']}: got {c['value']:.6g}, expected {c['expected']:.6g}" for c in failed
                ) + ". Fix the physics, do not loosen the checks."
            else:
                spec = {
                    "tier": m.tier,
                    "title": m.title,
                    "question": question,
                    "params": {"engine": "model", "code": m.code},
                    "cards": [],
                    "assumptions": m.assumptions,
                    "theories": [t.model_dump() for t in m.theories],
                }
                return {"spec": spec, "result": scene, "meta": meta}
        except ValidationError as e:
            problem = f"The tool input failed validation:\n{e}"
        except EngineError as e:
            problem = f"The engine rejected the spec: {e}"
        except ModelError as e:
            problem = f"The model failed:\n{e}"

        log.warning("attempt %d failed: %s", attempt, problem[:500])
        messages.append({"role": "assistant", "content": [{"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}]})
        messages.append(
            {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": block.id, "is_error": True, "content": f"{problem}\nFix it and call a tool again."}],
            }
        )

    raise ComposeError("Couldn't build a working simulation for that question after 3 tries. Try rephrasing it.")
