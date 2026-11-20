from app.spec import ScenarioSpec
from .errors import EngineError


def run_spec(spec: ScenarioSpec) -> dict:
    p = spec.params
    if p.engine == "gravity":
        from .gravity import run_gravity
        result = run_gravity(p)
    elif p.engine == "none":
        result = {"engine": "none", "reason": p.reason}
    else:
        raise EngineError(f"The {p.engine} engine is not built yet.")
    return {"spec": spec.model_dump(), "result": result}


__all__ = ["run_spec", "EngineError"]
