import process from 'node:process';

import postgres from 'postgres';

function printHelp() {
  console.log(`
Purge MtgTop8 cache from PostgreSQL.

Usage:
  npm run db:purge:mtgtop8
  npm run db:purge:mtgtop8 -- --commander=<slug>

Examples:
  npm run db:purge:mtgtop8
  npm run db:purge:mtgtop8 -- --commander=phlage-titan-of-fires-fury
`);
}

function getCommanderArg(args) {
  const direct = args.find((arg) => arg.startsWith('--commander='));
  if (direct) {
    return direct.slice('--commander='.length).trim();
  }

  const idx = args.indexOf('--commander');
  if (idx >= 0) {
    return String(args[idx + 1] || '').trim();
  }

  return '';
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL_RW || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL_RW is required (or fallback DATABASE_URL)');
  process.exit(1);
}

const commanderSlug = getCommanderArg(args);
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  if (commanderSlug) {
    const { deletedDecks, deletedCommanders } = await sql.begin(async (tx) => {
      const deletedDecks = await tx`
        DELETE FROM mtgtop8_decks
        WHERE commander_slug = ${commanderSlug}
      `;
      const deletedCommanders = await tx`
        DELETE FROM mtgtop8_commanders
        WHERE slug = ${commanderSlug}
      `;
      return {
        deletedDecks: deletedDecks.count || 0,
        deletedCommanders: deletedCommanders.count || 0
      };
    });

    console.log(
      `Purged MtgTop8 cache for commander '${commanderSlug}': decks=${deletedDecks}, commanders=${deletedCommanders}`
    );
  } else {
    await sql.unsafe('TRUNCATE TABLE mtgtop8_decks, mtgtop8_commanders RESTART IDENTITY CASCADE');
    console.log('Purged all MtgTop8 cache tables: mtgtop8_decks + mtgtop8_commanders');
  }
} finally {
  await sql.end({ timeout: 5 });
}
