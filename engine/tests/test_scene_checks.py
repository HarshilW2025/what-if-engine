from app.sandbox.runner import scene_checks

F = 50


def body(name, kind, radius, pos):
    return {"name": name, "kind": kind, "radius": radius, "positions": [pos] * F}


def test_separate_bodies_pass():
    scene = {"bodies": [body("Earth", "earth", 1.0, [0, 0, 0]), body("Moon", "moon", 0.27, [30, 0, 0])], "clouds": []}
    assert scene_checks(scene) == []


def test_overlapping_bodies_fail():
    scene = {"bodies": [body("Earth", "earth", 20.0, [0, 0, 0]), body("Moon", "moon", 5.0, [15, 0, 0])], "clouds": []}
    fails = scene_checks(scene)
    assert len(fails) == 1 and "overlapping" in fails[0]["name"]


def test_ship_inside_star_is_fine():
    scene = {"bodies": [body("Sun", "star", 10.0, [0, 0, 0]), body("Probe", "ship", 0.1, [1, 0, 0])], "clouds": []}
    assert scene_checks(scene) == []


def test_shrinking_planet_with_debris_fails():
    earth = {"name": "Earth", "kind": "earth", "radius": [1.0 - 0.015 * k for k in range(F)], "positions": [[0, 0, 0]] * F}
    cloud = {"name": "debris", "points": [[[0.5 * (1 + 0.2 * k), 0, 0]] * 10 for k in range(F)]}
    fails = scene_checks({"bodies": [earth], "clouds": [cloud]})
    assert len(fails) == 1 and "shrinks" in fails[0]["name"]


def test_comparison_copy_is_allowed():
    real = {"name": "Earth", "kind": "earth", "radius": 1.0, "positions": [[k * 0.01, 0, 0] for k in range(F)]}
    ghost = {"name": "Earth if the Sun had stayed", "kind": "earth", "radius": 1.0, "positions": [[0, k * 0.001, 0] for k in range(F)]}
    assert scene_checks({"bodies": [real, ghost], "clouds": []}) == []


def test_per_frame_scale_is_handled():
    a = {"name": "Earth", "kind": "earth", "radius": 1.0, "scale": [2.0] * F, "positions": [[0, 0, 0]] * F}
    b = {"name": "Rock", "kind": "rock", "radius": 1.0, "scale": [1.0] * F, "positions": [[2.5, 0, 0]] * F}
    assert len(scene_checks({"bodies": [a, b], "clouds": []})) == 1


def test_broken_scene_never_raises():
    assert scene_checks({"bodies": [{"name": "x", "kind": "earth", "positions": "oops"}]}) == []
