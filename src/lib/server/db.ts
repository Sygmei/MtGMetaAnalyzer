import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './db-schema';

type DbHandle = ReturnType<typeof drizzle<typeof schema>>;

let writeSqlClient: postgres.Sql | null = null;
let writeDb:
  | ReturnType<typeof drizzle<typeof schema>>
  | null = null;
let readSqlClient: postgres.Sql | null = null;
let readDb:
  | ReturnType<typeof drizzle<typeof schema>>
  | null = null;

export function getWriteDb(): DbHandle {
  if (writeDb) {
    return writeDb;
  }

  const databaseUrl = resolveWriteDatabaseUrl();
  writeSqlClient = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });
  writeDb = drizzle(writeSqlClient, { schema });

  return writeDb;
}

export function getReadDb(): DbHandle {
  if (readDb) {
    return readDb;
  }

  const databaseUrl = resolveReadDatabaseUrl();
  readSqlClient = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });
  readDb = drizzle(readSqlClient, { schema });

  return readDb;
}

export function getDb(): DbHandle {
  return getWriteDb();
}

export function getSqlClient(): postgres.Sql {
  if (writeSqlClient) {
    return writeSqlClient;
  }

  getWriteDb();
  if (!writeSqlClient) {
    throw new Error('Failed to initialize write SQL client');
  }
  return writeSqlClient;
}

function resolveWriteDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL_RW?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL_RW is required (or fallback DATABASE_URL)');
  }
  return databaseUrl;
}

function resolveReadDatabaseUrl(): string {
  const databaseUrl =
    process.env.DATABASE_URL_RO?.trim() || process.env.DATABASE_URL_RW?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL_RO is required (or fallback DATABASE_URL_RW / DATABASE_URL)');
  }
  return databaseUrl;
}
