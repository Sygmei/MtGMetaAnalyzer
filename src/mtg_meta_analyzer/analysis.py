from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .models import DeckRecord, MoxfieldDeck
from .utils import parse_date


@dataclass(slots=True)
class CardStat:
    card: str
    decks_with_card: int
    total_decks: int
    ratio: float

    def to_dict(self) -> dict:
        return {
            "card": self.card,
            "decks_with_card": self.decks_with_card,
            "total_decks": self.total_decks,
            "ratio": self.ratio,
        }


@dataclass(slots=True)
class AnalysisResult:
    start_date: str | None
    end_date: str | None
    total_decks_considered: int
    keep: list[CardStat]
    cut: list[CardStat]
    all_stats: list[CardStat]

    def to_dict(self) -> dict:
        return {
            "start_date": self.start_date,
            "end_date": self.end_date,
            "total_decks_considered": self.total_decks_considered,
            "keep": [item.to_dict() for item in self.keep],
            "cut": [item.to_dict() for item in self.cut],
            "all_stats": [item.to_dict() for item in self.all_stats],
        }


def analyze_cards(
    moxfield_deck: MoxfieldDeck,
    cached_decks: list[DeckRecord],
    start: date | None = None,
    end: date | None = None,
    keep_top: int = 20,
    cut_top: int = 20,
) -> AnalysisResult:
    effective_start = start or date.min
    effective_end = end or date.max
    commander_set = set(moxfield_deck.commanders)
    moxfield_card_names = [card for card in moxfield_deck.cards if card not in commander_set]

    filtered = []
    for deck in cached_decks:
        deck_date = parse_date(deck.event_date)
        if deck_date is None:
            continue
        if effective_start <= deck_date <= effective_end:
            filtered.append(deck)

    frequencies: dict[str, int] = {name: 0 for name in moxfield_card_names}
    for deck in filtered:
        deck_card_set = set(deck.cards.keys())
        for name in moxfield_card_names:
            if name in deck_card_set:
                frequencies[name] += 1

    total_decks = len(filtered)
    stats = [
        CardStat(
            card=name,
            decks_with_card=frequencies[name],
            total_decks=total_decks,
            ratio=(frequencies[name] / total_decks) if total_decks else 0.0,
        )
        for name in moxfield_card_names
    ]
    stats_desc = sorted(stats, key=lambda x: (x.decks_with_card, x.card.lower()), reverse=True)
    stats_asc = sorted(stats, key=lambda x: (x.decks_with_card, x.card.lower()))
    return AnalysisResult(
        start_date=start.isoformat() if start else None,
        end_date=end.isoformat() if end else None,
        total_decks_considered=total_decks,
        keep=stats_desc[:keep_top],
        cut=stats_asc[:cut_top],
        all_stats=stats_desc,
    )
