import time

from fastapi.testclient import TestClient

import app.main as main


def test_job_records_pipeline_and_returns_result(monkeypatch):
    def fake_ask(q, progress=None):
        progress("compose", "Claude is writing the physics model")
        progress("run", "Running the model in the sandbox")
        return {"spec": {"question": q}, "result": {"engine": "none", "reason": "test"}, "meta": {}}

    monkeypatch.setattr(main, "ask", fake_ask)
    monkeypatch.setattr(main.cache, "get", lambda q: None)
    monkeypatch.setattr(main.cache, "put", lambda q, d: None)
    client = TestClient(main.app)
    start = client.post("/ask/start", json={"question": "What if testing worked?"}).json()
    assert start["done"] is False and start["job"]
    for _ in range(50):
        st = client.get(f"/ask/status/{start['job']}").json()
        if st["done"]:
            break
        time.sleep(0.02)
    assert st["done"] and st["error"] is None
    assert [s["stage"] for s in st["result"]["meta"]["pipeline"]] == ["compose", "run"]


def test_unknown_job_is_404():
    assert TestClient(main.app).get("/ask/status/nope").status_code == 404
