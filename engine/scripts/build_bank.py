"""Builds the answer bank: each question runs through the full pipeline (Opus at standard speed, every check, the
independent review), only verified answers are kept, and new work stops once the budget is spent.
Usage: python -m scripts.build_bank --budget 70 [--workers 6] [--limit 50]"""
import argparse
import os
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

os.environ["ANTHROPIC_SPEED"] = "standard"  # built offline: same accuracy, half the price of fast mode

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from app.ai import bank  # noqa: E402
from app.ai.composer import ask, get_client  # noqa: E402
from scripts.bank_questions import QUESTIONS  # noqa: E402

PRICE = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0)}  # USD per million tokens, standard speed


def cost(out: dict) -> float:
    m = out.get("meta", {})
    pin, pout = PRICE.get(m.get("model"), (4.0, 20.0))
    rt = (m.get("review") or {}).get("tokens") or {}
    return ((m.get("input_tokens", 0) + rt.get("input", 0)) * pin + (m.get("output_tokens", 0) + rt.get("output", 0)) * pout) / 1e6


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, required=True, help="stop starting new questions once this many USD are spent")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    todo = [q for q in QUESTIONS if not bank.has(q)]
    if a.limit:
        todo = todo[: a.limit]
    print(f"Bank has {len(bank.load())} entries; {len(todo)} questions to try; budget ${a.budget:.2f}\n", flush=True)
    client = get_client()
    spent, done, kept, avg, t0 = 0.0, 0, 0, 0.45, time.time()

    def one(q: str):
        start = time.time()
        tri = bank.triage(client, q, [])
        try:
            out = ask(q, hint=tri)
        except Exception as e:  # failed builds still cost money; estimated at the running average
            return q, None, None, f"{type(e).__name__}: {str(e)[:140]}", time.time() - start
        out.setdefault("meta", {})["triage"] = tri.get("kind")
        return q, out, cost(out), None, time.time() - start

    with ThreadPoolExecutor(a.workers) as ex:
        queue, running = list(todo), set()

        def fill():
            while queue and len(running) < a.workers and spent + avg * (len(running) + 1) <= a.budget:
                running.add(ex.submit(one, queue.pop(0)))

        fill()
        while running:
            finished, _ = wait(running, return_when=FIRST_COMPLETED)
            for f in finished:
                running.discard(f)
                q, out, c, err, dt = f.result()
                c = avg if c is None else c
                spent += c
                done += 1
                avg = 0.7 * avg + 0.3 * c if done > 1 else c
                entry = bank.entry_from(q, out) if out else None
                if entry:
                    bank.add(entry)
                    kept += 1
                status = "KEPT" if entry else ("ERR " if err else "SKIP")
                print(f"[{status}] {dt:4.0f}s ${c:.2f} (total ${spent:.2f})  {q}" + (f"\n        {err}" if err else ""), flush=True)
            fill()
    print(f"\nDone in {(time.time() - t0) / 60:.0f} min: {kept} kept of {done} tried, about ${spent:.2f} spent. Bank now has {len(bank.load())} entries.")


if __name__ == "__main__":
    main()
