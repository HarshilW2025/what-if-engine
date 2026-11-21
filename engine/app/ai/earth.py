"""What people on Earth would feel and see, computed directly from a gravity run. No model writes these numbers."""
import logging
import warnings

import numpy as np

log = logging.getLogger("earth")

DARK = ("black hole", "neutron", "pulsar", "magnetar", "white dwarf")
MOON_MSUN = 3.694e-8
MOON_AU = 0.00257
SUN_TIDE_SHARE = 0.46  # today the Sun raises 46% as much tide as the Moon
T_TODAY_K = 288.15  # Earth's average surface temperature today, 15 °C
NOTE = ("Estimates computed from the orbits: temperature from the sunlight balance with today's air and "
        "reflectivity (no climate feedbacks or heat storage), tides from the distances of the Moon and stars.")


def luminosity(m: float) -> float:
    """Main sequence mass to luminosity, solar units. Below 0.08 solar masses nothing shines."""
    if m < 0.08:
        return 0.0
    if m < 0.43:
        return 0.23 * m**2.3
    if m < 2:
        return m**4
    if m < 55:
        return 1.4 * m**3.5
    return 32000.0 * m


def _positions(res):
    frames = res.get("positions") or []
    n = len(res.get("bodies") or [])
    P = np.full((len(frames), n, 3), np.nan)
    for k, fr in enumerate(frames):
        for i, p in enumerate(list(fr)[:n]):
            if p is not None:
                P[k, i] = p
    return P


def _out(a):
    return [None if not np.isfinite(x) else float(f"{x:.4g}") for x in a]


def earth_from_orbits(res: dict) -> dict | None:
    try:
        return _earth(res)
    except Exception:
        log.exception("on earth panel failed")
        return None  # never break an answer


def _earth(res):
    bodies = res.get("bodies") or []
    names = [str(b.get("name", "")).strip().lower() for b in bodies]
    e = next((i for i, n in enumerate(names) if n == "earth"), None)
    if e is None:
        e = next((i for i, n in enumerate(names) if "earth" in n), None)
    P = _positions(res)
    if e is None or P.shape[0] < 2:
        return None
    t = np.asarray(res.get("times") or [], dtype=float)
    mass = [float(b.get("mass_msun") or 0.0) for b in bodies]
    alive = np.isfinite(P[:, e]).all(axis=1)
    if not alive.any():
        return None

    def dist(i):
        return np.linalg.norm(P[:, i] - P[:, e], axis=1)

    def tt(k):
        return float(t[k]) if k < len(t) else float(k)

    stars = [i for i in range(len(bodies)) if i != e and luminosity(mass[i]) > 0 and not any(w in names[i] for w in DARK)]
    moons = [i for i in range(len(bodies)) if i != e and "moon" in names[i] and mass[i] < 1e-5]
    heavy = [i for i in range(len(bodies)) if i != e and mass[i] >= 0.01]
    series, events = [], []
    temp = sun = near = tide = None
    k0 = int(np.argmax(alive))
    with warnings.catch_warnings(), np.errstate(divide="ignore", invalid="ignore"):
        warnings.simplefilter("ignore", RuntimeWarning)
        if stars:
            ds = np.stack([dist(i) for i in stars], axis=1)
            L = np.array([luminosity(mass[i]) for i in stars])
            sun = np.nansum(L / ds**2, axis=1)
            near = np.nanmin(ds, axis=1)
            sun[~alive] = np.nan
            near[~alive] = np.nan
            temp = T_TODAY_K * sun**0.25 - 273.15
            series += [("Average temperature", "°C", temp, 15.0), ("Sunlight vs today", "%", 100 * sun, 100.0)]
        if moons or heavy:
            zero = np.zeros(len(P))
            moon_part = sum(((mass[i] / MOON_MSUN) * (MOON_AU / dist(i)) ** 3 for i in moons), zero)
            star_part = sum((mass[i] / dist(i) ** 3 for i in heavy), zero)
            tide = (np.nan_to_num(moon_part) + SUN_TIDE_SHARE * np.nan_to_num(star_part)) / (1 + SUN_TIDE_SHARE)
            tide[~alive] = np.nan
            series.append(("Tides vs today", "×", tide, 1.0))
        if near is not None:
            series.append(("Distance to nearest star", "AU", near, 1.0))

        if temp is not None:
            events.append({"t": tt(k0), "text": f"Start: average {temp[k0]:.0f} °C, sunlight {100 * sun[k0]:.0f}% of today"})

        def cross(arr, th, up, msg):
            if arr is None or not np.isfinite(arr[k0]):
                return
            if (arr[k0] >= th) if up else (arr[k0] <= th):
                return
            hit = np.where(arr >= th)[0] if up else np.where(arr <= th)[0]
            if hit.size:
                events.append({"t": tt(int(hit[0])), "text": msg.format(v=float(arr[hit[0]]))})

        cross(temp, 50, True, "Average {v:.0f} °C: deadly heat outdoors, crops fail")
        cross(temp, 100, True, "Average {v:.0f} °C: the oceans begin to boil")
        cross(temp, 0, False, "Average {v:.0f} °C: below freezing, the oceans start to ice over")
        cross(temp, -78, False, "Average {v:.0f} °C: carbon dioxide snows out of the air")
        cross(tide, 10, True, "Tides {v:.0f} times today's: coastal cities flood with every tide")
        if near is not None and np.isfinite(near[k0]) and near[k0] < 5:
            cross(near, 30, True, "Earth passes {v:.0f} AU from its star: the Sun is just a bright star now")
        if not alive[-1]:
            k = int(np.where(alive)[0][-1]) + 1
            events.append({"t": tt(min(k, len(alive) - 1)), "text": "Earth is destroyed or swallowed by another body"})

    if not series and not events:
        return None
    return {"series": [{"name": n, "unit": u, "values": _out(a), "today": td} for n, u, a, td in series[:4]],
            "events": sorted(events, key=lambda x: x["t"])[:6], "note": NOTE}
