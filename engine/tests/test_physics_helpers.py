"""Benchmarks for the wie physics helpers against textbook results (Gate 2)."""
import math

import numpy as np
import pytest

from app.sandbox import wie

LY = wie.ly


# ---------- relativity ----------
def test_cruise_99_99_percent_to_proxima():
    r = wie.cruise(4.2465 * LY, 0.9999 * wie.c)
    assert r["gamma"] == pytest.approx(70.712, rel=1e-4)
    assert r["t_earth_s"] / wie.year == pytest.approx(4.2465 / 0.9999, rel=1e-6)
    assert r["t_ship_s"] == pytest.approx(r["t_earth_s"] / r["gamma"], rel=1e-12)


def test_rocket_1g_to_galactic_centre_matches_known_result():
    # Classic result: 1 g with flip over ~26,000 ly takes about 20 years of ship time.
    r = wie.rocket(26000 * LY, accel=wie.g0, flip=True)
    tau_years = r["tau_total_s"] / wie.year
    expected = 2 * (wie.c / wie.g0) * math.acosh(1 + wie.g0 * 13000 * LY / wie.c**2) / wie.year
    assert tau_years == pytest.approx(expected, rel=1e-9)
    assert 19 < tau_years < 21
    assert r["x_m"][-1] == pytest.approx(26000 * LY, rel=1e-9)
    assert r["v"][-1] == pytest.approx(0.0, abs=1e-3)


def test_rocket_low_speed_limit_is_newtonian():
    d = 1e9
    r = wie.rocket(d, accel=1.0, flip=True)
    assert r["tau_total_s"] == pytest.approx(2 * math.sqrt(d / 1.0), rel=1e-6)


def test_doppler_and_aberration():
    v = 0.6 * wie.c
    assert wie.doppler_factor(v, 0.0) == pytest.approx(2.0, rel=1e-12)
    assert wie.doppler_factor(v, math.pi) == pytest.approx(0.5, rel=1e-12)
    assert wie.aberration(math.pi / 2, v) == pytest.approx(math.acos(0.6), rel=1e-12)


# ---------- cosmology ----------
def test_planck_age_of_universe():
    r = wie.friedmann()
    assert r["age_gyr"] == pytest.approx(13.79, abs=0.05)
    assert r["fate"] == "expands forever"


def test_einstein_de_sitter_age():
    r = wie.friedmann(h0=70, omega_m=1.0, omega_r=0.0, omega_de=0.0, t_future_gyr=20)
    assert r["age_gyr"] == pytest.approx(2 / (3 * 70 * wie.KM_S_MPC_PER_GYR), rel=1e-6)


def test_closed_universe_recollapses_on_time():
    h0, om = 70.0, 2.0
    r = wie.friedmann(h0=h0, omega_m=om, omega_r=0.0, omega_de=0.0, t_future_gyr=200)
    H0 = h0 * wie.KM_S_MPC_PER_GYR
    t_crunch = math.pi * om / (2 * H0 * (om - 1) ** 1.5) * 2  # total lifetime of a closed matter universe
    assert r["fate"] == "big crunch"
    assert r["t_end_gyr"] == pytest.approx(t_crunch, rel=1e-3)


def test_big_rip_time_matches_caldwell_estimate():
    h0, om, w = 70.0, 0.3, -1.5
    r = wie.friedmann(h0=h0, omega_m=om, omega_r=0.0, omega_de=0.7, w0=w, t_future_gyr=200)
    H0 = h0 * wie.KM_S_MPC_PER_GYR
    approx = 2 / (3 * abs(1 + w) * H0 * math.sqrt(1 - om))
    assert r["fate"] == "big rip"
    assert r["t_end_gyr"] - r["age_gyr"] == pytest.approx(approx, rel=0.05)


# ---------- quantum ----------
def test_free_packet_spreads_and_conserves_probability():
    x = np.linspace(-100, 100, 1024)
    s0 = 2.0
    psi0 = wie.gaussian_packet(x, 0.0, s0, 0.0)
    t = np.linspace(0, 10, 5)
    psi = wie.schrodinger_1d(x, psi0, np.zeros_like(x), t)
    p = np.abs(psi[-1]) ** 2
    assert np.trapezoid(p, x) == pytest.approx(1.0, abs=1e-9)
    sigma = math.sqrt(np.trapezoid(p * x**2, x))
    assert sigma == pytest.approx(s0 * math.sqrt(1 + (t[-1] / (2 * s0**2)) ** 2), rel=1e-3)


def test_harmonic_oscillator_coherent_state_oscillates():
    x = np.linspace(-20, 20, 512)
    w = 1.0
    psi0 = wie.gaussian_packet(x, 3.0, 1 / math.sqrt(2 * w), 0.0)
    t = np.linspace(0, math.pi, 3)
    psi = wie.schrodinger_1d(x, psi0, 0.5 * w**2 * x**2, t)
    mean = [np.trapezoid(np.abs(p) ** 2 * x, x) for p in psi]
    assert mean[1] == pytest.approx(3.0 * math.cos(w * t[1]), abs=1e-3)
    assert mean[2] == pytest.approx(-3.0, abs=1e-3)


def test_double_slit_central_and_first_minimum():
    lam, d, a, L = 500e-9, 1e-4, 1e-5, 1.0
    assert wie.double_slit_intensity(0.0, lam, d, a, L) == pytest.approx(1.0)
    y_min = L * math.tan(math.asin(lam / (2 * d)))
    assert wie.double_slit_intensity(y_min, lam, d, a, L) == pytest.approx(0.0, abs=1e-12)


# ---------- black holes ----------
def test_solar_mass_black_hole_numbers():
    bh = wie.black_hole(wie.M_sun)
    assert bh["r_s_m"] == pytest.approx(2953.0, rel=1e-3)
    assert bh["hawking_temperature_K"] == pytest.approx(6.17e-8, rel=1e-2)
    assert bh["evaporation_time_years"] == pytest.approx(2.1e67, rel=0.05)
    assert bh["shadow_radius_m"] == pytest.approx(1.5 * math.sqrt(3) * bh["r_s_m"], rel=1e-12)
    assert bh["r_isco_m"] == pytest.approx(3 * bh["r_s_m"], rel=1e-9)


def test_kerr_isco_extremes():
    rg = wie.G * wie.M_sun / wie.c**2
    assert wie.black_hole(wie.M_sun, spin=0.998)["r_isco_m"] / rg == pytest.approx(1.237, rel=1e-2)


def test_infall_matches_newtonian_fall_time_and_horizon():
    M = 10 * wie.M_sun
    rs = wie.black_hole(M)["r_s_m"]
    r0 = 10 * rs
    f = wie.infall(M, r0)
    assert f["tau_to_singularity_s"] == pytest.approx(math.pi / 2 * math.sqrt(r0**3 / (2 * wie.G * M)), rel=1e-9)
    assert f["tau_to_horizon_s"] < f["tau_to_singularity_s"]
    inside = f["r_m"] < rs
    assert np.all(np.isnan(f["t_s"][inside])) and np.all(np.isfinite(f["t_s"][~inside]))
    near = (f["r_m"] > rs) & (f["r_m"] < 1.0001 * rs)
    if near.any():
        assert np.nanmax(f["v_local"][near]) > 0.99 * wie.c


def test_tidal_acceleration_scales_as_inverse_cube():
    a1 = wie.tidal_acceleration(wie.M_sun, 1e7)
    a2 = wie.tidal_acceleration(wie.M_sun, 2e7)
    assert a1 / a2 == pytest.approx(8.0)
