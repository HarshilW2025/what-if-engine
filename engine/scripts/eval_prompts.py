"""Runs a wide spread of questions through the full pipeline, prints a report, and warms the answer cache.

Usage (from engine/):  python -m scripts.eval_prompts            all questions, 4 at a time
                       python -m scripts.eval_prompts --only 3    first 3 only
"""
import argparse
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.ai import cache  # noqa: E402
from app.ai.composer import ask  # noqa: E402

QUESTIONS = [
    "What if the Earth spun 3000 times faster?",
    "What if a spaceship flew to Proxima Centauri at 99.99% of light speed?",
    "What if you fell into a black hole?",
    "What if the Moon were twice as close?",
    "What happened before the Big Bang?",
    "What if the Sun suddenly disappeared?",
    "What if gravity were 10 times weaker?",
    "What if Earth had rings like Saturn?",
    "What if a 10 km asteroid hit the Pacific Ocean?",
    "What if you jumped into a tunnel straight through the Earth?",
    "What if the speed of light were 100 km/h?",
    "What if the universe stopped expanding?",
    "What if Jupiter became a star?",
    "What if an electron were fired at two slits one at a time?",
    "What if a neutron star passed through the solar system?",
    "What is the meaning of life?",
]


def run(q: str):
    t0 = time.time()
    hit = cache.get(q)
    if hit:
        return q, "cached", hit, 0.0
    try:
        out = ask(q)
        cache.put(q, out)
        return q, "ok", out, time.time() - t0
    except Exception as e:  # report every failure, never stop the run
        return q, "error", f"{type(e).__name__}: {e}", time.time() - t0


def describe(status: str, out) -> str:
    if status == "error":
        return str(out)[:200]
    r, m, s = out["result"], out.get("meta", {}), out["spec"]
    checks = r.get("diagnostics", {}).get("checks", [])
    failed = [c["name"] for c in checks if not c["passed"]]
    line = f"{m.get('route')} | {s['tier']} | attempts {m.get('attempts')} | checks {len(checks) - len(failed)}/{len(checks)} | {s['title']}"
    return line + (f"\n      FAILED CHECKS: {failed}" if failed else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--only", type=int, default=0)
    args = ap.parse_args()
    qs = QUESTIONS[: args.only] if args.only else QUESTIONS

    print(f"Running {len(qs)} questions, {args.workers} at a time (cache version {cache.version()})\n")
    t0 = time.time()
    stats = {"ok": 0, "cached": 0, "error": 0}
    tokens = [0, 0]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(run, q) for q in qs]
        for f in as_completed(futures):
            q, status, out, secs = f.result()
            stats[status] += 1
            if status == "ok":
                tokens[0] += out["meta"]["input_tokens"]
                tokens[1] += out["meta"]["output_tokens"]
            mark = {"ok": "OK ", "cached": "HIT", "error": "ERR"}[status]
            print(f"[{mark}] {secs:5.0f}s  {q}\n      {describe(status, out)}\n", flush=True)
    print(f"Done in {time.time() - t0:.0f}s: {stats['ok']} ok, {stats['cached']} cached, {stats['error']} errors. Tokens in {tokens[0]:,}, out {tokens[1]:,}")


if __name__ == "__main__":
    main()
