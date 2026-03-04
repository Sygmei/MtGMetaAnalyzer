import { bigserial, date, doublePrecision, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AnalyzeOutput } from './types';

export const mtgtop8Commanders = pgTable(
  'mtgtop8_commanders',
  {
    slug: text('slug').primaryKey(),
    commanderName: text('commander_name').notNull(),
    commanderUrl: text('commander_url').notNull(),
    moxfieldCommanderQuery: text('moxfield_commander_query').notNull(),
    matchScore: doublePrecision('match_score').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    commanderUrlUnique: uniqueIndex('mtgtop8_commanders_commander_url_unique').on(table.commanderUrl)
  })
);

export const mtgtop8Decks = pgTable(
  'mtgtop8_decks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    commanderSlug: text('commander_slug')
      .notNull()
      .references(() => mtgtop8Commanders.slug, { onDelete: 'cascade' }),
    deckUrl: text('deck_url').notNull(),
    pageUrl: text('page_url').notNull(),
    deckName: text('deck_name').notNull(),
    playerName: text('player_name').notNull(),
    eventName: text('event_name').notNull(),
    eventLevel: text('event_level').notNull(),
    deckRank: text('deck_rank').notNull(),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    eventDateRaw: text('event_date_raw').notNull(),
    cardsJson: jsonb('cards_json').$type<Record<string, number>>().notNull(),
    sectionsJson: jsonb('sections_json').$type<Record<string, Record<string, number>>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    deckUrlUnique: uniqueIndex('mtgtop8_decks_deck_url_unique').on(table.deckUrl),
    commanderDateIdx: index('idx_mtgtop8_decks_commander_date').on(table.commanderSlug, table.eventDate),
    commanderDeckUrlIdx: index('idx_mtgtop8_decks_commander_deck_url').on(table.commanderSlug, table.deckUrl)
  })
);

export const analysisRuns = pgTable(
  'analysis_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    shareId: text('share_id').notNull(),
    moxfieldUrl: text('moxfield_url').notNull(),
    clientIp: text('client_ip').notNull().default('unknown'),
    traceId: text('trace_id'),
    payloadJson: jsonb('payload_json').$type<AnalyzeOutput>().notNull(),
    inputJson: jsonb('input_json')
      .$type<{
        startDate: string;
        endDate: string;
        keepTop: string;
        cutTop: string;
        addTop: string;
      }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    shareIdUnique: uniqueIndex('analysis_runs_share_id_unique').on(table.shareId),
    createdAtIdx: index('idx_analysis_runs_created_at').on(table.createdAt)
  })
);

export const duelCommanderBanlistCache = pgTable(
  'duel_commander_banlist_cache',
  {
    key: text('key').primaryKey(),
    sourceUrl: text('source_url').notNull(),
    cardsJson: jsonb('cards_json').$type<string[]>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    fetchedAtIdx: index('idx_duel_commander_banlist_cache_fetched_at').on(table.fetchedAt)
  })
);
