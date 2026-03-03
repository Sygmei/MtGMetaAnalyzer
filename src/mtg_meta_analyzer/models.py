from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(slots=True)
class MoxfieldDeck:
    deck_id: str
    name: str
    url: str
    commanders: list[str]
    cards: dict[str, int]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class DeckRecord:
    deck_name: str
    player: str
    event: str
    event_level: str
    rank: str
    event_date: str
    deck_url: str
    page_url: str
    cards: dict[str, int] = field(default_factory=dict)
    sections: dict[str, dict[str, int]] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

