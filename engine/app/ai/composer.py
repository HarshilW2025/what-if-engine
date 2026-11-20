import logging
import os

import anthropic
from anthropic import Anthropic
from pydantic import ValidationError

from app.ai.prompts import COMPOSER_SYSTEM
from app.engines import run_spec
from app.engines.errors import EngineError
from app.spec import ScenarioSpec, spec_json_schema

log = logging.getLogger("composer")

MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
TOOL_NAME = "emit_scenario"
MAX_ATTEMPTS = 2  # first try plus one repair


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
        _client = _KeyHeaderClient(api_key=key, timeout=90)
    return _client


def _tool() -> dict:
    return {
        "name": TOOL_NAME,
        "description": "Emit the ScenarioSpec that simulates the user's what if question. Always call this exactly once.",
        "input_schema": spec_json_schema(),
    }


def _call(client: Anthropic, messages: list[dict]):
    try:
        return client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=[{"type": "text", "text": COMPOSER_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            tools=[_tool()],
            tool_choice={"type": "auto"},  # Sonnet 5.5 rejects forced tool choice
            messages=messages,
        )
    except anthropic.APIError as e:
        log.exception("anthropic call failed")
        raise ComposeError(f"The AI service failed: {getattr(e, 'message', e)}") from e


def ask(question: str) -> dict:
    """question -> ScenarioSpec (Claude) -> validate -> run engine. One repair round on any problem."""
    client = get_client()
    messages: list[dict] = [{"role": "user", "content": f"Question: {question}"}]
    meta = {"model": MODEL, "attempts": 0, "input_tokens": 0, "output_tokens": 0}

    for _ in range(MAX_ATTEMPTS):
        meta["attempts"] += 1
        resp = _call(client, messages)
        meta["input_tokens"] += resp.usage.input_tokens
        meta["output_tokens"] += resp.usage.output_tokens

        block = next((b for b in resp.content if b.type == "tool_use" and b.name == TOOL_NAME), None)
        if block is None:
            # model answered in prose: keep its text, then insist on the tool
            text = "".join(getattr(b, "text", "") for b in resp.content).strip() or "(no text)"
            messages.append({"role": "assistant", "content": text})
            messages.append({"role": "user", "content": f"Do not answer in prose. Call {TOOL_NAME} now with the ScenarioSpec."})
            log.warning("no tool call, nudging")
            continue

        try:
            spec = ScenarioSpec.model_validate(block.input)
            spec = spec.model_copy(update={"question": question})
            out = run_spec(spec)
            out["meta"] = meta
            return out
        except ValidationError as e:
            problem = f"The spec failed validation:\n{e}"
        except EngineError as e:
            problem = f"The engine rejected the spec: {e}"

        log.warning("repairing spec: %s", problem)
        messages.append({"role": "assistant", "content": [{"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}]})
        messages.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "is_error": True,
                        "content": f"{problem}\nFix every problem and call {TOOL_NAME} again.",
                    }
                ],
            }
        )

    raise ComposeError("Couldn't build a valid simulation for that question. Try rephrasing it.")
