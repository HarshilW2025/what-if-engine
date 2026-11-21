import numpy as np

from app.ai.earth import earth_from_orbits, luminosity
from app.ai.reviewer import fallback_answer, ground_text, orbit_numbers
from app.sandbox import wie


def _res(earth_au, moon=True, n=50):
    bodies = [{"id": 0, "name": "Sun", "mass_msun": 1.0, "radius_au": 0.00465, "color": "#ffffff"},
              {"id": 1, "name": "Earth", "mass_msun": 3.0e-6, "radius_au": 4.26e-5, "color": "#0000ff"}]
    if moon:
        bodies.append({"id": 2, "name": "Moon", "mass_msun": 3.694e-8, "radius_au": 1.16e-5, "color": "#aaaaaa"})
    pos = [[[0, 0, 0], [earth_au, 0, 0]] + ([[earth_au + 0.00257, 0, 0]] if moon else []) for _ in range(n)]
    return {"engine": "gravity", "bodies": bodies, "times": [k * 0.02 for k in range(n)], "positions": pos, "events": [], "diagnostics": {}}


def test_today_reads_as_today():
    by = {s["name"]: s for s in earth_from_orbits(_res(1.0))["series"]}
    assert abs(by["Average temperature"]["values"][0] - 15) < 0.01
    assert abs(by["Sunlight vs today"]["values"][0] - 100) < 0.01
    assert abs(by["Tides vs today"]["values"][0] - 1) < 0.01


def test_closer_sun_is_hotter():
    e = earth_from_orbits(_res(0.5, moon=False))
    T = next(s for s in e["series"] if s["name"] == "Average temperature")["values"][0]
    assert abs(T - (288.15 * 2**0.5 - 273.15)) < 0.5
    assert e["events"][0]["text"].startswith("Start")


def test_no_earth_no_panel():
    r = _res(1.0)
    r["bodies"][1]["name"] = "Mars"
    assert earth_from_orbits(r) is None


def test_luminosity():
    assert luminosity(1.0) == 1.0 and luminosity(0.05) == 0.0


def test_orbit_numbers_and_grounding():
    r = _res(1.0)
    r["earth"] = earth_from_orbits(r)
    nums = orbit_numbers(r)
    assert nums and all({"name", "value", "unit", "note"} <= set(n) for n in nums)
    assert ground_text("Earth stays at 15 °C.", nums)["ungrounded"] == []
    assert fallback_answer([]) and fallback_answer(nums)


def test_scene_explain_and_on_earth():
    s = wie.Scene(np.linspace(0, 10, 20))
    s.body("Earth", [0, 0, 0], 1.0, kind="earth")
    s.answer("Short.")
    s.explain("Long.\n\nMore.")
    s.on_earth("Average temperature", np.linspace(15, 30, 20), "°C", today=15)
    s.earth_event(5, "Hot.")
    d = s.to_dict()
    assert d["explanation"].startswith("Long")
    assert d["earth"]["series"][0]["today"] == 15 and d["earth"]["events"][0]["t"] == 5
    s2 = wie.Scene(np.linspace(0, 1, 5))
    s2.body("Rock", [0, 0, 0], 1.0)
    assert s2.to_dict()["earth"] is None
