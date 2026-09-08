# Karton (SvelteKit + PostgreSQL)

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
OTEL_SERVICE_NAME=karton-web
OTEL_SERVICE_VERSION=0.1.0
OTEL_DEPLOYMENT_ENVIRONMENT=development
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=
OTEL_EXPORTER_OTLP_HEADERS=
OTEL_RESOURCE_ATTRIBUTES=
MYTHIC_TOOLS_API_KEY=
MYTHIC_TOOLS_WEB_KEY=
S3_ENDPOINT_URL=
S3_REGION_NAME=
S3_BUCKET_NAME=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

When `OTEL_ENABLED=true`, the app exports traces to `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` if set, otherwise `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`.
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_RESOURCE_ATTRIBUTES` accept comma-separated `key=value` pairs.

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

A Helm chart is available at `helm/`.

The chart deploys:

- a two-replica `karton` Deployment using rolling updates with `maxSurge: 0` and `maxUnavailable: 1`
- topology spread constraints so replicas prefer different nodes
- a ClusterIP Service on port `3000`
- an optional Traefik Ingress and HTTPS redirect Middleware
- TLS through cert-manager using the existing `ClusterIssuer` named `letsencrypt-prod`

The chart expects these existing secrets in the target namespace:

- `postgresql-credentials`
- `mythic-tools-credentials`
- `s3-creds`

Create the namespace:

```bash
kubectl create namespace karton
kubectl config set-context --current --namespace=karton
```

Create the database secret once in the target namespace:

```bash
kubectl create secret generic postgresql-credentials \
  --from-literal=connection-string='postgres://postgres:postgres@postgres:5432/mtg_meta_analyzer' \
  --from-literal=connection-string-ro='postgres://postgres:postgres@postgres:5432/mtg_meta_analyzer' \
  --from-literal=connection-string-admin='postgres://postgres:postgres@postgres:5432/mtg_meta_analyzer'
```

Create the Mythic Tools secret once in the target namespace:

```bash
kubectl create secret generic mythic-tools-credentials \
  --from-literal=api-key='your-api-key' \
  --from-literal=web-key='your-web-key'
```

Create the S3 secret once in the target namespace:

```bash
kubectl create secret generic s3-creds \
  --from-literal=endpoint-url='https://example.invalid' \
  --from-literal=region-name='fra1' \
  --from-literal=bucket-name='your-bucket' \
  --from-literal=access-key-id='your-access-key-id' \
  --from-literal=secret-key='your-secret-key'
```

Install or upgrade the bootstrap chart:

```bash
helm upgrade --install karton-bootstrap ./helm/bootstrap --namespace karton -f ./helm/values.yaml
```

Install or upgrade the application chart:

```bash
helm upgrade --install karton ./helm --namespace karton -f ./helm/values.yaml
```

Use a new immutable `version` tag for each deploy so image updates are deterministic.

## CI setup guide

Create a base64 encoded kubeconfig and store it as the `KUBECONFIG_B64` GitHub secret.

The bootstrap chart creates a namespace-local `ci-helm` service account, binds it to the `karton` namespace, and creates a long-lived token Secret named `ci-helm-token`.

```yaml
ci_access:
  enabled: true
  create_service_account: true
  service_account_name: ci-helm
  service_account_namespace: ""
  create_token_secret: true
  token_secret_name: ci-helm-token
```

After applying the bootstrap chart, generate the value with Nushell:

```bash
nu helm/scripts/generate-kubeconfig-b64.nu --server <SERVER_URL>
```

This prints the base64 encoded kubeconfig that you can paste as the value of the `KUBECONFIG_B64` GitHub secret.
If the token is empty immediately after creating the Secret, wait a few seconds and run the command again.

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


## Tournament leagues

The **Tournament** section (`/tournament`) is available to signed-in users. Admins and superadmins can create leagues, choose arbitrary start/end dates, manage Karton-user membership, and create events. All signed-in users can browse leagues and published results. Members also see their league rank, points, attendance, and event history.

### Scoring and standings

Each attendee receives `1 + floor(2.5 * log2(participants / rank))` points, where `participants` counts the event's actual attendees, not league members. Scores are integers, last place receives one point, and podium positions have distinct scores. Exact integer comparisons keep logarithm boundary cases stable. The formula is versioned as `log2-2.5-v1` on each event.

Admins can optionally record commanders for each event participant using Scryfall autocomplete. Selecting a card detects Partner (including named partners and groups such as Survivors / Friends forever), Choose a Background, and Doctor’s companion; a second input suggests compatible cards. Detection uses front-face Oracle text, so Companion and double-faced cards do not automatically add a second commander. Both names are stored together with `+` for compatibility with existing results. Lookup is debounced, cached, and rate-spaced through an authenticated admin endpoint; manual names and existing results remain saveable if Scryfall is unavailable. This records the cards played, without enforcing a format ban list or blocking historical pairings. Commanders appear with event results and personal event history, and corrections retain previous commander entries in the revision history. Historical results with no commander remain valid.

Admins enter unique, consecutive final placements starting at 1; blank players are absent and earn zero. At least two participants are required to publish. The preview and server use the same scoring function, and the server independently validates all input.

All published events contribute to league totals. Equal totals share a competition rank (for example, 1, 2, 2, 4). Draft results are visible only to admins and do not contribute. Corrections require a reason; each revision preserves the event details, placements, awarded points, actor, and reason. Unpublishing removes that event from totals. Publishing or correcting replaces the results transactionally, and stale submissions are rejected instead of overwriting another admin's work.

Removing a member prevents adding them to new events while preserving existing results. Deleting a Karton account preserves its league membership record and historical scores with a retained name. Archiving a league pauses membership/event editing and preserves its standings; admins can reopen it in settings. Date edits must still include all existing events. Leagues are independent: there is no annual reset or automatic carryover.

### Migration and verification

`migrations/0007_tournaments.sql` adds five tables for leagues, members, events, results, and revision history. `migrations/0008_tournament_commanders.sql` adds the optional commander field to event results. Run `npm run db:migrate` with `DATABASE_URL_ADMIN` before starting the updated app. The Docker entrypoint already runs migrations on startup.

Run scoring tests (using a Node version with native TypeScript support):

```bash
npm run test:tournament
npm run check
npm run build
```

Database and browser tests require an **isolated, migrated test database**. They create their own fixtures and remove those fixtures afterward. They are skipped unless their explicit test environment variables are set:

```bash
TEST_DATABASE_URL=postgres://localhost/karton_test npm run test:tournament:integration
```

For browser tests, start the app with both `DATABASE_URL_RW` and `DATABASE_URL_RO` pointing to that same test database, then run:

```bash
TEST_DATABASE_URL=postgres://localhost/karton_test \
TEST_BASE_URL=http://localhost:5173 \
npm run test:tournament:browser
```

Playwright Chromium must be installed, or set `TEST_BROWSER_CHANNEL=chrome` to use an installed Chrome. Set `TEST_SCREENSHOTS_DIR` to save desktop and mobile screenshots. Browser checks cover the admin workflow, player and non-member access, anonymous redirects, French labels, and narrow layouts.
