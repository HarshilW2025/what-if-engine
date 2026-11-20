import pytest

from app.ai import bank


@pytest.fixture(autouse=True)
def tmp_bank(tmp_path, monkeypatch):
    monkeypatch.setattr(bank, "BANK_FILE", tmp_path / "entries.jsonl")
    monkeypatch.setattr(bank, "_entries", None)
    yield


def _scene_out(passed=True, review="pass"):
    return {"spec": {"title": "t", "params": {"engine": "model", "code": "print(1)"}},
            "result": {"engine": "scene", "diagnostics": {"checks": [{"name": "a", "passed": passed}, {"name": "Independent review: ok", "passed": True, "source": "review"}]}},
            "meta": {"review": {"status": review}, "triage": "exact"}}


def test_only_verified_answers_get_in():
    assert bank.entry_from("q", _scene_out()) is not None
    assert bank.entry_from("q", _scene_out(passed=False)) is None
    assert bank.entry_from("q", _scene_out(review="fail")) is None


def test_add_load_and_exact_match():
    bank.add(bank.entry_from("What if the Moon were twice as close?", _scene_out()))
    assert bank.has("what if the moon were twice as close")
    assert not bank.has("What if the Moon were twice as far?")


def test_candidates_rank_related_questions_first():
    for q in ("What if the Moon were twice as close?", "What if the Sun disappeared?", "What if Earth stopped spinning?"):
        bank.add(bank.entry_from(q, _scene_out()))
    top = bank.candidates("What if the Moon was half as far away?")
    assert top and top[0][0]["question"].startswith("What if the Moon")


def test_none_entries_replay_without_running_anything():
    e = bank.entry_from("What if love had mass?", {"spec": {"title": "Weighing love"}, "result": {"engine": "none", "reason": "Zero kilograms."}, "meta": {}})
    out = bank.replay(e, "how heavy is love?")
    assert out["result"]["reason"] == "Zero kilograms." and out["meta"]["bank"] and out["meta"]["asked"] == "how heavy is love?"
