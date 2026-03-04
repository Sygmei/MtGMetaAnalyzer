#!/usr/bin/env bash
set -euo pipefail

echo "Running database migrations..."
node scripts/migrate.mjs

echo "Starting web server..."
exec node build
