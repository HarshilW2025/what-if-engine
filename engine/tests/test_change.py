import math

import numpy as np
import pytest

from app.ai.earth import earth_from_orbits
from app.engines.gravity import run_gravity
from app.sandbox import wie
from app.spec import Body, Change, GravityParams

V = 2 * math.pi


def _sun_earth(change, duration=1.0, extra=()):
    return GravityParams(bodies=[Body(name="Sun", mass_msun=1.0, pos_au=[0, 0, 0], vel_au_yr=[0, 0, 0]),
                                 Body(name="Earth", mass_msun=3.0e-6, pos_au=[1, 0, 0], vel_au_yr=[0, V, 0]), *extra],
                         duration_yr=duration, frames=200, change=change)


def test_sun_vanishes_today_first_then_earth_flies_off():
    res = run_gravity(_sun_earth(Change(t_yr=0.25, label="The Sun vanishes", remove=["Sun"])))
    k = sum(1 for t in res["times"] if t < 0.25)
    assert k > 0 and all(fr[0] is not None for fr in res["positions"][:k])
    assert res["positions"][-1][0] is None and res["events"] == []
    assert res["change"]["removed"] == ["Sun"]
    assert 4.0 < math.hypot(*res["positions"][-1][1][:2]) < 5.5  # straight line at 2 pi AU/yr for 0.75 yr


def test_earth_stops_and_falls_into_the_sun():
    res = run_gravity(_sun_earth(Change(t_yr=0.2, label="Earth stops", speed_factor={"Earth": 0.0}), duration=0.5))
    assert any(ev["body"] == "Earth" for ev in res["events"])  # free fall from 1 AU takes 0.177 yr


def test_second_moon_appears():
    moon = Body(name="Second Moon", mass_msun=3.7e-8, pos_au=[0.003, 0, 0], vel_au_yr=[0, 0.1987, 0])
    res = run_gravity(_sun_earth(Change(t_yr=0.1, label="A second moon appears", appear=["Second Moon"], relative_to="Earth"),
                                 duration=0.3, extra=(moon,)))
    assert res["positions"][0][2] is None and res["positions"][-1][2] is not None and res["events"] == []


def test_unknown_names_rejected():
    with pytest.raises(ValueError):
        _sun_earth(Change(t_yr=0.25, label="x", remove=["Pluto"]))


def test_temperature_lags_after_the_sun_vanishes():
    res = run_gravity(_sun_earth(Change(t_yr=0.25, label="The Sun vanishes", remove=["Sun"])))
    e = earth_from_orbits(res)
    T = next(s for s in e["series"] if s["name"] == "Average temperature")["values"]
    assert abs(T[0] - 15) < 0.5
    assert -100 < T[-1] < 5  # cools over months, not instantly to -273 °C
    assert any(ev["text"] == "The Sun vanishes" for ev in e["events"])


def test_scene_change_marker():
    s = wie.Scene(np.linspace(0, 10, 20))
    s.body("Earth", [0, 0, 0], 1.0, kind="earth")
    s.change(3, "Earth spins 3,000 times faster")
    assert s.to_dict()["change"] == {"t": 3.0, "label": "Earth spins 3,000 times faster"}
