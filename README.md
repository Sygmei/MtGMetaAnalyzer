# MtGMetaAnalyzer

CLI project to:

1. Read a Moxfield deck URL.
2. Detect the Duel Commander commander(s) from Moxfield.
3. Find the commander archetype on MtgTop8 Duel Commander.
4. Force MtgTop8 period to `All Commander decks`.
5. Crawl all commander pages and cache each deck with metadata:
   - Player
   - Event
   - Event Level
   - Rank
   - Event Date
6. Analyze cached decks over a configurable date range to suggest:
   - cards to keep (most present in distinct decks)
   - cards to cut (least present in distinct decks)

## Install (`uv`)

```bash
uv sync
uv run playwright install chromium
```

## Usage

### 1) Fetch and cache MtgTop8 data

```bash
uv run mtg-meta fetch \
  --moxfield-url 'https://www.moxfield.com/decks/<deck_id>' \
  --cache-root cache
```

With verbose logs:

```bash
uv run mtg-meta -v fetch \
  --moxfield-url 'https://www.moxfield.com/decks/<deck_id>' \
  --cache-root cache
```

Optional:

- `--max-pages 3` to limit pagination during testing.
- `--delay-seconds 0.5` to slow down requests.
- `--moxfield-headed` to run Playwright with a visible browser window.
- `--moxfield-only` to only fetch/cache `moxfield_deck.json` and skip MtgTop8 retrieval.
- `-v` / `--verbose` for debug-level retrieval logs.

Cache output:

- `cache/<moxfield_deck_id>/moxfield_deck.json`
- `cache/<moxfield_deck_id>/mtgtop8_commander.json`
- `cache/<moxfield_deck_id>/decks.json`

### 2) Analyze keep/cut

```bash
uv run mtg-meta analyze \
  --moxfield-url 'https://www.moxfield.com/decks/<deck_id>' \
  --cache-root cache \
  --keep-top 20 \
  --cut-top 20
```

Notes:

- `analyze` is cache-only and works fully offline (no Moxfield/MtgTop8 requests).
- If `--moxfield-url` is omitted, the tool auto-selects the only cached deck under `--cache-root`.
- If multiple cached decks exist, pass either `--moxfield-url` or `--deck-id`.
- `--start-date` and `--end-date` are optional:
  - omit both: all cached dates
  - set only `--start-date`: from that date onward
  - set only `--end-date`: up to that date

Output:

- `cache/<moxfield_deck_id>/analysis-<date-range>.json`

## Notes

- MtgTop8 and Moxfield can change markup/API without notice. The implementation includes fallbacks but may need selector updates.
- Date parsing supports `DD/MM/YYYY`, `DD/MM/YY`, and `YYYY-MM-DD`.
- Analysis compares only Moxfield mainboard cards (commander excluded from keep/cut ranking).
- Moxfield retrieval is Playwright-only (no direct `requests` calls to Moxfield APIs).
- Commander and mainboard are extracted from the rendered deck page HTML (not only from network JSON payload shape).
- You can override user-agent with `MOXFIELD_USER_AGENT`.
- MtgTop8 commander discovery scans multiple Duel Commander URLs and reports scan diagnostics when no archetype list is found.
