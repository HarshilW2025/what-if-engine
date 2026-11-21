"""wie: the What If Engine model toolkit.

Claude-written models import this inside the sandbox. It gives SI constants, an accurate ODE helper,
and the Scene builder whose output every renderer understands. Coordinates are physics style: z is up.
"""
from __future__ import annotations

import math
import re

import numpy as np

# ---- SI constants (CODATA 2018, IAU) ----
G = 6.67430e-11
c = 299_792_458.0
h = 6.62607015e-34
hbar = h / (2 * math.pi)
k_B = 1.380649e-23
sigma_SB = 5.670374419e-8
e_charge = 1.602176634e-19
eps0 = 8.8541878128e-12
m_e = 9.1093837015e-31
m_p = 1.67262192369e-27
g0 = 9.80665
AU = 1.495978707e11
ly = 9.4607304725808e15
pc = 3.0856775814913673e16
day = 86400.0
year = 365.25 * day
M_sun = 1.98847e30
R_sun = 6.957e8
L_sun = 3.828e26
M_earth = 5.9722e24
R_earth = 6.371e6
M_moon = 7.342e22
R_moon = 1.7374e6
a_moon = 3.844e8
M_jupiter = 1.89813e27
R_jupiter = 6.9911e7
H0 = 67.4e3 / (1e6 * pc)  # Hubble constant in 1/s (Planck 2018)
T_cmb = 2.7255

MAX_FRAMES = 400
MAX_BODIES = 40
MAX_CURVES = 64
MAX_CLOUDS = 8
MAX_POINT_NUMBERS = 450_000
KINDS = ("star", "planet", "earth", "moon", "rock", "blackhole", "ship", "particle", "light", "generic")
VIEWS = ("free", "top", "side")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

_scenes: list["Scene"] = []


def solve(f, y0, t, rtol=1e-10, atol=1e-12, method="DOP853"):
    """Integrate dy/dt = f(t, y) and return y at every time in t, shape (len(t), len(y0))."""
    from scipy.integrate import solve_ivp

    t = np.asarray(t, dtype=float)
    sol = solve_ivp(f, (t[0], t[-1]), np.asarray(y0, dtype=float), t_eval=t, rtol=rtol, atol=atol, method=method)
    if not sol.success:
        raise RuntimeError(f"ODE solver failed: {sol.message}")
    return sol.y.T


def lorentz(v):
    """Lorentz factor for speed v in m/s."""
    v = np.asarray(v, dtype=float)
    return 1.0 / np.sqrt(1.0 - (v / c) ** 2)


def _q(a):
    """6 significant figures, non-finite -> None, nested lists."""
    a = np.asarray(a, dtype=float)
    flat = [float(f"{x:.6g}") if math.isfinite(x) else None for x in a.ravel().tolist()]
    if a.ndim == 0:
        return flat[0]
    return np.array(flat, dtype=object).reshape(a.shape).tolist()


def _color(col):
    if col is None:
        return None
    if not isinstance(col, str) or not _HEX.match(col):
        raise ValueError(f"color must look like '#ff8800', got {col!r}")
    return col


class Scene:
    """Everything the renderer draws. One value per frame wherever something changes over time."""

    def __init__(self, times, time_unit="s", length_unit="m"):
        t = np.asarray(times, dtype=float).ravel()
        if not 2 <= t.size <= MAX_FRAMES:
            raise ValueError(f"times must have 2 to {MAX_FRAMES} entries, got {t.size}")
        if not np.all(np.isfinite(t)) or np.any(np.diff(t) <= 0):
            raise ValueError("times must be finite and strictly increasing. Build one clock with np.linspace or np.arange and interpolate any other clock (proper time, distant time) onto it with np.interp")
        self.t = t
        self.F = t.size
        self.time_unit = str(time_unit)[:20]
        self.length_unit = str(length_unit)[:20]
        self._bodies: list[dict] = []
        self._curves: list[dict] = []
        self._clouds: list[dict] = []
        self._captions: list[dict] = []
        self._series: list[dict] = []
        self._numbers: list[dict] = []
        self._checks: list[dict] = []
        self._camera = {"focus": None, "view": "free"}
        _scenes.append(self)

    def _frames(self, x, name, tail):
        a = np.asarray(x, dtype=float)
        if a.shape == tail:
            a = np.broadcast_to(a, (self.F, *tail))
        if a.shape != (self.F, *tail):
            raise ValueError(f"{name}: expected shape {tail} (constant) or {(self.F, *tail)} (one per frame), got {a.shape}")
        if np.isinf(a).any():
            raise ValueError(f"{name} contains infinity")
        return a

    def body(self, name, positions, radius, kind="generic", color=None, temperature=None, scale=None, spin=0.0, disk=False):
        """A solid object. positions (3,) or (F,3), NaN rows = not present. radius () or (F,).
        temperature in K () or (F,). scale (3,) or (F,3) stretches the shape. spin in radians per time unit."""
        name = str(name)[:40]
        if any(b["name"] == name for b in self._bodies):
            raise ValueError(f"duplicate body name {name!r}")
        if len(self._bodies) >= MAX_BODIES:
            raise ValueError(f"at most {MAX_BODIES} bodies")
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {KINDS}, got {kind!r}")
        b = {
            "name": name,
            "kind": kind,
            "color": _color(color),
            "positions": self._frames(positions, f"{name} positions", (3,)),
            "radius": self._frames(radius, f"{name} radius", ()),
            "spin": float(spin),
            "disk": bool(disk),
        }
        if np.any(b["radius"] < 0):
            raise ValueError(f"{name} radius must be >= 0")
        if temperature is not None:
            b["temperature"] = self._frames(temperature, f"{name} temperature", ())
        if scale is not None:
            b["scale"] = self._frames(scale, f"{name} scale", (3,))
        self._bodies.append(b)
        return self

    def curve(self, name, points, color=None, width=1.0):
        """A line: (P,3) fixed, or (F,P,3) changing each frame. Wavefunctions, light paths, spacetime grids."""
        if len(self._curves) >= MAX_CURVES:
            raise ValueError(f"at most {MAX_CURVES} curves")
        a = np.asarray(points, dtype=float)
        static = a.ndim == 2
        if static:
            ok = a.shape[1] == 3 and a.shape[0] >= 2
        else:
            ok = a.ndim == 3 and a.shape[0] == self.F and a.shape[2] == 3 and a.shape[1] >= 2
        if not ok or np.isinf(a).any():
            raise ValueError(f"curve {name}: expected (P,3) or ({self.F},P,3) with P >= 2 and no infinity, got {a.shape}")
        self._curves.append({"name": str(name)[:40], "color": _color(color), "width": float(width), "static": static, "points": a})
        return self

    def cloud(self, name, points, color=None, size=1.0, temperature=None):
        """Many particles (debris, gas, photons): (F,N,3). temperature in K: () or (F,) for the whole cloud,
        (N,) or (F,N) for each particle."""
        if len(self._clouds) >= MAX_CLOUDS:
            raise ValueError(f"at most {MAX_CLOUDS} clouds")
        a = np.asarray(points, dtype=float)
        if a.ndim != 3 or a.shape[0] != self.F or a.shape[2] != 3 or np.isinf(a).any():
            raise ValueError(f"cloud {name}: expected ({self.F},N,3) with no infinity, got {a.shape}")
        c_ = {"name": str(name)[:40], "color": _color(color), "size": float(size), "points": a}
        if temperature is not None:
            T = np.asarray(temperature, dtype=float)
            N = a.shape[1]
            if T.shape in ((), (self.F,)):
                c_["temperature"] = self._frames(T, f"cloud {name} temperature", ())
            elif T.shape in ((N,), (self.F, N)):
                c_["temperature_each"] = self._frames(T, f"cloud {name} temperature", (N,))
            else:
                raise ValueError(f"cloud {name} temperature: expected (), ({self.F},), ({N},) or ({self.F},{N}), got {T.shape}")
        self._clouds.append(c_)
        return self

    def caption(self, t, text):
        t = float(t)
        t = float(min(max(float(t), float(self.t[0])), float(self.t[-1])))  # forgiving: a caption just outside the run is pulled to the nearest end
        self._captions.append({"t": t, "text": str(text)[:220]})
        return self

    def series(self, name, values, unit=""):
        """A quantity over time, drawn as a live chart. values () or (F,)."""
        self._series.append({"name": str(name)[:40], "unit": str(unit)[:20], "values": self._frames(values, f"series {name}", ())})
        return self

    def number(self, name, value, unit="", note=""):
        v = float(value)
        if not math.isfinite(v):
            raise ValueError(f"number {name} is not finite")
        self._numbers.append({"name": str(name)[:60], "value": v, "unit": str(unit)[:20], "note": str(note)[:160]})
        return self

    def check(self, name, value, expected, rtol=1e-6, atol=0.0):
        """Compare a computed value with an independent expectation (analytic formula, conservation law)."""
        v, e = float(value), float(expected)
        passed = math.isfinite(v) and math.isfinite(e) and abs(v - e) <= atol + rtol * abs(e)
        self._checks.append({"name": str(name)[:80], "value": v, "expected": e, "rtol": float(rtol), "atol": float(atol), "passed": bool(passed)})
        return self

    def answer(self, text):
        """The plain-language answer to the question: 2 to 4 sentences, numbers inserted from your computed values."""
        self._answer = str(text)[:900]
        return self

    def explain(self, text):
        """The detailed explanation: laws and theories by name, key equations, the calculation step by step, proper terms."""
        self._explanation = str(text)[:5000]
        return self

    def on_earth(self, name, values, unit="", today=None):
        """What people on Earth would feel or see over time, values () or (F,). today is the real present day value."""
        if not hasattr(self, "_earth"):
            self._earth = []
        if len(self._earth) >= 4:
            return self  # forgiving: the panel shows four
        td = None if today is None else float(today)
        if td is not None and not math.isfinite(td):
            td = None
        self._earth.append({"name": str(name)[:40], "unit": str(unit)[:20], "values": self._frames(values, f"on_earth {name}", ()), "today": td})
        return self

    def earth_event(self, t, text):
        """A moment in what people on Earth experience, in plain words with computed numbers."""
        if not hasattr(self, "_earth_events"):
            self._earth_events = []
        t = float(min(max(float(t), float(self.t[0])), float(self.t[-1])))
        self._earth_events.append({"t": t, "text": str(text)[:160]})
        return self

    def _earth_out(self):
        se, ev = getattr(self, "_earth", []), getattr(self, "_earth_events", [])
        if not se and not ev:
            return None
        return {"series": [{**s, "values": _q(s["values"])} for s in se], "events": sorted(ev, key=lambda x: x["t"])[:8], "note": ""}

    def change(self, t, text):
        """The moment the what if happens. Everything before it shows today's unchanged reality."""
        t = float(min(max(float(t), float(self.t[0])), float(self.t[-1])))
        self._change = {"t": t, "label": str(text)[:120]}
        return self

    def camera(self, focus=None, view="free"):
        if view not in VIEWS:
            raise ValueError(f"view must be one of {VIEWS}")
        self._camera = {"focus": None if focus is None else str(focus), "view": view}
        return self

    def to_dict(self):
        if not (self._bodies or self._curves or self._clouds):
            raise ValueError("the scene is empty: add at least one body, curve or cloud")
        def total():
            return sum(c_["points"].size for c_ in self._curves) + sum(c_["points"].size + c_.get("temperature_each", np.empty(0)).size for c_ in self._clouds)

        thinned = 1
        if total() > MAX_POINT_NUMBERS:  # keep every k-th particle and curve point rather than fail
            thinned = int(math.ceil(total() / MAX_POINT_NUMBERS))
            for c_ in self._clouds:
                c_["points"] = c_["points"][:, ::thinned]
                if "temperature_each" in c_:
                    c_["temperature_each"] = c_["temperature_each"][:, ::thinned]
            for c_ in self._curves:
                if c_["points"].shape[-2] // thinned >= 2:
                    c_["points"] = c_["points"][..., ::thinned, :]
        if total() > MAX_POINT_NUMBERS:
            raise ValueError(f"curves and clouds hold {total()} numbers, the limit is {MAX_POINT_NUMBERS}; use fewer frames")
        focus = self._camera["focus"]
        if focus is not None and focus not in [b["name"] for b in self._bodies]:
            self._camera = {**self._camera, "focus": None}  # forgiving: an unknown focus falls back to the whole scene

        def body_out(b):
            out = {"name": b["name"], "kind": b["kind"], "color": b["color"], "spin": b["spin"], "disk": b["disk"], "positions": _q(b["positions"]), "radius": _q(b["radius"])}
            if "temperature" in b:
                out["temperature"] = _q(b["temperature"])
            if "scale" in b:
                out["scale"] = _q(b["scale"])
            return out

        return {
            "time_unit": self.time_unit,
            "length_unit": self.length_unit,
            "times": _q(self.t),
            "bodies": [body_out(b) for b in self._bodies],
            "curves": [{k: (_q(v) if k == "points" else v) for k, v in c_.items()} for c_ in self._curves],
            "clouds": [{k: (_q(v) if k in ("points", "temperature", "temperature_each") else v) for k, v in c_.items()} for c_ in self._clouds],
            "thinned": thinned,
            "captions": sorted(self._captions, key=lambda x: x["t"]),
            "series": [{**s, "values": _q(s["values"])} for s in self._series],
            "numbers": self._numbers,
            "checks": self._checks,
            "camera": self._camera,
            "answer": getattr(self, "_answer", ""),
            "explanation": getattr(self, "_explanation", ""),
            "change": getattr(self, "_change", None),
            "earth": self._earth_out(),
        }


# =====================================================================================
# Tested physics helpers. Each one is benchmarked in tests/test_physics_helpers.py.
# Models should prefer these over re-deriving the maths: they are faster and verified.
# =====================================================================================

KM_S_MPC_PER_GYR = 1e3 / (1e6 * pc) * (1e9 * year)  # 1 km/s/Mpc expressed in 1/Gyr


# ---------- special relativity ----------
def cruise(distance_m, v):
    """Coasting trip at constant speed v (m/s). Returns times in seconds and the energy per kg."""
    g = float(lorentz(v))
    t_earth = distance_m / v
    return {
        "gamma": g,
        "t_earth_s": t_earth,
        "t_ship_s": t_earth / g,
        "distance_ship_frame_m": distance_m / g,
        "kinetic_energy_per_kg_J": (g - 1.0) * c**2,
    }


def rocket(distance_m, accel=g0, flip=True, n=200):
    """Constant proper acceleration trip (hyperbolic motion). flip=True accelerates for the first half
    and decelerates for the second, arriving at rest. Returns totals plus arrays sampled in ship (proper) time:
    tau_s, t_s (Earth time), x_m (distance covered), v (m/s), gamma."""
    a = float(accel)
    half = distance_m / 2.0 if flip else distance_m
    tau_leg = c / a * np.arccosh(1.0 + a * half / c**2)
    tau_total = 2 * tau_leg if flip else tau_leg
    tau = np.linspace(0.0, tau_total, int(n))
    s = np.minimum(tau, tau_total - tau) if flip else tau  # proper time from the nearest standstill
    x_leg = c**2 / a * (np.cosh(a * s / c) - 1.0)
    t_leg = c / a * np.sinh(a * s / c)
    t_half = c / a * np.sinh(a * tau_leg / c)
    if flip:
        second = tau > tau_leg
        x = np.where(second, distance_m - x_leg, x_leg)
        t = np.where(second, 2 * t_half - t_leg, t_leg)
    else:
        x, t = x_leg, t_leg
    v = c * np.tanh(a * s / c)
    return {
        "tau_total_s": float(tau_total),
        "t_total_s": float(2 * t_half if flip else t_half),
        "v_max": float(c * np.tanh(a * tau_leg / c)),
        "gamma_max": float(np.cosh(a * tau_leg / c)),
        "tau_s": tau, "t_s": t, "x_m": x, "v": v, "gamma": np.cosh(a * s / c),
    }


def doppler_factor(v, theta_obs):
    """Frequency ratio f_seen / f_emitted for a moving observer looking at a source at angle theta_obs
    (radians, in the observer's frame, 0 = straight ahead)."""
    b = np.asarray(v, dtype=float) / c
    return 1.0 / (lorentz(v) * (1.0 - b * np.cos(theta_obs)))


def aberration(theta_rest, v):
    """Apparent angle (observer frame) of light that arrives at angle theta_rest in the rest frame."""
    b = float(v) / c
    ct = np.cos(theta_rest)
    return np.arccos((ct + b) / (1.0 + b * ct))


# ---------- cosmology ----------
def _de_density(a, w0, wa):
    return a ** (-3.0 * (1.0 + w0 + wa)) * np.exp(-3.0 * wa * (1.0 - a))


def hubble(a, h0=67.4, omega_m=0.315, omega_r=9e-5, omega_de=0.685, w0=-1.0, wa=0.0):
    """H(a) in km/s/Mpc for a CPL dark energy universe (curvature fills the gap to 1)."""
    a = np.asarray(a, dtype=float)
    ok = 1.0 - omega_m - omega_r - omega_de
    e2 = omega_r * a**-4 + omega_m * a**-3 + ok * a**-2 + omega_de * _de_density(a, w0, wa)
    return h0 * np.sqrt(np.maximum(e2, 0.0))


def friedmann(h0=67.4, omega_m=0.315, omega_r=9e-5, omega_de=0.685, w0=-1.0, wa=0.0, t_future_gyr=100.0, n=300):
    """Expansion history and fate. Integrates the acceleration equation from today (a = 1) forward,
    and gets the age by integrating back to the Big Bang. Returns age_gyr, fate ('expands forever',
    'big crunch', 'big rip'), t_end_gyr (time since the Big Bang of a crunch or rip, else None),
    and arrays t_gyr (since the Big Bang), a, H_kms_mpc, from a = 0.001 to the end."""
    from scipy.integrate import quad, solve_ivp

    H0 = h0 * KM_S_MPC_PER_GYR
    ok = 1.0 - omega_m - omega_r - omega_de

    def E2(a):
        return omega_r * a**-4 + omega_m * a**-3 + ok * a**-2 + omega_de * _de_density(a, w0, wa)

    def addot(t, y):
        a, ad = y
        w = w0 + wa * (1.0 - a)
        acc = -0.5 * H0**2 * a * (2 * omega_r * a**-4 + omega_m * a**-3 + omega_de * _de_density(a, w0, wa) * (1 + 3 * w))
        return [ad, acc]

    age = quad(lambda a: 1.0 / (a * H0 * np.sqrt(E2(a))), 0.0, 1.0, limit=200)[0]
    t_past = age - quad(lambda a: 1.0 / (a * H0 * np.sqrt(E2(a))), 0.0, 1e-3, limit=200)[0]

    crunch = lambda t, y: y[0] - 1e-3
    crunch.terminal, crunch.direction = True, -1
    rip = lambda t, y: y[0] - 1e8
    rip.terminal, rip.direction = True, 1
    fwd = solve_ivp(addot, (0.0, t_future_gyr), [1.0, H0], events=[crunch, rip], rtol=1e-10, atol=1e-12, dense_output=True)
    fate, t_end = "expands forever", None
    if fwd.t_events[0].size:
        fate, t_end = "big crunch", age + float(fwd.t_events[0][0])
    elif fwd.t_events[1].size:
        fate, t_end = "big rip", age + float(fwd.t_events[1][0])

    back = solve_ivp(addot, (0.0, -t_past), [1.0, H0], rtol=1e-10, atol=1e-12, dense_output=True)
    t_rel = np.linspace(-t_past, fwd.t[-1], int(n))
    a_arr = np.where(t_rel < 0, back.sol(np.minimum(t_rel, 0.0))[0], fwd.sol(np.maximum(t_rel, 0.0))[0])
    ad_arr = np.where(t_rel < 0, back.sol(np.minimum(t_rel, 0.0))[1], fwd.sol(np.maximum(t_rel, 0.0))[1])
    return {
        "age_gyr": float(age), "fate": fate, "t_end_gyr": t_end,
        "t_gyr": t_rel + age, "a": a_arr, "H_kms_mpc": ad_arr / a_arr / KM_S_MPC_PER_GYR,
    }


# ---------- quantum mechanics ----------
def gaussian_packet(x, x0, sigma, k0):
    """Normalised Gaussian wave packet centred at x0 with width sigma and mean wavenumber k0."""
    x = np.asarray(x, dtype=float)
    psi = np.exp(-((x - x0) ** 2) / (4 * sigma**2) + 1j * k0 * x)
    return psi / np.sqrt(np.trapezoid(np.abs(psi) ** 2, x))


def schrodinger_1d(x, psi0, V, t, mass=1.0, hbar_=1.0, absorb=0.0, max_steps=40000):
    """Split-step Fourier solution of the 1D Schrodinger equation (any consistent units; default hbar = m = 1).
    x uniform grid, psi0 complex (N,), V real (N,) or callable V(x, t), t output times (F,).
    absorb: fraction of the grid at each edge with a soft absorbing mask (0 = periodic box).
    Returns psi with shape (F, N)."""
    x = np.asarray(x, dtype=float)
    t = np.asarray(t, dtype=float)
    N = x.size
    dx = x[1] - x[0]
    k = 2 * np.pi * np.fft.fftfreq(N, dx)
    dt_max = 0.1 * mass * dx**2 / hbar_
    total = int(np.sum(np.ceil(np.diff(t) / dt_max)))
    if total > max_steps:
        raise ValueError(f"schrodinger_1d would need {total} steps; use fewer grid points, a wider dx or a shorter time span")
    mask = np.ones(N)
    if absorb > 0:
        m = int(absorb * N)
        edge = np.cos(np.linspace(0, np.pi / 2, m)) ** 0.125
        mask[:m] = edge[::-1]
        mask[-m:] = edge
    psi = np.asarray(psi0, dtype=complex).copy()
    out = np.empty((t.size, N), dtype=complex)
    out[0] = psi
    for i in range(1, t.size):
        steps = max(1, int(np.ceil((t[i] - t[i - 1]) / dt_max)))
        dt = (t[i] - t[i - 1]) / steps
        kin = np.exp(-1j * hbar_ * k**2 * dt / (2 * mass))
        for s in range(steps):
            tt = t[i - 1] + s * dt
            Vx = V(x, tt) if callable(V) else V
            half = np.exp(-1j * np.asarray(Vx, dtype=float) * dt / (2 * hbar_))
            psi = half * np.fft.ifft(kin * np.fft.fft(half * psi))
            if absorb > 0:
                psi *= mask
        out[i] = psi
    return out


def double_slit_intensity(y, wavelength, slit_separation, slit_width, screen_distance):
    """Fraunhofer two-slit pattern on a screen, normalised to 1 at the centre."""
    s = np.asarray(y, dtype=float) / np.sqrt(np.asarray(y, dtype=float) ** 2 + screen_distance**2)
    beta = np.pi * slit_width * s / wavelength
    return np.cos(np.pi * slit_separation * s / wavelength) ** 2 * np.sinc(beta / np.pi) ** 2


# ---------- black holes ----------
def black_hole(mass_kg, spin=0.0):
    """Key numbers for a black hole of mass_kg and dimensionless spin (0 to 0.998).
    Radii in m, temperature in K, times in s (and years where noted)."""
    M = float(mass_kg)
    rg = G * M / c**2
    a = float(spin)
    z1 = 1 + (1 - a * a) ** (1 / 3) * ((1 + a) ** (1 / 3) + (1 - a) ** (1 / 3))
    z2 = np.sqrt(3 * a * a + z1 * z1)
    isco = rg * (3 + z2 - np.sqrt((3 - z1) * (3 + z1 + 2 * z2)))
    t_evap = 5120 * np.pi * G**2 * M**3 / (hbar * c**4)
    return {
        "r_s_m": 2 * rg,
        "r_horizon_m": rg * (1 + np.sqrt(1 - a * a)),
        "r_photon_sphere_m": 3 * rg,
        "shadow_radius_m": 3 * np.sqrt(3) * rg,
        "r_isco_m": float(isco),
        "hawking_temperature_K": hbar * c**3 / (8 * np.pi * G * M * k_B),
        "evaporation_time_s": t_evap,
        "evaporation_time_years": t_evap / year,
        "max_time_horizon_to_singularity_s": np.pi * G * M / c**3,
    }


def tidal_acceleration(mass_kg, r_m, length_m=2.0):
    """Head to toe stretching acceleration (m/s^2) across length_m at distance r_m (Newtonian, radial)."""
    return 2 * G * mass_kg * length_m / np.asarray(r_m, dtype=float) ** 3


def infall(mass_kg, r0_m, n=300):
    """Radial fall from rest at r0 into a Schwarzschild black hole (exact geodesic, cycloid form).
    Returns arrays sampled to the singularity: tau_s (faller's clock), t_s (distant clock; NaN once inside,
    since it never sees the crossing), r_m, v_local (speed measured by a hovering observer, NaN inside),
    plus tau_to_horizon_s and tau_to_singularity_s."""
    M = G * mass_kg / c**2
    rs = 2 * M
    r0 = float(r0_m)
    if r0 <= rs:
        raise ValueError("r0 must be outside the horizon")
    eta = np.linspace(0.0, np.pi, int(n))
    r = 0.5 * r0 * (1 + np.cos(eta))
    tau = np.sqrt(r0**3 / (8 * M)) * (eta + np.sin(eta)) / c
    q = np.sqrt(r0 / rs - 1)
    th = np.tan(eta / 2)
    with np.errstate(divide="ignore", invalid="ignore"):
        tt = rs * (np.log(np.abs((q + th) / (q - th))) + q * (eta + r0 / (2 * rs) * (eta + np.sin(eta)))) / c
        v = c * np.sqrt((rs / r - rs / r0) / (1 - rs / r0))
    outside = r > rs
    eta_h = 2 * np.arctan(q)
    return {
        "tau_s": tau, "t_s": np.where(outside, tt, np.nan), "r_m": r, "v_local": np.where(outside, v, np.nan),
        "tau_to_horizon_s": float(np.sqrt(r0**3 / (8 * M)) * (eta_h + np.sin(eta_h)) / c),
        "tau_to_singularity_s": float(np.pi * np.sqrt(r0**3 / (8 * M)) / c),
    }


def passages(t, r, merge_radius=None):
    """Close passes of two bodies from their separation r(t): real pericentres (jitter filtered out),
    apocentres, merger time, and whether the run ended too early. Works for stars, black holes, galaxies.
    Returns peri_t, peri_r, apo_t, apo_r (lists), first_pass_t, first_pass_r, first_pass_kind
    ("pericentre", "plunge" or None), closest_t, closest_r, merge_t (r stays below merge_radius to the end, else None),
    run_too_short (still approaching at the last step with no merger)."""
    t = np.asarray(t, dtype=float).ravel()
    r = np.asarray(r, dtype=float).ravel()
    if t.shape != r.shape or t.size < 3:
        raise ValueError("passages: t and r must be 1-D arrays of the same length, at least 3")
    ok = np.isfinite(r) & np.isfinite(t)
    t, r = t[ok], r[ok]
    if t.size < 3:
        raise ValueError("passages: fewer than 3 finite samples")
    d = np.sign(np.diff(r))
    for k in range(1, d.size):
        if d[k] == 0:
            d[k] = d[k - 1]
    mins = [k for k in range(1, d.size) if d[k - 1] < 0 and d[k] > 0]
    maxs = [k for k in range(1, d.size) if d[k - 1] > 0 and d[k] < 0]
    merge_t = None
    if merge_radius is not None and r[-1] <= merge_radius:
        above = np.where(r > merge_radius)[0]
        merge_t = float(t[above[-1] + 1]) if above.size else float(t[0])
    peri = []
    for j, k in enumerate(mins):  # keep only real minima: at least 2% below the peaks on both sides
        lo = peri[-1] if peri else 0
        hi = mins[j + 1] if j + 1 < len(mins) else r.size - 1
        left, right = r[lo:k + 1].max(), r[k:hi + 1].max()
        if r[k] < 0.98 * min(left, right) and (merge_t is None or t[k] < merge_t):
            peri.append(k)
    apo = [k for k in maxs if (not peri or k > peri[0]) and (merge_t is None or t[k] < merge_t)]
    ic = int(np.argmin(r))
    if peri:
        first_t, first_r, kind = float(t[peri[0]]), float(r[peri[0]]), "pericentre"
    elif merge_t is not None:
        first_t, first_r, kind = merge_t, float(r[np.searchsorted(t, merge_t)]), "plunge"
    else:
        first_t, first_r, kind = None, None, None
    return {
        "peri_t": [float(t[k]) for k in peri], "peri_r": [float(r[k]) for k in peri],
        "apo_t": [float(t[k]) for k in apo], "apo_r": [float(r[k]) for k in apo],
        "first_pass_t": first_t, "first_pass_r": first_r, "first_pass_kind": kind,
        "closest_t": float(t[ic]), "closest_r": float(r[ic]), "merge_t": merge_t,
        "run_too_short": bool(ic == r.size - 1 and d[-1] < 0 and merge_t is None),
    }


# ---------- atmospheric entry (Collins, Melosh and Marcus 2005, Earth Impact Effects Program) ----------
ENTRY_ATMOSPHERES = {  # surface density kg/m^3, scale height m, radius m, surface gravity m/s^2
    "earth": (1.225, 8000.0, 6.371e6, 9.81),
    "mars": (0.020, 11100.0, 3.3895e6, 3.71),
    "venus": (65.0, 15900.0, 6.0518e6, 8.87),
    "titan": (5.3, 21000.0, 2.5747e6, 1.352),
}


def entry(diameter_m, velocity_kms, angle_deg=45.0, density=3000.0, planet="earth", strength_pa=None,
          drag_coeff=2.0, spread_factor=7.0, n=300):
    """Atmospheric entry of an asteroid or meteor: drag, gravity, curved flight path, breakup when air pressure
    exceeds the body's strength, then pancake spreading until it bursts. Benchmarked on Chelyabinsk and Tunguska.
    angle_deg is from the horizontal. planet is earth, mars, venus or titan, or a tuple
    (surface density kg/m^3, scale height m, radius m, gravity m/s^2).
    Returns outcome ("airburst", "ground impact" or "skips back to space"), arrays t_s, alt_km, speed_kms, size_m,
    ke_mt (kinetic energy left, megatons TNT), deposit_mt_per_km, and breakup_alt_km, burst_alt_km,
    impact_speed_kms, energy_mt, air_energy_mt, impact_energy_mt, peak_deposit_alt_km, strength_pa."""
    rho0, H, R, g0 = ENTRY_ATMOSPHERES[planet.lower()] if isinstance(planet, str) else planet
    L0 = float(diameter_m)
    rho_i = float(density)
    Y = float(strength_pa) if strength_pa is not None else 10 ** (2.107 + 0.0624 * math.sqrt(rho_i))
    m = rho_i * math.pi * L0**3 / 6
    z_top = 12 * H
    MT = 4.184e15

    def deriv(s, broken):
        v, th, z, L, dL = s
        rho_a = rho0 * math.exp(-max(z, 0.0) / H)
        g = g0 * (R / (R + z)) ** 2
        A = math.pi * L * L / 4
        dv = -drag_coeff * rho_a * A * v * v / (2 * m) + g * math.sin(th)
        dth = g * math.cos(th) / v - v * math.cos(th) / (R + z)
        dz = -v * math.sin(th)
        ddL = drag_coeff * rho_a * v * v / (rho_i * L) if broken else 0.0
        return np.array([dv, dth, dz, dL if broken else 0.0, ddL])

    s = np.array([velocity_kms * 1000.0, math.radians(angle_deg), z_top, L0, 0.0])
    t, broken = 0.0, False
    T, S = [0.0], [s.copy()]
    breakup_z = burst_z = None
    outcome = None
    while True:
        v, th, z, L, dL = s
        dt = min(0.002 * H / max(v * abs(math.sin(th)), 1.0), 0.05)
        if broken:
            dt = min(dt, 0.05 * L / max(abs(dL), 1e-9))
        k1 = deriv(s, broken)
        k2 = deriv(s + 0.5 * dt * k1, broken)
        k3 = deriv(s + 0.5 * dt * k2, broken)
        k4 = deriv(s + dt * k3, broken)
        s = s + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        t += dt
        v, th, z, L, dL = s
        rho_a = rho0 * math.exp(-max(z, 0.0) / H)
        if not broken and rho_a * v * v >= Y:
            broken, breakup_z = True, z
        if broken and L >= spread_factor * L0 and z > 0:
            burst_z, outcome = z, "airburst"
        if z <= 0:
            outcome = outcome or "ground impact"
            s[2] = 0.0
        if z > z_top * 1.01:
            outcome = "skips back to space"
        T.append(t)
        S.append(s.copy())
        if outcome or v < 1.0 or t > 3600:
            outcome = outcome or "ground impact"
            break
    T = np.array(T)
    S = np.array(S)
    ke = 0.5 * m * S[:, 0] ** 2 / MT
    grid = np.linspace(0, T[-1], n)
    alt = np.interp(grid, T, S[:, 2]) / 1000
    spd = np.interp(grid, T, S[:, 0]) / 1000
    size = np.interp(grid, T, S[:, 3])
    kei = np.interp(grid, T, ke)
    dz = -np.diff(alt)
    dep = np.concatenate([[0.0], np.where(dz > 1e-3, np.maximum(-np.diff(kei), 0.0) / np.maximum(dz, 1e-3), 0.0)])
    e0 = float(ke[0])
    ground = outcome == "ground impact"
    air = max(e0 - float(ke[-1]), 0.0) if ground else e0
    peak = float(alt[int(np.argmax(dep))]) if dep.max() > 0 and (not ground or air > 0.01 * e0) else None
    return {
        "outcome": outcome, "t_s": grid, "alt_km": alt, "speed_kms": spd, "size_m": size, "ke_mt": kei,
        "deposit_mt_per_km": dep,
        "breakup_alt_km": None if breakup_z is None else breakup_z / 1000,
        "burst_alt_km": None if burst_z is None else burst_z / 1000,
        "impact_speed_kms": float(S[-1, 0] / 1000) if ground else None,
        "energy_mt": e0, "air_energy_mt": air, "impact_energy_mt": float(ke[-1]) if ground else 0.0,
        "peak_deposit_alt_km": peak, "strength_pa": Y,
    }
