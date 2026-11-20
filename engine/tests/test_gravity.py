import math

import rebound

from app.engines.gravity import C_AU_PER_YR, build_simulation, run_gravity
from app.spec import GravityParams

G = 4 * math.pi ** 2
M_EARTH = 3.0e-6


def body(name, m, pos, vel, r=0.0):
    return {"name": name, "mass_msun": m, "pos_au": pos, "vel_au_yr": vel, "radius_au": r}


def sun_earth(**kw):
    v = 2 * math.pi * math.sqrt(1 + M_EARTH)          # circular speed for the pair
    defaults = dict(duration_yr=1.0, frames=50, collisions="none")
    defaults.update(kw)
    return GravityParams(bodies=[body("Sun", 1.0, [0, 0, 0], [0, 0, 0]),
                                 body("Earth", M_EARTH, [1, 0, 0], [0, v, 0])], **defaults)


def relative_a(sim):
    return sim.particles[1].orbit(primary=sim.particles[0]).a


def test_earth_returns_after_one_year():
    period = 1 / math.sqrt(1 + M_EARTH)
    res = run_gravity(sun_earth(duration_yr=period))
    first, last = res["positions"][0], res["positions"][-1]
    rel0 = [e - s for e, s in zip(first[1], first[0])]
    rel1 = [e - s for e, s in zip(last[1], last[0])]
    assert math.dist(rel0, rel1) < 1e-5


def test_energy_conserved_over_a_century():
    res = run_gravity(sun_earth(duration_yr=100, frames=100))
    assert res["diagnostics"]["conservative"] is True
    assert res["diagnostics"]["energy_error_rel"] < 1e-12


def test_mercury_relativistic_precession():
    s = rebound.Simulation()
    s.G = G
    s.add(m=1.0)
    s.add(m=1.66e-7, a=0.387098, e=0.205630, primary=s.particles[0])
    ps = s.particles
    p = GravityParams(
        bodies=[body("Sun", 1.0, [ps[0].x, ps[0].y, ps[0].z], [ps[0].vx, ps[0].vy, ps[0].vz]),
                body("Mercury", 1.66e-7, [ps[1].x, ps[1].y, ps[1].z], [ps[1].vx, ps[1].vy, ps[1].vz])],
        duration_yr=100, frames=10, gr_1pn=True, collisions="none")
    sim, forces = build_simulation(p)
    w0 = sim.particles[1].orbit(primary=sim.particles[0]).pomega
    sim.integrate(100.0)
    w1 = sim.particles[1].orbit(primary=sim.particles[0]).pomega
    measured = math.degrees((w1 - w0 + math.pi) % (2 * math.pi) - math.pi) * 3600   # arcsec per century

    a, e = 0.387098, 0.205630
    per_orbit = 6 * math.pi * G * 1.0 / (C_AU_PER_YR ** 2 * a * (1 - e * e))
    period = 2 * math.pi * math.sqrt(a ** 3 / (G * (1.0 + 1.66e-7)))
    expected = math.degrees(per_orbit * 100 / period) * 3600
    assert abs(expected - 42.98) / 42.98 < 0.01          # the formula itself gives 43"
    assert abs(measured - expected) / expected < 0.01    # and the engine reproduces it


def test_laplace_delayed_gravity_spirals_out():
    instant, f1 = build_simulation(sun_earth(duration_yr=50))
    delayed, f2 = build_simulation(sun_earth(duration_yr=50, gravity_speed="delayed_naive"))
    a0_i, a0_d = relative_a(instant), relative_a(delayed)
    instant.integrate(50.0)
    delayed.integrate(50.0)
    assert abs(relative_a(instant) - a0_i) < 1e-9
    assert relative_a(delayed) - a0_d > 0.03            # about 0.06 AU in 50 years


def test_gravitational_wave_decay_matches_peters():
    m, a = 10.0, 1e-4
    v = math.sqrt(G * 2 * m / a)
    p = GravityParams(bodies=[body("BH 1", m, [-a / 2, 0, 0], [0, -v / 2, 0]),
                              body("BH 2", m, [a / 2, 0, 0], [0, v / 2, 0])],
                      duration_yr=1.0, gw_radiation=True, collisions="none")
    sim, forces = build_simulation(p)
    period = 2 * math.pi * math.sqrt(a ** 3 / (G * 2 * m))
    t = 100 * period
    a0 = relative_a(sim)
    sim.integrate(t)
    measured = relative_a(sim) - a0
    expected = -(64 / 5) * G ** 3 * m * m * (2 * m) / (C_AU_PER_YR ** 5 * a ** 3) * t
    assert measured < 0
    assert abs(measured - expected) / abs(expected) < 0.02


def test_head_on_collision_merges():
    p = GravityParams(bodies=[body("A", 1e-3, [-1, 0, 0], [1, 0, 0], r=0.05),
                              body("B", 1e-3, [1, 0, 0], [-1, 0, 0], r=0.05)],
                      duration_yr=2.0, frames=40, collisions="merge")
    res = run_gravity(p)
    assert len(res["events"]) == 1
    assert sum(v is None for v in res["positions"][-1]) == 1


def test_chaotic_three_body_has_prediction_horizon():
    p = GravityParams(bodies=[body("Star 3", 3.0, [1, 3, 0], [0, 0, 0]),
                              body("Star 4", 4.0, [-2, -1, 0], [0, 0, 0]),
                              body("Star 5", 5.0, [1, -1, 0], [0, 0, 0])],
                      duration_yr=12.0, frames=480, collisions="none")
    res = run_gravity(p)
    h = res["diagnostics"]["prediction_horizon_yr"]
    assert res["diagnostics"]["horizon_checked"] is True
    assert h is not None and 0 < h < 12
