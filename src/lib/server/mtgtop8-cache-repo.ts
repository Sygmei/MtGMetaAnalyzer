import { desc, eq, sql } from 'drizzle-orm';

import { mtgtop8Commanders, mtgtop8Decks } from './db-schema';
import { getReadDb, getWriteDb } from './db';
import type { DeckRecord } from './types';
import { formatDate, parseDate } from './utils';

interface CommanderCacheInput {
  slug: string;
  commanderName: string;
  commanderUrl: string;
  moxfieldCommanderQuery: string;
  score: number;
}

export async function upsertCommanderCache(input: CommanderCacheInput): Promise<void> {
  const db = getWriteDb();

  await db
    .insert(mtgtop8Commanders)
    .values({
      slug: input.slug,
      commanderName: input.commanderName,
      commanderUrl: input.commanderUrl,
      moxfieldCommanderQuery: input.moxfieldCommanderQuery,
      matchScore: input.score,
      updatedAt: sql`NOW()`
    })
    .onConflictDoUpdate({
      target: mtgtop8Commanders.slug,
      set: {
        commanderName: input.commanderName,
        commanderUrl: input.commanderUrl,
        moxfieldCommanderQuery: input.moxfieldCommanderQuery,
        matchScore: input.score,
        updatedAt: sql`NOW()`
      }
    });
}

export async function getLatestCachedEventDate(commanderSlug: string): Promise<Date | null> {
  const db = getReadDb();

  const rows = await db
    .select({
      latest: sql<string | null>`MAX(${mtgtop8Decks.eventDate})`
    })
    .from(mtgtop8Decks)
    .where(eq(mtgtop8Decks.commanderSlug, commanderSlug));

  const latest = rows[0]?.latest ?? null;
  if (!latest) {
    return null;
  }
  return parseDate(String(latest));
}

export async function insertDecksForCommander(
  commanderSlug: string,
  decks: DeckRecord[]
): Promise<number> {
  if (!decks.length) {
    return 0;
  }

  const db = getWriteDb();
  let inserted = 0;

  await db.transaction(async (tx) => {
    for (const deck of decks) {
      const parsedDate = parseDate(deck.eventDate);
      if (!parsedDate) {
        continue;
      }

      const result = await tx
        .insert(mtgtop8Decks)
        .values({
          commanderSlug,
          deckUrl: deck.deckUrl,
          pageUrl: deck.pageUrl,
          deckName: deck.deckName,
          playerName: deck.player,
          eventName: deck.event,
          eventLevel: deck.eventLevel,
          deckRank: deck.rank,
          eventDate: formatDate(parsedDate),
          eventDateRaw: deck.eventDate,
          cardsJson: deck.cards,
          sectionsJson: deck.sections,
          updatedAt: sql`NOW()`
        })
        .onConflictDoNothing({ target: mtgtop8Decks.deckUrl })
        .returning({ id: mtgtop8Decks.id });

      if (result.length > 0) {
        inserted += 1;
      }
    }
  });

  return inserted;
}

export async function loadDecksForCommander(commanderSlug: string): Promise<DeckRecord[]> {
  const db = getReadDb();

  const rows = await db
    .select({
      deckName: mtgtop8Decks.deckName,
      playerName: mtgtop8Decks.playerName,
      eventName: mtgtop8Decks.eventName,
      eventLevel: mtgtop8Decks.eventLevel,
      deckRank: mtgtop8Decks.deckRank,
      eventDateRaw: mtgtop8Decks.eventDateRaw,
      deckUrl: mtgtop8Decks.deckUrl,
      pageUrl: mtgtop8Decks.pageUrl,
      cardsJson: mtgtop8Decks.cardsJson,
      sectionsJson: mtgtop8Decks.sectionsJson
    })
    .from(mtgtop8Decks)
    .where(eq(mtgtop8Decks.commanderSlug, commanderSlug))
    .orderBy(desc(mtgtop8Decks.eventDate), desc(mtgtop8Decks.id));

  return rows.map((row) => ({
    deckName: row.deckName,
    player: row.playerName,
    event: row.eventName,
    eventLevel: row.eventLevel,
    rank: row.deckRank,
    eventDate: row.eventDateRaw,
    deckUrl: row.deckUrl,
    pageUrl: row.pageUrl,
    cards: parseCardMap(row.cardsJson),
    sections: parseSections(row.sectionsJson)
  }));
}

function parseCardMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const parsed: Record<string, number> = {};
  for (const [name, qty] of Object.entries(value as Record<string, unknown>)) {
    parsed[name] = safeInt(qty);
  }
  return parsed;
}

function parseSections(value: unknown): Record<string, Record<string, number>> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const parsed: Record<string, Record<string, number>> = {};
  for (const [section, sectionCards] of Object.entries(value as Record<string, unknown>)) {
    if (!sectionCards || typeof sectionCards !== 'object') {
      continue;
    }
    parsed[section] = parseCardMap(sectionCards);
  }
  return parsed;
}

function safeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.trunc(parsed);
}
