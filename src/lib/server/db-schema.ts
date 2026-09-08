import { sql } from 'drizzle-orm';
import { check, foreignKey, boolean, bigserial, date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
  (table) => [uniqueIndex('mtgtop8_commanders_commander_url_unique').on(table.commanderUrl)]
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
  (table) => [
    uniqueIndex('mtgtop8_decks_deck_url_unique').on(table.deckUrl),
    index('idx_mtgtop8_decks_commander_date').on(table.commanderSlug, table.eventDate),
    index('idx_mtgtop8_decks_commander_deck_url').on(table.commanderSlug, table.deckUrl)
  ]
);

export const analysisRuns = pgTable(
  'analysis_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    shareId: text('share_id').notNull(),
    moxfieldUrl: text('moxfield_url').notNull(),
    commanderName: text('commander_name'),
    ignoreBefore: date('ignore_before', { mode: 'string' }),
    ignoreAfter: date('ignore_after', { mode: 'string' }),
    clientIp: text('client_ip').notNull().default('unknown'),
    userId: text('user_id'),
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
  (table) => [
    uniqueIndex('analysis_runs_share_id_unique').on(table.shareId),
    index('idx_analysis_runs_user_created_at').on(table.userId, table.createdAt),
    index('idx_analysis_runs_created_at').on(table.createdAt)
  ]
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
  (table) => [index('idx_duel_commander_banlist_cache_fetched_at').on(table.fetchedAt)]
);

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    isSuperadmin: boolean('is_superadmin').notNull().default(false),
    role: text('role').notNull().default('user'),
    displayName: text('display_name'),
    createdByUserId: text('created_by_user_id')
  },
  (table) => [uniqueIndex('users_username_unique').on(table.username)]
);

export const userLoginLinks = pgTable(
  'user_login_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('user_login_links_token_unique').on(table.token),
    index('idx_user_login_links_user_id').on(table.userId)
  ]
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionToken: text('session_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('user_sessions_token_unique').on(table.sessionToken),
    index('idx_user_sessions_user_id').on(table.userId)
  ]
);

export const userCardLists = pgTable(
  'user_card_lists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    label: text('label'),
    url: text('url').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_user_card_lists_user_kind').on(table.userId, table.kind),
    index('idx_user_card_lists_kind').on(table.kind)
  ]
);


export const tournamentLeagues = pgTable('tournament_leagues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  endsOn: date('ends_on', { mode: 'string' }).notNull(),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [check('tournament_league_dates', sql`${table.endsOn} >= ${table.startsOn}`)]);

export const tournamentMembers = pgTable('tournament_members', {
  id: text('id').primaryKey(),
  leagueId: text('league_id').notNull().references(() => tournamentLeagues.id, { onDelete: 'restrict' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('tournament_members_league_id_user_id_key').on(table.leagueId, table.userId),
  uniqueIndex('tournament_members_league_id_id_key').on(table.leagueId, table.id)
]);

export const tournamentEvents = pgTable('tournament_events', {
  id: text('id').primaryKey(),
  leagueId: text('league_id').notNull().references(() => tournamentLeagues.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  eventDate: date('event_date', { mode: 'string' }).notNull(),
  status: text('status').$type<'draft' | 'published'>().notNull().default('draft'),
  revision: integer('revision').notNull().default(0),
  scoringVersion: text('scoring_version').notNull().default('log2-2.5-v1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('tournament_events_league_id_id_key').on(table.leagueId, table.id),
  index('tournament_events_league_date').on(table.leagueId, table.eventDate),
  check('tournament_events_status_check', sql`${table.status} in ('draft', 'published')`),
  check('tournament_events_revision_check', sql`${table.revision} >= 0`)
]);

export const tournamentResults = pgTable('tournament_results', {
  id: text('id').primaryKey(),
  leagueId: text('league_id').notNull(),
  eventId: text('event_id').notNull(),
  memberId: text('member_id').notNull(),
  rank: integer('rank').notNull(),
  points: integer('points').notNull(),
  commanders: text('commanders').notNull().default('')
}, (table) => [
  foreignKey({ columns: [table.leagueId, table.eventId], foreignColumns: [tournamentEvents.leagueId, tournamentEvents.id] }).onDelete('restrict'),
  foreignKey({ columns: [table.leagueId, table.memberId], foreignColumns: [tournamentMembers.leagueId, tournamentMembers.id] }).onDelete('restrict'),
  uniqueIndex('tournament_results_event_id_member_id_key').on(table.eventId, table.memberId),
  uniqueIndex('tournament_results_event_id_rank_key').on(table.eventId, table.rank),
  index('tournament_results_league').on(table.leagueId),
  check('tournament_results_rank_check', sql`${table.rank} > 0`),
  check('tournament_results_points_check', sql`${table.points} > 0`),
  check('tournament_results_commanders_length', sql`char_length(${table.commanders}) <= 300`)
]);

export type TournamentSnapshot = {
  name: string;
  eventDate: string;
  status: 'draft' | 'published';
  scoringVersion: string;
  results: { memberId: string; name: string; rank: number; points: number; commanders?: string }[];
};

export const tournamentEventHistory = pgTable('tournament_event_history', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull().references(() => tournamentEvents.id, { onDelete: 'restrict' }),
  revision: integer('revision').notNull(),
  actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actorName: text('actor_name').notNull(),
  reason: text('reason').notNull().default(''),
  snapshot: jsonb('snapshot').$type<TournamentSnapshot>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex('tournament_event_history_event_id_revision_key').on(table.eventId, table.revision)]);
