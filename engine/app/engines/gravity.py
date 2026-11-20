"""Gravity engine: N-body dynamics with REBOUND's IAS15 integrator.

Units: AU, years, solar masses, with G = 4 pi^2 (1 AU around 1 Msun takes exactly 1 year).

Physics switches:
  instant        Newtonian gravity, integrated to machine precision (Rein and Spiegel 2015).
  delayed_naive  Laplace's thought experiment: gravity moves at c but has no compensating
                 velocity terms, so the pull aberrates by v/c and orbits spiral outward
                 within about a century (Carlip 1999).
  gr_1pn         First post-Newtonian correction around the most massive body.
                 Reproduces Mercury's 43 arcseconds per century.
  gw_radiation   The two most massive bodies lose orbital energy at the Peters (1964) rate.
"""
from __future__ import annotations

import math
import time

import numpy as np
import rebound

from app.spec import GravityParams
from .errors import EngineError

GAUSS_K = 0.01720209895                      # Gaussian gravitational constant, rad/day
YEAR_S = 2 * math.pi / GAUSS_K * 86400.0      # the "year" implied by G = 4 pi^2
AU_M = 149_597_870_700.0
C_AU_PER_YR = 299_792_458.0 * YEAR_S / AU_M   # speed of light, about 63,242 AU/yr

WALL_LIMIT_S = 25.0       # stop and return what we have if a run takes longer
MAX_POINTS = 60_000       # frames x bodies cap, keeps the JSON small
MAX_FORCE_BODIES = 20     # python-side forces are O(N^2) per call
HORIZON_SEED = 1e-9       # starting error, as a fraction of system size, for the twin run
HORIZON_LIMIT = 0.01      # horizon = when the twins differ by 1% of system size

R_SUN_AU = 0.00465047
R_EARTH_AU = 4.26352e-5
R_JUP_AU = 4.77895e-4
M_EARTH = 3.00349e-6

PALETTE = ["#ffd166", "#4cc9f0", "#f72585", "#90be6d", "#f8961e",
           "#b5179e", "#43aa8b", "#f94144", "#577590", "#e9c46a"]


def default_radius(m: float) -> float:
    """Rough physical radius in AU, only used for collisions and drawing."""
    if m <= 0:
        return 0.0
    if m >= 0.08:                       # stars: R ~ M^0.8
        return R_SUN_AU * m ** 0.8
    if m < 10 * M_EARTH:                # rocky planets: constant density
        return R_EARTH_AU * (m / M_EARTH) ** (1 / 3)
    return R_JUP_AU                     # gas giants and brown dwarfs are all about Jupiter sized


def _make_forces(p: GravityParams):
    """Returns a REBOUND additional_forces callback, or None for pure Newtonian runs."""
    delayed = p.gravity_speed == "delayed_naive"
    if p.mond:
        raise EngineError("MOND is not built yet; it is planned as a theory card.")
    if not (delayed or p.gr_1pn or p.gw_radiation):
        return None
    if len(p.bodies) > MAX_FORCE_BODIES:
        raise EngineError(f"Delayed or relativistic gravity supports at most {MAX_FORCE_BODIES} bodies.")

    G = 4 * math.pi ** 2 * p.g_scale
    c = C_AU_PER_YR
    c2 = c * c

    def forces(reb_sim):
        sim = reb_sim.contents
        ps = sim.particles
        n = sim.N

        if delayed:
            # sim.gravity is "none", so all gravity is computed here.
            for i in range(n):
                pi_ = ps[i]
                for j in range(n):
                    if i == j:
                        continue
                    pj = ps[j]
                    if pj.m == 0:
                        continue
                    dx, dy, dz = pj.x - pi_.x, pj.y - pi_.y, pj.z - pi_.z
                    r = math.sqrt(dx * dx + dy * dy + dz * dz)
                    if r == 0:
                        continue
                    # direction to the source, aberrated by the receiver's velocity relative to it
                    ux = dx / r + (pi_.vx - pj.vx) / c
                    uy = dy / r + (pi_.vy - pj.vy) / c
                    uz = dz / r + (pi_.vz - pj.vz) / c
                    un = math.sqrt(ux * ux + uy * uy + uz * uz)
                    a = G * pj.m / (r * r) / un
                    pi_.ax += a * ux
                    pi_.ay += a * uy
                    pi_.az += a * uz

        if p.gr_1pn or p.gw_radiation:
            order = sorted(range(n), key=lambda k: ps[k].m, reverse=True)

        if p.gr_1pn and n >= 2:
            k = order[0]
            p0 = ps[k]
            mu = G * p0.m
            for i in range(n):
                if i == k:
                    continue
                pi_ = ps[i]
                rx, ry, rz = pi_.x - p0.x, pi_.y - p0.y, pi_.z - p0.z
                vx, vy, vz = pi_.vx - p0.vx, pi_.vy - p0.vy, pi_.vz - p0.vz
                r = math.sqrt(rx * rx + ry * ry + rz * rz)
                if r == 0:
                    continue
                v2 = vx * vx + vy * vy + vz * vz
                rv = rx * vx + ry * vy + rz * vz
                f = mu / (c2 * r ** 3)
                ax = f * ((4 * mu / r - v2) * rx + 4 * rv * vx)
                ay = f * ((4 * mu / r - v2) * ry + 4 * rv * vy)
                az = f * ((4 * mu / r - v2) * rz + 4 * rv * vz)
                pi_.ax += ax
                pi_.ay += ay
                pi_.az += az
                if p0.m > 0:                       # equal and opposite, keeps momentum
                    s = pi_.m / p0.m
                    p0.ax -= s * ax
                    p0.ay -= s * ay
                    p0.az -= s * az

        if p.gw_radiation and n >= 2:
            p1, p2 = ps[order[0]], ps[order[1]]
            m1, m2 = p1.m, p2.m
            if m1 > 0 and m2 > 0:
                rx, ry, rz = p2.x - p1.x, p2.y - p1.y, p2.z - p1.z
                vx, vy, vz = p2.vx - p1.vx, p2.vy - p1.vy, p2.vz - p1.vz
                r = math.sqrt(rx * rx + ry * ry + rz * rz)
                v2 = vx * vx + vy * vy + vz * vz
                if r > 0 and v2 > 0:
                    M = m1 + m2
                    mu_red = m1 * m2 / M
                    power = 32.0 / 5.0 * G ** 4 * (m1 * m2) ** 2 * M / (c ** 5 * r ** 5)
                    k = -power / (mu_red * v2)        # drag on the relative velocity
                    p2.ax += (m1 / M) * k * vx
                    p2.ay += (m1 / M) * k * vy
                    p2.az += (m1 / M) * k * vz
                    p1.ax -= (m2 / M) * k * vx
                    p1.ay -= (m2 / M) * k * vy
                    p1.az -= (m2 / M) * k * vz

    return forces


def build_simulation(p: GravityParams, perturb: float = 0.0):
    """Returns (sim, forces). Keep a reference to forces while the sim runs."""
    sim = rebound.Simulation()
    sim.G = 4 * math.pi ** 2 * p.g_scale
    sim.integrator = "ias15"
    for i, b in enumerate(p.bodies):
        x, y, z = b.pos_au
        if i == 0 and perturb:
            x += perturb
        vx, vy, vz = b.vel_au_yr
        r = b.radius_au or default_radius(b.mass_msun)
        sim.add(m=b.mass_msun, x=x, y=y, z=z, vx=vx, vy=vy, vz=vz, r=r, hash=b.name)
    sim.move_to_com()
    if p.collisions == "merge":
        sim.collision = "direct"
        sim.collision_resolve = "merge"
    try:
        sim.ri_ias15.min_dt = p.duration_yr * 1e-12   # stops runaway tiny steps in near collisions
    except AttributeError:
        pass
    forces = _make_forces(p)
    if forces is not None:
        if p.gravity_speed == "delayed_naive":
            sim.gravity = "none"
        sim.additional_forces = forces
        sim.force_is_velocity_dependent = 1
    return sim, forces


def _relative_error(now, start):
    now, start = np.asarray(now, dtype=float), np.asarray(start, dtype=float)
    scale = np.linalg.norm(start)
    diff = np.linalg.norm(now - start)
    return float(diff / scale) if scale > 0 else float(diff)


def run_gravity(p: GravityParams) -> dict:
    t_start = time.monotonic()
    names = [b.name for b in p.bodies]
    n_b = len(names)
    idx_by_hash = {rebound.hash(nm).value: i for i, nm in enumerate(names)}

    n_frames = min(p.frames, max(10, MAX_POINTS // n_b))
    times = np.linspace(0.0, p.duration_yr, n_frames)

    sim, forces = build_simulation(p)
    massive = sum(1 for b in p.bodies if b.mass_msun > 0)
    scale = max((math.sqrt(sum(c * c for c in b.pos_au)) for b in p.bodies), default=1.0) or 1.0
    want_horizon = massive >= 3
    shadow = shadow_forces = None
    if want_horizon:
        shadow, shadow_forces = build_simulation(p, perturb=HORIZON_SEED * scale)

    conservative = p.gravity_speed == "instant" and not (p.gr_1pn or p.gw_radiation)
    physics = ["Newtonian gravity" if p.gravity_speed == "instant" else "Gravity at light speed without velocity terms (Laplace)"]
    if p.gr_1pn:
        physics.append("1PN relativistic correction")
    if p.gw_radiation:
        physics.append("Gravitational wave energy loss (Peters 1964)")
    if p.g_scale != 1.0:
        physics.append(f"G scaled by {p.g_scale:g}")

    e0 = sim.energy()
    l0 = sim.angular_momentum()
    max_de = 0.0
    max_dl = 0.0
    positions: list[list] = []
    events: list[dict] = []
    alive_prev = set(range(n_b))
    horizon = None
    truncated = False

    for f, t in enumerate(times):
        if t > 0:
            try:
                sim.integrate(float(t))
            except Exception as exc:
                raise EngineError(f"Integration failed at t = {sim.t:.4g} yr: {exc}") from exc

        frame: list = [None] * n_b
        alive = set()
        for pt in sim.particles:
            i = idx_by_hash.get(pt.hash.value)
            if i is not None:
                frame[i] = [pt.x, pt.y, pt.z]
                alive.add(i)

        lost = alive_prev - alive
        if lost:
            prev = positions[-1] if positions else frame
            for i in sorted(lost):
                into = None
                if prev[i] is not None and alive:
                    into = min(alive, key=lambda k: sum((a - b) ** 2 for a, b in zip(frame[k], prev[i])))
                events.append({"t_yr": float(t), "type": "merge", "body": names[i],
                               "into": names[into] if into is not None else None})
            e0 = sim.energy()            # merges are inelastic, so restart the error baseline
            l0 = sim.angular_momentum()
        else:
            e = sim.energy()
            max_de = max(max_de, abs((e - e0) / e0) if e0 != 0 else abs(e - e0))
            max_dl = max(max_dl, _relative_error(sim.angular_momentum(), l0))
        alive_prev = alive
        positions.append(frame)

        if want_horizon and horizon is None and t > 0:
            try:
                shadow.integrate(float(t))
                twin = {idx_by_hash.get(pt.hash.value): (pt.x, pt.y, pt.z) for pt in shadow.particles}
                if set(twin) - {None} != alive:
                    horizon = float(t)
                else:
                    div = max(math.dist(frame[i], twin[i]) for i in alive)
                    if div > HORIZON_LIMIT * scale:
                        horizon = float(t)
            except Exception:
                want_horizon = False   # the shadow run is optional, never fail the main run on it

        if time.monotonic() - t_start > WALL_LIMIT_S:
            truncated = True
            times = times[: f + 1]
            break

    def f32(v):
        return None if v is None else [float(np.float32(c)) for c in v]

    bodies_out = []
    for i, b in enumerate(p.bodies):
        bodies_out.append({
            "id": i, "name": b.name, "mass_msun": b.mass_msun,
            "radius_au": b.radius_au or default_radius(b.mass_msun),
            "color": b.color or PALETTE[i % len(PALETTE)],
        })

    del forces, shadow_forces   # callbacks no longer needed

    return {
        "engine": "gravity",
        "units": {"length": "AU", "time": "yr", "mass": "Msun"},
        "bodies": bodies_out,
        "times": [float(t) for t in times],
        "positions": [[f32(v) for v in fr] for fr in positions],
        "events": events,
        "diagnostics": {
            "integrator": "IAS15 (REBOUND)",
            "physics": physics,
            "conservative": conservative,
            "energy_error_rel": max_de,
            "angular_momentum_error_rel": max_dl,
            "prediction_horizon_yr": horizon,
            "horizon_checked": massive >= 3,
            "horizon_definition": "time for a 1 part in a billion error in starting positions to grow to 1% of the system size",
            "truncated": truncated,
            "frames": len(positions),
            "wall_time_s": round(time.monotonic() - t_start, 3),
        },
    }
