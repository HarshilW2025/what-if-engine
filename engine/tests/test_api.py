from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"ok": True}


def test_simulate_gravity():
    spec = {
        "tier": "exact", "title": "Sun and Earth", "question": "What does Earth's orbit look like?",
        "params": {"engine": "gravity", "duration_yr": 1, "frames": 20, "collisions": "none",
                   "bodies": [{"name": "Sun", "mass_msun": 1, "pos_au": [0, 0, 0], "vel_au_yr": [0, 0, 0]},
                              {"name": "Earth", "mass_msun": 3e-6, "pos_au": [1, 0, 0], "vel_au_yr": [0, 6.2832, 0]}]},
    }
    r = client.post("/simulate", json=spec)
    assert r.status_code == 200
    result = r.json()["result"]
    assert len(result["positions"]) == 20
    assert result["diagnostics"]["energy_error_rel"] < 1e-10


def test_unknown_tier_returns_no_simulation():
    spec = {"tier": "unknown", "title": "Before the Big Bang", "question": "What came before?",
            "params": {"engine": "none", "reason": "No accepted equations exist."}}
    r = client.post("/simulate", json=spec)
    assert r.status_code == 200
    assert r.json()["result"]["engine"] == "none"


def test_bad_spec_is_rejected():
    r = client.post("/simulate", json={"tier": "exact", "title": "x", "question": "x", "params": {"engine": "gravity"}})
    assert r.status_code == 422
