"""Runs Claude-written physics models safely: AST scan, separate process, import whitelist,
restricted builtins, no secrets in the environment, CPU and wall-clock limits."""
from __future__ import annotations

import ast
import re
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WIE_PATH = Path(__file__).with_name("wie.py")
TIMEOUT_S = 30
CPU_S = 20
MEM_BYTES = 2 * 1024**3
MAX_OUTPUT = 40 * 1024**2

ALLOWED_MODULES = {
    "math", "cmath", "random", "itertools", "functools", "collections", "statistics", "typing",
    "numpy", "numpy.linalg", "numpy.fft", "numpy.random", "wie",
    "scipy", "scipy.integrate", "scipy.optimize", "scipy.special", "scipy.constants", "scipy.interpolate",
    "scipy.signal", "scipy.fft", "scipy.linalg", "scipy.spatial", "scipy.stats", "scipy.ndimage", "scipy.sparse",
}
BLOCKED_NAMES = {
    "exec", "eval", "compile", "open", "input", "breakpoint", "globals", "locals", "vars",
    "getattr", "setattr", "delattr", "help", "exit", "quit", "memoryview", "__import__",
}
BLOCKED_ATTRS = {
    "load", "save", "savez", "savez_compressed", "loadtxt", "savetxt", "genfromtxt", "fromfile", "tofile",
    "memmap", "ctypeslib", "DataSource", "f2py", "testing", "distutils", "lib", "os", "sys", "system",
    "popen", "io", "show_config", "datasets",
}


class ModelError(Exception):
    """Message is fed back to Claude for repair."""


def check_source(code: str) -> list[str]:
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"SyntaxError line {e.lineno}: {e.msg}"]
    problems: list[str] = []
    for node in ast.walk(tree):
        line = getattr(node, "lineno", "?")
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name not in ALLOWED_MODULES:
                    problems.append(f"line {line}: import of '{a.name}' is not allowed")
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if node.level or mod not in ALLOWED_MODULES:
                problems.append(f"line {line}: import from '{mod}' is not allowed")
            elif mod == "scipy":
                for a in node.names:
                    if f"scipy.{a.name}" not in ALLOWED_MODULES:
                        problems.append(f"line {line}: scipy.{a.name} is not allowed")
            for a in node.names:
                if a.name == "*" or a.name in BLOCKED_ATTRS or a.name.startswith("_"):
                    problems.append(f"line {line}: importing '{a.name}' is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("_") or node.attr in BLOCKED_ATTRS:
                problems.append(f"line {line}: attribute '.{node.attr}' is not allowed")
        elif isinstance(node, ast.Name):
            if node.id in BLOCKED_NAMES or node.id.startswith("__"):
                problems.append(f"line {line}: name '{node.id}' is not allowed")
    return problems


HARNESS = r'''
import sys, json, builtins, traceback
sys.path.insert(0, __TMP__)
try:
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (__CPU__, __CPU__))
    try:
        resource.setrlimit(resource.RLIMIT_AS, (__MEM__, __MEM__))
    except Exception:
        pass
except Exception:
    pass
import math, numpy, scipy, scipy.integrate, scipy.optimize, scipy.special
import wie

ALLOWED = set(__ALLOWED__)
SCIPY_SUBS = {m.split(".", 1)[1] for m in ALLOWED if m.startswith("scipy.")}
_real_import = builtins.__import__

def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level != 0 or (name not in ALLOWED and not name.startswith(("numpy.", "scipy."))):
        raise ImportError(f"import of '{name}' is not allowed in models")
    if name == "scipy":
        for f in fromlist or ():
            if f not in SCIPY_SUBS:
                raise ImportError(f"scipy.{f} is not allowed in models")
    return _real_import(name, globals, locals, fromlist, level)

safe = dict(vars(builtins))
for k in ("open", "exec", "eval", "compile", "input", "breakpoint", "globals", "locals", "vars",
          "getattr", "setattr", "delattr", "help", "exit", "quit", "memoryview"):
    safe.pop(k, None)
safe["__import__"] = _guarded_import

with open(__CODE__) as fh:
    src = fh.read()
real_stdout = sys.stdout
sys.stdout = sys.stderr  # model prints go to the log, not the result
try:
    exec(compile(src, "model.py", "exec"), {"__builtins__": safe, "__name__": "__model__"})
    if not wie._scenes:
        raise RuntimeError("the model never created a wie.Scene")
    out = {"ok": True, "scene": wie._scenes[-1].to_dict()}
except BaseException as e:
    out = {"ok": False, "error": f"{type(e).__name__}: {e}", "traceback": traceback.format_exc(limit=8)[-3000:]}
real_stdout.write(json.dumps(out, allow_nan=False))
real_stdout.flush()
'''


def run_model(code: str, timeout_s: int = TIMEOUT_S) -> dict:
    problems = check_source(code)
    if problems:
        raise ModelError("Code rejected before running:\n" + "\n".join(problems[:20]))

    with tempfile.TemporaryDirectory(prefix="wie_") as tmp:
        shutil.copy(WIE_PATH, Path(tmp) / "wie.py")
        code_path = Path(tmp) / "model.py"
        code_path.write_text(code)
        harness = (
            HARNESS.replace("__TMP__", repr(tmp))
            .replace("__CODE__", repr(str(code_path)))
            .replace("__ALLOWED__", repr(sorted(ALLOWED_MODULES)))
            .replace("__CPU__", str(CPU_S))
            .replace("__MEM__", str(MEM_BYTES))
        )
        harness_path = Path(tmp) / "harness.py"
        harness_path.write_text(harness)

        env = {  # no API keys or other secrets reach the model
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "OMP_NUM_THREADS": "1",
            "OPENBLAS_NUM_THREADS": "1",
            "MKL_NUM_THREADS": "1",
            "PYTHONHASHSEED": "0",
        }
        t0 = time.time()
        try:
            proc = subprocess.run(
                [sys.executable, "-I", str(harness_path)],
                cwd=tmp, env=env, capture_output=True, text=True, timeout=timeout_s,
            )
        except subprocess.TimeoutExpired:
            raise ModelError(f"The model ran longer than {timeout_s} s. Use fewer steps, fewer particles or a coarser grid.")
        wall = time.time() - t0

    if len(proc.stdout) > MAX_OUTPUT:
        raise ModelError("The scene is too large. Use fewer frames, particles or curve points.")
    if not proc.stdout.strip():
        raise ModelError(f"The model crashed (exit code {proc.returncode}), probably out of CPU time or memory.\n{proc.stderr[-1500:]}")
    try:
        out = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise ModelError("The model produced unreadable output.")
    if not out.get("ok"):
        raise ModelError(f"{out.get('error')}\n{out.get('traceback', '')}")

    scene = out["scene"]
    scene["engine"] = "scene"
    checks = scene.pop("checks")
    scene["diagnostics"] = {"runtime_s": round(wall, 3), "checks": checks, "log": proc.stderr[-2000:], "grounding": ground_answer(scene, checks)}
    return scene


_NUM = re.compile(r"(?<![\w.])[-+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?")


def _numbers_in(text: str) -> list[float]:
    vals = []
    for m in _NUM.findall(text or ""):
        try:
            vals.append(float(m.replace(",", "")))
        except ValueError:
            pass
    return vals


def ground_answer(scene: dict, checks: list[dict]) -> dict:
    """Every number in the answer must trace to a computed value (headline numbers, captions, checks,
    series or times) within 2%. Small counting numbers (0 to 12) are allowed."""
    found = _numbers_in(scene.get("answer", ""))
    refs: list[float] = [n["value"] for n in scene.get("numbers", [])]
    for c in checks:
        refs += [c["value"], c["expected"]]
    for cap in scene.get("captions", []):
        refs += _numbers_in(cap["text"]) + [cap["t"]]
    for s in scene.get("series", []):
        vals = [v for v in s["values"] if v is not None]
        if vals:
            refs += [vals[0], vals[-1], min(vals), max(vals)]
    times = scene.get("times") or []
    if times:
        refs += [times[0], times[-1], times[-1] - times[0]]
    ungrounded = []
    for v in found:
        if float(v).is_integer() and 0 <= abs(v) <= 12:
            continue
        if not any(abs(v - r) <= 0.02 * max(abs(r), 1e-300) for r in refs if r is not None):
            ungrounded.append(v)
    return {"numbers": len(found), "ungrounded": ungrounded}


SOLID_KINDS = {"star", "planet", "earth", "moon", "rock", "blackhole"}


def _scene_fail(text, value, expected):
    return {"name": text, "value": float(value), "expected": float(expected), "rtol": 0.0, "atol": 0.0, "passed": False, "source": "scene"}


def scene_checks(scene: dict) -> list[dict]:
    """Checks that the picture matches the physics, whatever the question. Only failures are returned; they trigger a repair.
    A bug in these checks must never break an answer, so any error here skips them."""
    try:
        return _scene_checks(scene)
    except Exception:
        import logging
        logging.getLogger("scene_checks").exception("scene checks skipped")
        return []


def _per_frame(x, n, np):
    a = np.array(1.0 if x is None else x, dtype=float)
    return np.full(n, float(a)) if a.ndim == 0 else a.reshape(-1)


def _scene_checks(scene: dict) -> list[dict]:
    import numpy as np

    out = []
    bodies = [b for b in scene.get("bodies", []) if b.get("kind") in SOLID_KINDS]
    arrs = []
    for b in bodies:
        P = np.array(b["positions"], dtype=float).reshape(-1, 3)
        r, sc = _per_frame(b.get("radius"), len(P), np), _per_frame(b.get("scale"), len(P), np)
        n = min(len(P), len(r), len(sc))
        arrs.append((P[:n], r[:n] * sc[:n]))

    # 1. separate bodies must not be drawn overlapping
    for i in range(len(bodies)):
        for j in range(i + 1, len(bodies)):
            (Pi, ri), (Pj, rj) = arrs[i], arrs[j]
            n = min(len(Pi), len(Pj))
            d = np.linalg.norm(Pi[:n] - Pj[:n], axis=1)
            both = np.isfinite(d) & np.isfinite(ri[:n]) & np.isfinite(rj[:n])
            if not both.any():
                continue
            k = int(np.argmax(both))
            same_size = abs(ri[k] - rj[k]) <= 0.01 * max(ri[k], rj[k], 1e-300)
            if bodies[i].get("kind") == bodies[j].get("kind") and same_size and d[k] < 0.1 * (ri[k] + rj[k]):
                continue  # a comparison copy ("Earth if the Sun had stayed") starts on top of the original on purpose
            frac = float((both & (d < 0.9 * (ri[:n] + rj[:n]))).sum() / both.sum())
            if frac > 0.1:
                out.append(_scene_fail(
                    f"{bodies[i]['name']} and {bodies[j]['name']} are drawn overlapping in {frac:.0%} of frames. "
                    "Use true radii or a smaller scale so separate bodies look separate; if they collide, end one body (NaN) at impact",
                    frac, 0.0))

    # 2. a solid body must not shrink while a cloud of its material flies away
    clouds = scene.get("clouds", [])
    for b, (P, r) in zip(bodies, arrs):
        ok = np.isfinite(r) & np.isfinite(P).all(axis=1)
        if ok.sum() < 3 or not clouds or not np.isfinite(r[0]) or r[0] <= 0:
            continue
        shrink = float(np.nanmin(r[ok]) / r[0])
        if shrink > 0.7:
            continue
        for c in clouds:
            pts = c.get("points") or []
            if len(pts) < 2:
                continue
            first = np.array(pts[0], dtype=float).reshape(-1, 3)
            last = np.array(pts[-1], dtype=float).reshape(-1, 3)
            d0 = np.nanmedian(np.linalg.norm(first - P[0], axis=1))
            d1 = np.nanmedian(np.linalg.norm(last - P[0], axis=1))
            if np.isfinite(d0) and np.isfinite(d1) and d1 > 1.5 * max(d0, 1e-30):
                out.append(_scene_fail(
                    f"{b['name']} is drawn as a solid sphere that shrinks to {shrink:.0%} of its size while '{c.get('name', 'cloud')}' flies away. "
                    "That reads as the planet shrinking. Hide the body (NaN positions) once it breaks apart and let the cloud carry the material",
                    shrink, 1.0))
                break
    return out
