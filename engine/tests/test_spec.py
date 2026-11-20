import pytest
from pydantic import ValidationError

from app.spec import ScenarioSpec, spec_json_schema


def four_suns() -> dict:
    v = 3.2
    return {
        "tier": "exact",
        "title": "Four suns",
        "question": "What if our solar system had four suns?",
        "params": {
            "engine": "gravity",
            "duration_yr": 50,
            "bodies": [
                {"name": "Sun A", "mass_msun": 1, "pos_au": [1, 0, 0], "vel_au_yr": [0, v, 0]},
                {"name": "Sun B", "mass_msun": 1, "pos_au": [0, 1, 0], "vel_au_yr": [-v, 0, 0]},
                {"name": "Sun C", "mass_msun": 1, "pos_au": [-1, 0, 0], "vel_au_yr": [0, -v, 0]},
                {"name": "Sun D", "mass_msun": 1, "pos_au": [0, -1, 0], "vel_au_yr": [v, 0, 0]},
                {"name": "Earth", "mass_msun": 3.0e-6, "pos_au": [5, 0, 0], "vel_au_yr": [0, 5.6, 0]},
            ],
        },
        "assumptions": ["point masses", "no tides"],
    }


def test_valid_gravity_spec():
    spec = ScenarioSpec.model_validate(four_suns())
    assert spec.params.engine == "gravity"
    assert len(spec.params.bodies) == 5


def test_theory_tier_needs_a_card():
    data = four_suns() | {"tier": "theory"}
    with pytest.raises(ValidationError, match="at least one theory card"):
        ScenarioSpec.model_validate(data)


def test_unknown_tier_cannot_simulate():
    data = four_suns() | {"tier": "unknown"}
    with pytest.raises(ValidationError, match="must not run a simulation"):
        ScenarioSpec.model_validate(data)


def test_unknown_tier_with_no_sim():
    spec = ScenarioSpec.model_validate({
        "tier": "unknown", "title": "Before the Big Bang",
        "question": "What happened before the Big Bang?",
        "params": {"engine": "none", "reason": "no accepted equations"},
    })
    assert spec.params.engine == "none"


def test_cruise_must_be_below_light_speed():
    with pytest.raises(ValidationError, match="0 < speed_c < 1"):
        ScenarioSpec.model_validate({
            "tier": "exact", "title": "Too fast", "question": "q",
            "params": {"engine": "relativity", "mode": "cruise", "distance_ly": 4.2, "speed_c": 1.5},
        })


def test_unknown_field_is_rejected():
    data = four_suns()
    data["params"]["warp_factor"] = 9
    with pytest.raises(ValidationError):
        ScenarioSpec.model_validate(data)


def test_cosmology_defaults_are_flat():
    spec = ScenarioSpec.model_validate({
        "tier": "exact", "title": "Our universe", "question": "q",
        "params": {"engine": "cosmology"},
    })
    assert abs(spec.params.omega_k) < 1e-3


def test_json_schema_builds():
    schema = spec_json_schema()
    assert "params" in schema["properties"]
