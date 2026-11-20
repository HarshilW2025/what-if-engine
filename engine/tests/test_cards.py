import json

from app.ai.cards import load_cards, retrieve

BH = {
    "id": "bh-interior-fuzzball",
    "title": "Fuzzballs",
    "concepts": ["black hole", "event horizon", "string theory"],
    "summary": "Black holes are tangles of strings with no empty interior.",
    "support": "minority",
    "sources": [{"title": "Mathur 2005", "url": "https://arxiv.org/abs/hep-th/0502050"}],
}
DE = {
    "id": "big-rip",
    "title": "Big Rip",
    "concepts": ["dark energy", "phantom", "end of the universe"],
    "summary": "Phantom dark energy eventually tears everything apart.",
    "support": "minority",
    "sources": [{"title": "Caldwell, Kamionkowski, Weinberg 2003", "url": "https://arxiv.org/abs/astro-ph/0302506"}],
}
BAD = {"id": "Bad Id", "title": "x", "summary": "y", "sources": []}


def test_load_validates_and_retrieve_ranks(tmp_path):
    for name, c in (("bh", BH), ("de", DE), ("bad", BAD)):
        (tmp_path / f"{name}.json").write_text(json.dumps(c))
    (tmp_path / "broken.json").write_text("{not json")
    cards, problems = load_cards(tmp_path)
    assert {c.id for c in cards} == {"bh-interior-fuzzball", "big-rip"}
    assert len(problems) == 2
    assert retrieve("What if you fell into a black hole?", cards)[0].id == "bh-interior-fuzzball"
    assert retrieve("What if dark energy kept getting stronger until the end of the universe?", cards)[0].id == "big-rip"
    assert retrieve("What if the Earth spun faster?", cards) == []
