import numpy as np

from app.sandbox import wie
from app.sandbox.runner import scene_checks


def test_unknown_camera_focus_falls_back():
    s = wie.Scene(np.linspace(0, 10, 11))
    s.body("Earth", np.zeros((11, 3)), 1.0, kind="earth")
    s.camera(focus="Ejecta")
    assert s.to_dict()["camera"]["focus"] is None


def test_tiny_body_inside_big_one_is_fine():
    F = 20
    big = {"name": "Betelgeuse", "kind": "star", "radius": 1000.0, "positions": [[0, 0, 0]] * F}
    tiny = {"name": "Neutron star", "kind": "star", "radius": 0.01, "positions": [[0, 0, 0]] * F}
    assert scene_checks({"bodies": [big, tiny], "clouds": []}) == []
