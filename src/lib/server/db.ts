import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './db-schema';

let sqlClient: postgres.Sql | null = null;
let db:
  | ReturnType<typeof drizzle<typeof schema>>
  | null = null;

export function getDb() {
  if (db) {
    return db;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  sqlClient = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10
  });
  db = drizzle(sqlClient, { schema });

  return db;
}

export function getSqlClient(): postgres.Sql {
  if (sqlClient) {
    return sqlClient;
  }

  getDb();
  if (!sqlClient) {
    throw new Error('Failed to initialize SQL client');
  }
  return sqlClient;
}
