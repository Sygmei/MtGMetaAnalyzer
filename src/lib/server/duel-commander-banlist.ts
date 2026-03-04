import { load } from 'cheerio';
import { eq, sql } from 'drizzle-orm';

import { getDb } from './db';
import { duelCommanderBanlistCache } from './db-schema';
import { DEFAULT_USER_AGENT, normalizeName } from './utils';

const DEFAULT_BANLIST_URL = 'https://www.duelcommander.org/banlist/';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'deck_banned_cards_v1';

let inMemoryCache:
  | {
      fetchedAtMs: number;
      normalizedCards: Set<string>;
    }
  | null = null;

export async function getDuelCommanderDeckBannedCardsNormalized(): Promise<Set<string>> {
  const now = Date.now();
  if (inMemoryCache && now - inMemoryCache.fetchedAtMs <= CACHE_TTL_MS) {
    return new Set(inMemoryCache.normalizedCards);
  }

  const cached = await readCacheFromDb();
  if (cached && now - cached.fetchedAtMs <= CACHE_TTL_MS) {
    inMemoryCache = cached;
    return new Set(cached.normalizedCards);
  }

  try {
    const fresh = await fetchFreshBanlist();
    if (fresh.normalizedCards.size) {
      inMemoryCache = fresh;
      await writeCacheToDb(fresh);
      return new Set(fresh.normalizedCards);
    }
  } catch {
    // fall back to stale cache when remote fetch fails
  }

  if (cached) {
    inMemoryCache = cached;
    return new Set(cached.normalizedCards);
  }

  return new Set<string>();
}

async function fetchFreshBanlist(): Promise<{ fetchedAtMs: number; normalizedCards: Set<string>; sourceUrl: string }> {
  const sourceUrl = process.env.DUEL_COMMANDER_BANLIST_URL?.trim() || DEFAULT_BANLIST_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
        'accept-language': 'en-US,en;q=0.9'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Banlist fetch failed with status ${response.status}`);
    }

    const html = await response.text();
    const cards = parseDeckBannedCardsFromHtml(html);
    return {
      fetchedAtMs: Date.now(),
      normalizedCards: cards,
      sourceUrl
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseDeckBannedCardsFromHtml(html: string): Set<string> {
  const $ = load(html);
  const result = new Set<string>();
  const headings = $('h1, h2, h3, h4, h5, h6').toArray();

  for (const heading of headings) {
    const title = $(heading).text().replace(/\s+/g, ' ').trim();
    if (!isDeckBanSectionTitle(title)) {
      continue;
    }

    const sectionCards = extractCardsFromHeadingSection($, heading);
    for (const card of sectionCards) {
      result.add(card);
    }
  }

  return result;
}

function isDeckBanSectionTitle(title: string): boolean {
  const normalized = title.toLowerCase();

  if (!normalized.includes('banned')) {
    return false;
  }

  if (
    normalized.includes('as commander') ||
    normalized.includes('as a commander') ||
    normalized.includes('commander only') ||
    normalized.includes('banned commander') ||
    normalized.includes('companion')
  ) {
    return false;
  }

  return (
    normalized.includes('in deck') ||
    normalized.includes('banned cards') ||
    normalized.includes('offensive cards') ||
    normalized.includes('banned by rules') ||
    normalized.includes('duel commander')
  );
}

function extractCardsFromHeadingSection($: ReturnType<typeof load>, heading: any): Set<string> {
  const cards = new Set<string>();
  const headingLevel = heading.tagName?.startsWith('h') ? Number(heading.tagName.slice(1)) : 6;
  let cursor = $(heading).next();

  while (cursor.length) {
    if (cursor.is('h1, h2, h3, h4, h5, h6')) {
      const currentTag = cursor.get(0)?.tagName || '';
      const currentLevel = currentTag.startsWith('h') ? Number(currentTag.slice(1)) : 6;
      if (currentLevel <= headingLevel) {
        break;
      }
    }

    for (const card of extractCardsFromNode($, cursor)) {
      cards.add(card);
    }
    cursor = cursor.next();
  }

  return cards;
}

function extractCardsFromNode($: ReturnType<typeof load>, node: any): Set<string> {
  const cards = new Set<string>();

  node.find('a[href*="scryfall"], a[href*="/card"], a[href*="/cards"]').each((_: any, anchor: any) => {
    const name = cleanCandidate($(anchor).text());
    if (isLikelyCardName(name)) {
      cards.add(normalizeName(name));
    }
  });

  node.find('li').each((_: any, li: any) => {
    for (const candidate of splitCandidates($(li).text())) {
      if (isLikelyCardName(candidate)) {
        cards.add(normalizeName(candidate));
      }
    }
  });

  if (!cards.size) {
    for (const candidate of splitCandidates(node.text())) {
      if (isLikelyCardName(candidate)) {
        cards.add(normalizeName(candidate));
      }
    }
  }

  cards.delete('');
  return cards;
}

function splitCandidates(raw: string): string[] {
  return raw
    .split(/[\n\r\t,•]+/)
    .map((value) => cleanCandidate(value))
    .filter(Boolean);
}

function cleanCandidate(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:\s]+/, '')
    .replace(/[-–—:\s]+$/, '')
    .trim();
}

function isLikelyCardName(value: string): boolean {
  if (!value || value.length < 2 || value.length > 90) {
    return false;
  }

  const lower = value.toLowerCase();
  const blockedFragments = [
    'banned',
    'duel commander',
    'updated',
    'last update',
    'offensive cards',
    'banned by rules',
    'latest',
    'share this',
    'all rights reserved'
  ];
  if (blockedFragments.some((fragment) => lower.includes(fragment))) {
    return false;
  }

  return /[a-z]/i.test(value);
}

async function readCacheFromDb(): Promise<{ fetchedAtMs: number; normalizedCards: Set<string>; sourceUrl: string } | null> {
  const db = getDb();
  const rows = await db
    .select({
      sourceUrl: duelCommanderBanlistCache.sourceUrl,
      fetchedAt: duelCommanderBanlistCache.fetchedAt,
      cardsJson: duelCommanderBanlistCache.cardsJson
    })
    .from(duelCommanderBanlistCache)
    .where(eq(duelCommanderBanlistCache.key, CACHE_KEY))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const fetchedAtMs = toEpochMs(row.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) {
    return null;
  }

  return {
    fetchedAtMs,
    sourceUrl: row.sourceUrl || DEFAULT_BANLIST_URL,
    normalizedCards: new Set(parseCachedCards(row.cardsJson))
  };
}

async function writeCacheToDb(cache: { fetchedAtMs: number; normalizedCards: Set<string>; sourceUrl: string }): Promise<void> {
  const db = getDb();
  const cards = [...cache.normalizedCards].sort();

  await db
    .insert(duelCommanderBanlistCache)
    .values({
      key: CACHE_KEY,
      sourceUrl: cache.sourceUrl,
      cardsJson: cards,
      fetchedAt: new Date(cache.fetchedAtMs),
      updatedAt: sql`NOW()`
    })
    .onConflictDoUpdate({
      target: duelCommanderBanlistCache.key,
      set: {
        sourceUrl: cache.sourceUrl,
        cardsJson: cards,
        fetchedAt: new Date(cache.fetchedAtMs),
        updatedAt: sql`NOW()`
      }
    });
}

function parseCachedCards(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => normalizeName(String(entry))).filter(Boolean);
}

function toEpochMs(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
