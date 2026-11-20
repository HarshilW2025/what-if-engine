"""Fetch live answers (cache hits are free) and save the full JSON for debugging.
Usage: python3 scripts/debug_ask.py "question one" "question two" ..."""
import json, sys, time, urllib.request
from pathlib import Path

API = "https://what-if-engine-production-d6b5990a.up.railway.app"

def req(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, headers={"Content-Type": "application/json"}, method="POST" if data else "GET")
    with urllib.request.urlopen(r, timeout=60) as f:
        return json.load(f)

if len(sys.argv) < 2:
    sys.exit(__doc__)
for i, q in enumerate(sys.argv[1:], 1):
    st = req("/ask/start", {"question": q})
    jid = st.get("job")
    while not st.get("done"):
        time.sleep(2); st = req(f"/ask/status/{jid}")
    if st.get("error"):
        print(i, "ERROR", st["error"]); continue
    out = st["result"]
    path = Path.home() / "Desktop" / f"wie_debug_{i}.json"
    path.write_text(json.dumps(out, indent=1))
    spec, res, meta = out.get("spec", {}), out.get("result", {}), out.get("meta", {})
    print(f"\n=== {i}: {q}")
    print("cached:", meta.get("cached"), "| route:", meta.get("route"), "| tier:", spec.get("tier"), "| engine:", res.get("engine"))
    print("title:", spec.get("title"))
    print("saved:", path, f"({path.stat().st_size // 1024} KB)")
