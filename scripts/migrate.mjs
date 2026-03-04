import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import process from 'node:process';

import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL_ADMIN is required (or fallback DATABASE_URL)');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
const TRACKING_TABLE = 'app_schema_migrations';

try {
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const migrationDir = join(process.cwd(), 'migrations');
  const files = (await readdir(migrationDir))
    .filter((name) => extname(name) === '.sql')
    .sort();

  const appliedRows = await sql.unsafe(`SELECT id FROM ${TRACKING_TABLE}`);
  const applied = new Set(appliedRows.map((row) => String(row.id)));

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const content = await readFile(join(migrationDir, file), 'utf-8');
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx.unsafe(`INSERT INTO ${TRACKING_TABLE} (id) VALUES ($1)`, [file]);
    });

    console.log(`Applied migration: ${file}`);
  }

  console.log('Migrations complete');
} finally {
  await sql.end({ timeout: 5 });
}
