"""Answer cache: identical questions come back instantly and free. Keyed by a fingerprint of the
prompt, toolkit, model and theory cards, so improving any of them starts a fresh cache automatically."""
import hashlib
import json
import os
import re
from pathlib import Path

from app.ai.cards import CARDS_DIR
from app.ai.composer import MODEL
from app.ai.prompts import COMPOSER_SYSTEM

_ENGINE_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(os.getenv("CACHE_DIR", _ENGINE_DIR / "cache"))
_WIE = (_ENGINE_DIR / "app" / "sandbox" / "wie.py").read_bytes()


def version() -> str:
    h = hashlib.sha256(COMPOSER_SYSTEM.encode() + _WIE + MODEL.encode())
    if CARDS_DIR.exists():
        for p in sorted(CARDS_DIR.glob("*.json")):
            h.update(p.name.encode())
            h.update(p.read_bytes())
    return h.hexdigest()[:10]


def normalize(q: str) -> str:
    q = re.sub(r"\s+", " ", q.lower().strip())
    return re.sub(r"[?.!\s]+$", "", q)


def _path(q: str) -> Path:
    return CACHE_DIR / version() / (hashlib.sha256(normalize(q).encode()).hexdigest()[:24] + ".json")


def get(q: str) -> dict | None:
    p = _path(q)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def put(q: str, data: dict) -> None:
    p = _path(q)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(p)
