"""Validates every theory card in engine/cards. Usage (from engine/): python -m scripts.check_cards"""
from app.ai.cards import CARDS_DIR, load_cards

cards, problems = load_cards()
print(f"{len(cards)} valid cards in {CARDS_DIR}")
for c in cards:
    print(f"  OK   {c.id:34} {c.support:22} {len(c.sources)} source(s)")
for p in problems:
    print(f"  BAD  {p}")
