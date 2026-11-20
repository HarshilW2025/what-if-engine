"""Rerun chosen questions through the full pipeline (fresh, with review) and cache them.
Usage: python -m scripts.rerun "question one" "question two" ..."""
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv

load_dotenv()

from app.ai import cache  # noqa: E402
from app.ai.composer import ask  # noqa: E402


def one(q: str) -> str:
    t0 = time.time()
    try:
        out = ask(q)
        cache.put(q, out)
        r, m = out["result"], out["meta"]
        checks = r.get("diagnostics", {}).get("checks", [])
        bad = [c["name"][:200] for c in checks if not c.get("passed")]
        rv = m.get("review") or {}
        lines = [f"[OK ] {time.time() - t0:4.0f}s  {q}",
                 f"      {m.get('route')} | attempts {m.get('attempts')} | checks {len(checks) - len(bad)}/{len(checks)} | review {rv.get('status', 'none')} | {out['spec'].get('title')}"]
        lines += [f"      FAILED: {b}" for b in bad] + [f"      REVIEW: {p[:250]}" for p in rv.get("problems", [])]
        return "\n".join(lines)
    except Exception as e:
        return f"[ERR] {time.time() - t0:4.0f}s  {q}\n      {type(e).__name__}: {e}"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    with ThreadPoolExecutor(4) as ex:
        for line in ex.map(one, sys.argv[1:]):
            print(line + "\n", flush=True)
