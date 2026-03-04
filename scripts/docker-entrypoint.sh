#!/usr/bin/env bash
set -euo pipefail

MIGRATE_MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-30}"
MIGRATE_RETRY_DELAY_SECONDS="${MIGRATE_RETRY_DELAY_SECONDS:-2}"

echo "Running database migrations..."
attempt=1
while true; do
  if node scripts/migrate.mjs; then
    break
  fi

  if [ "$attempt" -ge "$MIGRATE_MAX_ATTEMPTS" ]; then
    echo "Migration failed after ${attempt} attempt(s). Exiting."
    exit 1
  fi

  echo "Migration attempt ${attempt} failed. Retrying in ${MIGRATE_RETRY_DELAY_SECONDS}s..."
  attempt=$((attempt + 1))
  sleep "$MIGRATE_RETRY_DELAY_SECONDS"
done

echo "Starting web server..."
exec node build
