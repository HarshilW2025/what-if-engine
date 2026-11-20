import pytest

from app.ai.reviewer import as_check, constants, evaluate, judge

N = constants()
SCENE = {"numbers": [{"name": "Length of a day", "value": 28.7214, "unit": "s"}, {"name": "Equatorial speed", "value": 1393.74, "unit": "km/s"}]}


def test_formulas_evaluate():
    assert evaluate(["w = 3000*2*pi/86164.0905", "2*pi/w"], N) == pytest.approx(28.7214, rel=1e-4)
    assert evaluate(["sqrt(2*G*M_earth/R_earth)/1e3"], N) == pytest.approx(11.19, rel=1e-3)


@pytest.mark.parametrize("bad", [['__import__("os")'], ['open("x")'], ["(1).__class__"], ["9**9**9"], ["x = 1; y = 2", "x"]])
def test_formulas_cannot_escape(bad):
    with pytest.raises(Exception):
        evaluate(bad, N)


def test_matching_recompute_passes():
    rev = {"verdict": "pass", "problems": [], "recompute": [{"number_index": 0, "lines": ["2*pi/(3000*7.2921e-5)"]}, {"number_index": 1, "lines": ["3000*7.2921e-5*R_earth/1e3"]}]}
    chk = as_check(judge(rev, SCENE, N))
    assert chk["passed"] and "2 headline numbers" in chk["name"]


def test_mismatch_fails_even_if_reviewer_says_pass():
    rev = {"verdict": "pass", "problems": [], "recompute": [{"number_index": 1, "lines": ["3000*465.1/1e3*1.2"]}]}
    chk = as_check(judge(rev, SCENE, N))
    assert not chk["passed"] and "independent recompute gives" in chk["name"]


def test_reviewer_fail_verdict_fails():
    rev = {"verdict": "fail", "problems": ["Uses Newtonian kinetic energy at 0.9c"], "recompute": []}
    chk = as_check(judge(rev, SCENE, N))
    assert not chk["passed"] and "0.9c" in chk["name"]
