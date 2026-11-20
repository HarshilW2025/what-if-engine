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
MAX_CURVES = 24
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
            raise ValueError("times must be finite and strictly increasing")
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

    def body(self, name, positions, radius, kind="generic", color=None, temperature=None, scale=None, spin=0.0):
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
        """Many particles (debris, gas, photons): (F,N,3). temperature in K () or (F,)."""
        if len(self._clouds) >= MAX_CLOUDS:
            raise ValueError(f"at most {MAX_CLOUDS} clouds")
        a = np.asarray(points, dtype=float)
        if a.ndim != 3 or a.shape[0] != self.F or a.shape[2] != 3 or np.isinf(a).any():
            raise ValueError(f"cloud {name}: expected ({self.F},N,3) with no infinity, got {a.shape}")
        c_ = {"name": str(name)[:40], "color": _color(color), "size": float(size), "points": a}
        if temperature is not None:
            c_["temperature"] = self._frames(temperature, f"cloud {name} temperature", ())
        self._clouds.append(c_)
        return self

    def caption(self, t, text):
        t = float(t)
        if not self.t[0] - 1e-9 * abs(self.t[-1]) <= t <= self.t[-1] * (1 + 1e-9) + 1e-12:
            raise ValueError(f"caption time {t} is outside the scene's times")
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

    def camera(self, focus=None, view="free"):
        if view not in VIEWS:
            raise ValueError(f"view must be one of {VIEWS}")
        self._camera = {"focus": None if focus is None else str(focus), "view": view}
        return self

    def to_dict(self):
        if not (self._bodies or self._curves or self._clouds):
            raise ValueError("the scene is empty: add at least one body, curve or cloud")
        n = sum(c_["points"].size for c_ in self._curves) + sum(c_["points"].size for c_ in self._clouds)
        if n > MAX_POINT_NUMBERS:
            raise ValueError(f"curves and clouds hold {n} numbers, the limit is {MAX_POINT_NUMBERS}; use fewer points or frames")
        focus = self._camera["focus"]
        if focus is not None and focus not in [b["name"] for b in self._bodies]:
            raise ValueError(f"camera focus {focus!r} is not a body name")

        def body_out(b):
            out = {"name": b["name"], "kind": b["kind"], "color": b["color"], "spin": b["spin"], "positions": _q(b["positions"]), "radius": _q(b["radius"])}
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
            "clouds": [{k: (_q(v) if k in ("points", "temperature") else v) for k, v in c_.items()} for c_ in self._clouds],
            "captions": sorted(self._captions, key=lambda x: x["t"]),
            "series": [{**s, "values": _q(s["values"])} for s in self._series],
            "numbers": self._numbers,
            "checks": self._checks,
            "camera": self._camera,
        }
