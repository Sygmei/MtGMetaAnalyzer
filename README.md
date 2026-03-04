# MtG Meta Analyzer (SvelteKit + PostgreSQL)

Web app to analyze a Duel Commander Moxfield deck against MtgTop8 data.

## What it does

1. You paste a Moxfield deck URL.
2. Server-side Playwright always fetches commander and decklist from Moxfield.
3. App finds the matching Duel Commander archetype on MtgTop8.
4. App checks PostgreSQL cache for that commander and finds the most recent cached event date.
5. App crawls MtgTop8 and fetches only decks newer than that cached date.
6. New decks are stored in PostgreSQL.
7. App analyzes your deck against cached MtgTop8 decks and returns:
   - cards to keep (most present in other decks)
   - cards to cut (least present in other decks)
   - cards to add (missing in your deck but common in other decks)

## Stack

- SvelteKit (frontend + backend)
- TypeScript
- PostgreSQL
- Drizzle ORM
- Playwright (Moxfield extraction)
- Cheerio (HTML parsing)

## Environment

Create `.env` with:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/mtg_meta_analyzer
```

## Setup

```bash
npm install
npx playwright install chromium
npm run db:migrate
# optional when schema changes:
# npm run db:generate
```

## Run

```bash
npm run dev
```

Open the local URL shown by Vite (usually `http://localhost:5173`).

## Build

```bash
npm run check
npm run build
npm run preview
```

## Database schema

Migrations are in `migrations/` and are applied by:

```bash
npm run db:migrate
```

Main tables:

- `mtgtop8_commanders`
- `mtgtop8_decks`
- `schema_migrations`

## Cache behavior

- Moxfield decks are never cached.
- MtgTop8 decks are cached in PostgreSQL.
- Incremental updates are date-based per commander (newer-than-latest-cached).
- `Refresh MtgTop8 cache` in UI forces a full crawl pass (deduped by `deck_url`).

## Notes

- Moxfield extraction is Playwright-only.
- MtgTop8 and Moxfield markup can change; selectors may need updates over time.
- Existing Python implementation remains in `src/mtg_meta_analyzer` as legacy reference.
