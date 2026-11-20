"""Theory cards: hand-written, source-checked summaries of serious hypotheses.
For the theory tier, Claude builds its competing pictures from these and may only cite what they contain."""
import json
import logging
import os
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from rank_bm25 import BM25Okapi

from app.ai.model_spec import Support

log = logging.getLogger("cards")
CARDS_DIR = Path(os.getenv("CARDS_DIR", Path(__file__).resolve().parents[2] / "cards"))


class Source(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = ""
    authors: str = ""
    year: int | None = None
    url: str = Field(pattern=r"^https?://")


class KeyNumber(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    value: str | float | int = ""
    units: str = ""
    source: str = ""


class Card(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,59}$")
    title: str = Field(min_length=1, max_length=120)
    concepts: list[str] = []
    example_questions: list[str] = []
    summary: str = Field(min_length=1)
    proponents: list[str] = []
    status: Literal["exact-model", "measured-hint", "theory", "contested"] = "theory"
    support: Support = "minority"
    support_note: str = ""
    what_happens: list[str] = []
    key_numbers: list[KeyNumber] = []
    equations: list[str] = []
    objections: list[str] = []
    competes_with: list[str] = []
    sources: list[Source] = Field(min_length=1)

    def for_prompt(self) -> dict:
        return self.model_dump(exclude={"sources", "example_questions", "concepts"})

    def ref(self) -> dict:
        return {"id": self.id, "title": self.title, "sources": [s.model_dump() for s in self.sources]}


def load_cards(directory: Path | None = None) -> tuple[list[Card], list[str]]:
    """All valid cards, plus a list of problems with the invalid ones."""
    d = Path(directory or CARDS_DIR)
    cards: list[Card] = []
    problems: list[str] = []
    if not d.exists():
        return cards, problems
    seen: set[str] = set()
    for p in sorted(d.glob("*.json")):
        try:
            c = Card.model_validate(json.loads(p.read_text()))
        except (json.JSONDecodeError, ValidationError) as e:
            problems.append(f"{p.name}: {' '.join(str(e).split())[:400]}")
            continue
        if c.id in seen:
            problems.append(f"{p.name}: duplicate id {c.id}")
            continue
        seen.add(c.id)
        cards.append(c)
    return cards, problems


_STOP = set(
    "a an the of in on to is are was were be been what if would will could happen happens happened how why does do did "
    "into with and or for at by from it its this that there their our we you your i".split()
)


def _tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOP]


def retrieve(question: str, cards: list[Card], k: int = 6) -> list[Card]:
    """BM25 over title, concepts (weighted twice), example questions, summary and proponents,
    plus a small word-overlap term so tiny libraries still rank sensibly."""
    if not cards:
        return []
    docs = [_tokens(" ".join([c.title, *c.concepts, *c.concepts, *c.example_questions, c.summary, *c.proponents])) for c in cards]
    q = _tokens(question)
    bm = BM25Okapi(docs).get_scores(q)
    qs = set(q)
    scored = [(float(bm[n]) + 0.1 * len(qs & set(docs[n])), n) for n in range(len(cards))]
    scored.sort(key=lambda x: -x[0])
    return [cards[n] for s, n in scored[:k] if s > 0]
