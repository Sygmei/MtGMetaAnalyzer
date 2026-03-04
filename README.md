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
DATABASE_URL_RW=postgres://postgres:postgres@localhost:5432/mtg_meta_analyzer
DATABASE_URL_RO=postgres://postgres:postgres@localhost:5432/mtg_meta_analyzer
DATABASE_URL_ADMIN=postgres://postgres:postgres@localhost:5432/mtg_meta_analyzer
OTEL_ENABLED=false
OTEL_SERVICE_NAME=mtg-meta-analyzer-web
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
PUBLIC_FARO_ENABLED=false
PUBLIC_FARO_URL=
PUBLIC_FARO_APP_NAME=mtg-meta-analyzer-web
PUBLIC_FARO_APP_VERSION=0.1.0
```

When `OTEL_ENABLED=true`, the app exports traces to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`.
When `PUBLIC_FARO_ENABLED=true`, browser telemetry is sent to `PUBLIC_FARO_URL`.

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

## Helm chart

A Helm chart is available at `helm/mtg-meta-analyzer`.

The chart is intentionally minimal and uses only two values:

- `replicaCount`
- `version` (container image tag for `mtg-meta-analyzer-web`)

It always creates an Ingress with:

- `/` routed to service port `80`
- `/progress` routed to service port `3210`
- TLS from cert-manager using an existing `ClusterIssuer` (`letsencrypt-prod` in template)

If your domain or ClusterIssuer name differs, edit:

- `helm/mtg-meta-analyzer/templates/ingress.yaml`

The chart expects an existing secret named `postgresql-credentials` with:

- `connection-string` (RW pooler)
- `connection-string-ro` (RO pooler)
- `connection-string-admin` (direct admin, used for migrations only)

Example:

```bash
kubectl -n mtg-meta-analyzer create secret generic postgresql-credentials \
  --from-literal=connection-string='postgres://postgres:postgres@postgres:5432/mtg_meta_analyzer' \
  --from-literal=connection-string-ro='postgres://postgres:postgres@postgres:5432/mtg_meta_analyzer' \
  --from-literal=connection-string-admin='postgres://postgres:postgres@postgres:5432/mtg_meta_analyzer'
```

Install:

```bash
helm upgrade --install mtg-meta-analyzer ./helm/mtg-meta-analyzer \
  --namespace mtg-meta-analyzer --create-namespace \
  --set version=1.2.0 \
  --set replicaCount=1
```

Use a new immutable `version` tag for each deploy (do not keep `latest`) so image updates are deterministic.

## Database schema

Migrations are in `migrations/` and are applied by:

```bash
npm run db:migrate
```

Purge MtgTop8 cache:

```bash
# purge all MtgTop8 cached commanders + decks
npm run db:purge:mtgtop8

# purge cache for one commander slug only
npm run db:purge:mtgtop8 -- --commander=phlage-titan-of-fires-fury
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
