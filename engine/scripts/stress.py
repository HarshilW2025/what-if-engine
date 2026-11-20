"""Stress test: 30 questions in 4 groups, run fresh through the full pipeline (with review), cached, and scored.
Usage: python -m scripts.stress            all 30
       python -m scripts.stress absurd     one group (basic, theory, niche, absurd)"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from app.ai import cache  # noqa: E402
from app.ai.composer import ask  # noqa: E402

EXACT, THEORY, NONE = {"exact"}, {"theory"}, {"unknown"}
SUITE = {
    "basic": [
        ("What if the Sun suddenly disappeared?", EXACT),
        ("What if the Earth were twice as big?", EXACT),
        ("What if the Earth stopped spinning?", EXACT),
        ("What if the Moon disappeared?", EXACT),
        ("What if you dropped a bowling ball and a feather on the Moon?", EXACT),
        ("What if Earth orbited twice as far from the Sun?", EXACT),
        ("What if you fired a cannonball sideways at 8 km/s?", EXACT),
        ("What if Mars collided with Earth?", EXACT),
        ("What if the Sun were replaced by a black hole of the same mass?", EXACT),
        ("What if you travelled at 90% of the speed of light for a year?", EXACT),
    ],
    "theory": [
        ("How will the universe end?", THEORY),
        ("What is inside a black hole?", THEORY),
        ("What if dark energy keeps getting stronger?", THEORY),
        ("What happens to information that falls into a black hole?", THEORY),
        ("Could a warp drive let us travel faster than light?", THEORY),
        ("Is our universe inside a black hole?", THEORY),
        ("What if the vacuum of space decayed?", THEORY),
        ("Could a wormhole connect two distant places?", THEORY),
        ("What if dark matter does not exist?", THEORY),
        ("Will the universe expand forever or collapse again?", THEORY),
    ],
    "niche": [
        ("What if the star Gliese 710 passed through the Oort cloud?", EXACT),
        ("What if a primordial black hole the mass of an asteroid passed through Earth?", EXACT),
        ("What if Betelgeuse went supernova tonight?", EXACT),
        ("What if Phobos crashed into Mars?", EXACT),
        ("What if a gamma ray burst hit Earth from 6,000 light years away?", EXACT),
    ],
    "absurd": [
        ("What if the Earth were shaped like a jalebi?", EXACT),
        ("What if the Moon were made of cheese?", EXACT),
        ("What if love had mass?", NONE),
        ("What if every person on Earth jumped at the same time?", EXACT),
        ("What if time was purple?", NONE),
    ],
}


def run(group: str, q: str, want: set) -> dict:
    t0 = time.time()
    rec = {"group": group, "question": q, "want_tier": sorted(want)}
    notes = []
    try:
        out = ask(q)
        cache.put(q, out)
        spec, res, meta = out["spec"], out["result"], out.get("meta", {})
        diag = res.get("diagnostics") if isinstance(res.get("diagnostics"), dict) else {}
        checks = diag.get("checks", [])
        rv = meta.get("review") or {}
        rec.update(
            tier=spec.get("tier"), title=spec.get("title"), route=meta.get("route"), engine=res.get("engine"),
            attempts=meta.get("attempts"), checks_passed=sum(1 for c in checks if c.get("passed")), checks_total=len(checks),
            failed_checks=[c["name"] for c in checks if not c.get("passed")],
            review=rv.get("status"), review_problems=rv.get("problems", []),
            answer=res.get("answer") or res.get("reason") or "", assumptions=spec.get("assumptions", []),
            theories=[{k: t.get(k) for k in ("name", "support", "card", "simulated")} for t in spec.get("theories") or []],
        )
        if rec["failed_checks"] or rec["review"] == "fail":
            status = "FAIL"
        else:
            status = "OK"
            if rec["tier"] not in want:
                notes.append(f"tier {rec['tier']}, expected {'/'.join(sorted(want))}")
            if rec["tier"] == "unknown" and "Try asking:" not in rec["answer"]:
                notes.append("no 'Try asking:' line")
            if rec["engine"] != "none" and rec["review"] is None:
                notes.append("not reviewed")
            if (rec["attempts"] or 0) >= 3:
                notes.append("needed 3 attempts")
            if notes:
                status = "WARN"
    except Exception as e:
        status = "FAIL"
        rec["error"] = f"{type(e).__name__}: {e}"
    rec.update(status=status, notes=notes, seconds=round(time.time() - t0))
    return rec


if __name__ == "__main__":
    groups = sys.argv[1:] or list(SUITE)
    items = [(g, q, w) for g in groups for q, w in SUITE[g]]
    print(f"Stress test: {len(items)} questions, 4 at a time\n", flush=True)
    t0, results = time.time(), []
    with ThreadPoolExecutor(4) as ex:
        futs = [ex.submit(run, *it) for it in items]
        for f in as_completed(futs):
            r = f.result()
            results.append(r)
            line = f"[{r['status']:4}] {r['seconds']:4}s  {r['group']:6}  {r['question']}"
            if "error" in r:
                line += f"\n        {r['error'][:200]}"
            else:
                line += f"\n        {r['route']} | {r['tier']} | attempts {r['attempts']} | checks {r['checks_passed']}/{r['checks_total']} | review {r['review']} | {r['title']}"
            for n in r["notes"] + r.get("failed_checks", [])[:3] + r.get("review_problems", [])[:3]:
                line += f"\n        ! {str(n)[:220]}"
            print(line + "\n", flush=True)
    order = {q: i for i, (_, q, _) in enumerate(items)}
    results.sort(key=lambda r: order[r["question"]])
    Path("stress_report.json").write_text(json.dumps(results, indent=1))
    print("=" * 60)
    for g in groups:
        rs = [r for r in results if r["group"] == g]
        print(f"{g:7} OK {sum(r['status'] == 'OK' for r in rs)}  WARN {sum(r['status'] == 'WARN' for r in rs)}  FAIL {sum(r['status'] == 'FAIL' for r in rs)}  of {len(rs)}")
    print(f"\nDone in {time.time() - t0:.0f}s. Full report: engine/stress_report.json")
