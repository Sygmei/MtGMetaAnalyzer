from __future__ import annotations

import argparse
import json
import logging
from datetime import date
from pathlib import Path
from typing import Iterable

from .analysis import analyze_cards
from .models import DeckRecord, MoxfieldDeck
from .moxfield import extract_deck_id, fetch_moxfield_deck
from .mtgtop8 import MtgTop8Client
from .utils import parse_date, slugify, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Moxfield vs MtgTop8 Duel Commander analyzer")
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose debug logging for Moxfield and MtgTop8 retrieval",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch_parser = subparsers.add_parser("fetch", help="Fetch and cache commander decks from MtgTop8")
    fetch_parser.add_argument("--moxfield-url", required=True, help="Moxfield deck URL")
    fetch_parser.add_argument(
        "--moxfield-headed",
        action="store_true",
        help="Run Moxfield browser extraction with a visible Chromium window",
    )
    fetch_parser.add_argument("--cache-root", default="cache", help="Cache root directory")
    fetch_parser.add_argument("--max-pages", type=int, default=None, help="Optional pagination cap")
    fetch_parser.add_argument(
        "--delay-seconds",
        type=float,
        default=0.2,
        help="Delay between requests to avoid hammering MtgTop8",
    )
    fetch_parser.add_argument(
        "--moxfield-only",
        action="store_true",
        help="Only fetch/cache Moxfield deck snapshot and skip MtgTop8 retrieval",
    )

    analyze_parser = subparsers.add_parser("analyze", help="Analyze cached decks and print keep/cut suggestions")
    analyze_parser.add_argument(
        "--moxfield-url",
        required=False,
        help="Moxfield deck URL (optional when a single cached deck exists)",
    )
    analyze_parser.add_argument(
        "--deck-id",
        required=False,
        help="Cached deck id to analyze (optional if --moxfield-url is provided or only one cache entry exists)",
    )
    analyze_parser.add_argument(
        "--moxfield-headed",
        action="store_true",
        help="Deprecated for analyze: kept for backward compatibility and ignored",
    )
    analyze_parser.add_argument("--cache-root", default="cache", help="Cache root directory")
    analyze_parser.add_argument("--start-date", required=False, help="Optional start date (YYYY-MM-DD)")
    analyze_parser.add_argument("--end-date", required=False, help="Optional end date (YYYY-MM-DD)")
    analyze_parser.add_argument("--keep-top", type=int, default=20, help="Number of keep suggestions")
    analyze_parser.add_argument("--cut-top", type=int, default=20, help="Number of cut suggestions")
    analyze_parser.add_argument("--add-top", type=int, default=20, help="Number of to-add suggestions")
    analyze_parser.add_argument(
        "--output-json",
        default=None,
        help="Optional output JSON file. Default: cache/<deck_id>/analysis-<date-range>.json",
    )

    args = parser.parse_args()
    _configure_logging(verbose=args.verbose)
    if args.command == "fetch":
        run_fetch(args)
    else:
        run_analyze(args)


def run_fetch(args: argparse.Namespace) -> None:
    moxfield_deck = fetch_moxfield_deck(args.moxfield_url, headless=not args.moxfield_headed)
    cache_dir = _cache_dir(Path(args.cache_root), moxfield_deck.deck_id)
    write_json(cache_dir / "moxfield_deck.json", moxfield_deck.to_dict())

    commander_query = " / ".join(moxfield_deck.commanders)
    if args.moxfield_only:
        print(f"Moxfield deck: {moxfield_deck.name} ({moxfield_deck.deck_id})")
        print(f"Moxfield commander: {commander_query}")
        print("MtgTop8 retrieval: skipped (--moxfield-only)")
        print(f"Cache directory: {cache_dir}")
        return

    mtgtop8 = MtgTop8Client(delay_seconds=args.delay_seconds)
    commander_entry = mtgtop8.find_commander_entry(moxfield_deck.commanders)
    cached_decks = mtgtop8.crawl_commander_decks(commander_entry.url, max_pages=args.max_pages)

    write_json(
        cache_dir / "mtgtop8_commander.json",
        {
            "moxfield_commander_query": commander_query,
            "name": commander_entry.name,
            "score": commander_entry.score,
            "url": commander_entry.url,
            "slug": slugify(commander_entry.name),
        },
    )
    write_json(
        cache_dir / "decks.json",
        {
            "deck_count": len(cached_decks),
            "decks": [deck.to_dict() for deck in cached_decks],
        },
    )

    print(f"Moxfield deck: {moxfield_deck.name} ({moxfield_deck.deck_id})")
    print(f"Moxfield commander: {commander_query}")
    print(f"MtgTop8 commander: {commander_entry.name} (score={commander_entry.score:.2f})")
    print(f"Cached decks: {len(cached_decks)}")
    print(f"Cache directory: {cache_dir}")


def run_analyze(args: argparse.Namespace) -> None:
    start = _optional_iso_date(args.start_date, "start-date")
    end = _optional_iso_date(args.end_date, "end-date")
    if start and end and start > end:
        raise ValueError("start-date must be <= end-date")

    cache_root = Path(args.cache_root)
    moxfield_deck, cache_dir = _load_cached_analysis_inputs(
        cache_root=cache_root,
        moxfield_url=args.moxfield_url,
        explicit_deck_id=args.deck_id,
    )
    decks_path = cache_dir / "decks.json"
    if not decks_path.exists():
        raise FileNotFoundError(f"Missing cache file: {decks_path}. Run fetch first.")

    payload = json.loads(decks_path.read_text(encoding="utf-8"))
    cached_decks = [_deck_record_from_dict(item) for item in payload.get("decks", [])]
    result = analyze_cards(
        moxfield_deck=moxfield_deck,
        cached_decks=cached_decks,
        start=start,
        end=end,
        keep_top=args.keep_top,
        cut_top=args.cut_top,
        add_top=args.add_top,
    )

    output_path = (
        Path(args.output_json)
        if args.output_json
        else _default_analysis_output_path(cache_dir, start=start, end=end)
    )
    write_json(output_path, result.to_dict())

    print(f"Analyzed decks in range {_format_date_range(start=start, end=end)}")
    print(f"Decks considered: {result.total_decks_considered}")
    print(f"Keep recommendations written: {len(result.keep)}")
    print(f"Cut recommendations written: {len(result.cut)}")
    print(f"To-add recommendations written: {len(result.to_add)}")
    print(f"Output: {output_path}")


def _require_iso_date(value: str, arg_name: str) -> date:
    parsed = parse_date(value)
    if parsed is None:
        raise ValueError(f"Invalid {arg_name}: {value}. Use YYYY-MM-DD")
    return parsed


def _optional_iso_date(value: str | None, arg_name: str) -> date | None:
    if value is None:
        return None
    return _require_iso_date(value, arg_name)


def _cache_dir(cache_root: Path, deck_id: str) -> Path:
    return cache_root / deck_id


def _load_moxfield_snapshot(
    *,
    cache_root: Path,
    deck_id: str,
) -> MoxfieldDeck:
    snapshot = _cache_dir(cache_root, deck_id) / "moxfield_deck.json"
    if not snapshot.exists():
        raise FileNotFoundError(f"Missing cache file: {snapshot}. Run fetch first.")
    payload = json.loads(snapshot.read_text(encoding="utf-8"))
    return MoxfieldDeck(
        deck_id=payload["deck_id"],
        name=payload["name"],
        url=payload["url"],
        commanders=list(payload.get("commanders", [])),
        cards={k: int(v) for k, v in payload.get("cards", {}).items()},
    )


def _load_cached_analysis_inputs(
    *,
    cache_root: Path,
    moxfield_url: str | None,
    explicit_deck_id: str | None,
) -> tuple[MoxfieldDeck, Path]:
    if explicit_deck_id and moxfield_url:
        url_deck_id = extract_deck_id(moxfield_url)
        if url_deck_id != explicit_deck_id:
            raise ValueError(
                f"--deck-id ({explicit_deck_id}) does not match deck id from --moxfield-url ({url_deck_id})"
            )

    deck_id: str | None = None
    if explicit_deck_id:
        deck_id = explicit_deck_id
    elif moxfield_url:
        deck_id = extract_deck_id(moxfield_url)
    else:
        deck_id = _discover_cached_deck_id(cache_root)

    if deck_id is None:
        raise FileNotFoundError(
            f"No cached deck found under {cache_root}. Run fetch first or pass --moxfield-url/--deck-id."
        )

    cache_dir = _cache_dir(cache_root, deck_id)
    moxfield_deck = _load_moxfield_snapshot(cache_root=cache_root, deck_id=deck_id)
    return moxfield_deck, cache_dir


def _discover_cached_deck_id(cache_root: Path) -> str | None:
    if not cache_root.exists() or not cache_root.is_dir():
        return None

    candidates: list[str] = []
    for entry in sorted(_iter_cache_dirs(cache_root)):
        if (entry / "moxfield_deck.json").exists():
            candidates.append(entry.name)

    if not candidates:
        return None
    if len(candidates) > 1:
        raise ValueError(
            "Multiple cached decks detected. Pass --moxfield-url or --deck-id to choose one: "
            + ", ".join(candidates)
        )
    return candidates[0]


def _iter_cache_dirs(cache_root: Path) -> Iterable[Path]:
    for child in cache_root.iterdir():
        if child.is_dir():
            yield child


def _default_analysis_output_path(cache_dir: Path, *, start: date | None, end: date | None) -> Path:
    if start and end:
        suffix = f"{start.isoformat()}-{end.isoformat()}"
    elif start and not end:
        suffix = f"from-{start.isoformat()}"
    elif end and not start:
        suffix = f"until-{end.isoformat()}"
    else:
        suffix = "all"
    return cache_dir / f"analysis-{suffix}.json"


def _format_date_range(*, start: date | None, end: date | None) -> str:
    if start and end:
        return f"{start.isoformat()} -> {end.isoformat()}"
    if start and not end:
        return f"{start.isoformat()} -> unbounded"
    if end and not start:
        return f"unbounded -> {end.isoformat()}"
    return "all dates"


def _deck_record_from_dict(payload: dict) -> DeckRecord:
    return DeckRecord(
        deck_name=str(payload.get("deck_name", "")),
        player=str(payload.get("player", "")),
        event=str(payload.get("event", "")),
        event_level=str(payload.get("event_level", "")),
        rank=str(payload.get("rank", "")),
        event_date=str(payload.get("event_date", "")),
        deck_url=str(payload.get("deck_url", "")),
        page_url=str(payload.get("page_url", "")),
        cards={k: int(v) for k, v in payload.get("cards", {}).items()},
        sections={
            section: {card: int(qty) for card, qty in cards.items()}
            for section, cards in payload.get("sections", {}).items()
            if isinstance(cards, dict)
        },
    )


def _configure_logging(*, verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


if __name__ == "__main__":
    main()
