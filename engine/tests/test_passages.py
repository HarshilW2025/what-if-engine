import numpy as np

from app.sandbox import wie


def test_periodic_orbit_pericentres():
    P = 2.0
    t = np.linspace(0, 3 * P, 3001)
    r = 2 + np.cos(2 * np.pi * t / P)
    out = wie.passages(t, r)
    assert np.allclose(out["peri_t"], [P / 2, 3 * P / 2, 5 * P / 2], atol=0.01)
    assert out["first_pass_kind"] == "pericentre" and abs(out["first_pass_r"] - 1) < 1e-3


def test_plunge_is_not_a_pericentre():
    t = np.linspace(0, 10, 500)
    r = np.maximum(100 * (1 - t / 10), 1.0) + 0.001 * np.sin(40 * t)  # jitter inside the core
    out = wie.passages(t, r, merge_radius=2.0)
    assert out["peri_t"] == [] and out["first_pass_kind"] == "plunge"
    assert 9.7 < out["merge_t"] < 9.95


def test_run_too_short():
    t = np.linspace(0, 1, 50)
    out = wie.passages(t, 10 - t)
    assert out["run_too_short"] and out["first_pass_kind"] is None
