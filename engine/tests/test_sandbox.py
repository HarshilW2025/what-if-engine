import pytest

from app.sandbox.runner import ModelError, check_source, run_model

GOOD = """
import numpy as np
import wie
t = np.linspace(0, 10, 50)
s = wie.Scene(t, time_unit="s", length_unit="m")
s.body("Ball", np.c_[t, 0 * t, 0 * t], radius=1.0, kind="rock")
s.series("x", t, "m")
s.number("final x", t[-1], "m")
s.check("moves 1 m/s", t[-1], 10.0)
"""


def test_good_model_runs():
    scene = run_model(GOOD)
    assert scene["engine"] == "scene"
    assert len(scene["times"]) == 50
    assert scene["bodies"][0]["positions"][-1][0] == 10.0
    assert scene["diagnostics"]["checks"][0]["passed"]


@pytest.mark.parametrize(
    "bad",
    [
        "import os",
        "import subprocess",
        "from scipy import io",
        "x = ().__class__",
        "open('/etc/passwd')",
        "eval('1+1')",
        "import numpy as np\nnp.load('x')",
    ],
)
def test_dangerous_code_is_rejected(bad):
    assert check_source(bad)
    with pytest.raises(ModelError):
        run_model(bad)


def test_runtime_error_is_reported():
    with pytest.raises(ModelError, match="ZeroDivisionError"):
        run_model("import wie\nx = 1 / 0\n" + "y = 2\n" * 3)


def test_infinite_loop_times_out():
    with pytest.raises(ModelError, match="longer than"):
        run_model("import wie\nwhile True:\n    pass\n", timeout_s=3)


def test_failed_check_is_visible():
    scene = run_model(GOOD.replace("s.check(\"moves 1 m/s\", t[-1], 10.0)", "s.check(\"wrong\", t[-1], 11.0)"))
    assert not scene["diagnostics"]["checks"][0]["passed"]


def test_bad_shapes_are_explained():
    with pytest.raises(ModelError, match="expected shape"):
        run_model("import numpy as np\nimport wie\ns = wie.Scene(np.linspace(0, 1, 10))\ns.body('A', np.zeros((5, 3)), 1.0)\n")


def test_numpy_methods_and_thinning_work():
    code = """
import numpy as np
import wie
t = np.linspace(0, 1, 200)
s = wie.Scene(t)
pts = np.zeros((200, 1500, 3)) + t[:, None, None]
s.cloud("dust", pts, temperature=np.full(1500, 3000.0))
s.body("A", [0, 0, 0], 1.0)
s.number("mean", pts.mean(), "")
s.number("area", np.trapezoid(t, t), "")
s.check("max", pts.max(), 1.0)
"""
    scene = run_model(code)
    assert scene["thinned"] >= 2
    assert "temperature_each" in scene["clouds"][0]
    assert scene["diagnostics"]["checks"][0]["passed"]
