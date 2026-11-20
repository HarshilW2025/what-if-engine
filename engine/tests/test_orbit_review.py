import numpy as np

from app.ai.reviewer import orbit_check, orbit_summary
from app.sandbox import wie


def test_orbit_summary_reports_closest_pair():
    res = {"bodies": [{"name": "Sun", "mass_msun": 1.0}, {"name": "Earth", "mass_msun": 3e-6}, {"name": "Moon", "mass_msun": 3.7e-8}],
           "times": [0.0, 1.0], "positions": [[[0, 0, 0], [1, 0, 0], [1.0013, 0, 0]], [[0, 0, 0], [0, 1, 0], [0, 1.0013, 0]]],
           "events": [], "diagnostics": {"energy_error_rel": 1e-15}}
    s = orbit_summary(res)
    assert s["closest_pairs_au"][0]["a"] == "Earth" and abs(s["closest_pairs_au"][0]["min_au"] - 0.0013) < 1e-9
    assert {r["body"] for r in s["distances"]} == {"Earth", "Moon"}


def test_orbit_check_shapes():
    assert orbit_check({"status": "pass", "problems": []})["passed"]
    bad = orbit_check({"status": "fail", "problems": ["Moon speed is not circular"]})
    assert not bad["passed"] and "circular" in bad["name"]


def test_late_caption_is_pulled_to_the_end():
    s = wie.Scene(np.linspace(0, 10, 11))
    s.body("Earth", np.zeros((11, 3)), 1.0, kind="earth")
    s.caption(12.5, "late caption")
    assert s.to_dict()["captions"][-1]["t"] == 10.0
