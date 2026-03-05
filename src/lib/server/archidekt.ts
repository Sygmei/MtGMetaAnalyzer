import { AppError } from './app-error';
import type { CardMap, InputDeck } from './types';
import { DEFAULT_USER_AGENT, normalizeName } from './utils';

interface FetchArchidektOptions {
  timeoutMs?: number;
}

const ARCHIDEKT_ALLOWED_HOSTS = new Set(['archidekt.com', 'www.archidekt.com']);
const ARCHIDEKT_API_BASE = 'https://archidekt.com/api/decks';

export function normalizeArchidektDeckUrl(value: string): string {
  const input = String(value || '').trim();
  if (!input) {
    throw new AppError({
      userFacingError: 'Deck URL is required.',
      adminFacingError: 'Archidekt URL is empty.',
      errorTypeName: 'ArchidektUrlMissingError',
      httpStatusCode: 400
    });
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new AppError({
      userFacingError: 'Invalid Archidekt URL. Use archidekt.com/decks/<id>.',
      adminFacingError: `Invalid Archidekt URL parse failure: ${value}`,
      errorTypeName: 'ArchidektUrlInvalidError',
      httpStatusCode: 400
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (!ARCHIDEKT_ALLOWED_HOSTS.has(host)) {
    throw new AppError({
      userFacingError: 'Invalid Archidekt URL host. Use archidekt.com.',
      adminFacingError: `Invalid Archidekt host: ${parsed.hostname}`,
      errorTypeName: 'ArchidektHostInvalidError',
      httpStatusCode: 400
    });
  }

  const deckId = extractDeckIdFromPath(parsed.pathname, value);
  return `https://archidekt.com/decks/${deckId}`;
}

export function extractArchidektDeckId(deckUrl: string): string {
  const normalized = normalizeArchidektDeckUrl(deckUrl);
  return extractDeckIdFromPath(new URL(normalized).pathname, normalized);
}

export async function fetchArchidektDeck(deckUrl: string, options: FetchArchidektOptions = {}): Promise<InputDeck> {
  const normalizedDeckUrl = normalizeArchidektDeckUrl(deckUrl);
  const deckId = extractArchidektDeckId(normalizedDeckUrl);
  const timeoutMs = options.timeoutMs ?? 20_000;

  const payload = await fetchArchidektPayload(deckId, timeoutMs);
  const parsed = parseArchidektDeckPayload(payload, {
    deckId,
    normalizedDeckUrl
  });

  if (!parsed.commanders.length) {
    throw new AppError({
      userFacingError: 'Could not detect a commander in this Archidekt deck.',
      adminFacingError: `Commander detection failed for Archidekt deck ${deckId}`,
      errorTypeName: 'ArchidektCommanderMissingError',
      httpStatusCode: 422
    });
  }

  return {
    source: 'archidekt',
    deckId,
    name: parsed.name,
    url: normalizedDeckUrl,
    commanders: parsed.commanders,
    cards: parsed.cards
  };
}

async function fetchArchidektPayload(deckId: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const endpoints = [`${ARCHIDEKT_API_BASE}/${deckId}/`, `${ARCHIDEKT_API_BASE}/${deckId}/small/`, `${ARCHIDEKT_API_BASE}/${deckId}`];
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'user-agent': process.env.MOXFIELD_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
          accept: 'application/json'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        failures.push(`${endpoint} status=${response.status}`);
        continue;
      }
      const payload = (await response.json()) as unknown;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return payload as Record<string, unknown>;
      }
      failures.push(`${endpoint} invalid_json_shape`);
    } catch (error) {
      failures.push(`${endpoint} error=${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new AppError({
    userFacingError: 'Could not fetch this Archidekt deck. Verify the URL and that the deck is publicly accessible.',
    adminFacingError: `Archidekt API fetch failed for deck=${deckId}. attempts=${failures.join(' | ')}`,
    errorTypeName: 'ArchidektDeckFetchError',
    httpStatusCode: 422
  });
}

function parseArchidektDeckPayload(
  payload: Record<string, unknown>,
  context: { deckId: string; normalizedDeckUrl: string }
): {
  name: string;
  commanders: string[];
  cards: CardMap;
} {
  const name = String(payload.name || payload.title || `Archidekt Deck ${context.deckId}`).trim();
  const entries = extractDeckEntries(payload);

  const cards: CardMap = {};
  const commanders: string[] = [];
  const commanderSeen = new Set<string>();

  for (const entry of entries) {
    const quantity = extractQuantity(entry);
    const cardName = extractCardName(entry);
    if (!cardName || quantity <= 0) {
      continue;
    }
    const categories = extractCategories(entry);
    if (isExcludedEntry(categories)) {
      continue;
    }

    cards[cardName] = (cards[cardName] || 0) + quantity;
    if (isCommanderEntry(categories) && !commanderSeen.has(cardName)) {
      commanderSeen.add(cardName);
      commanders.push(cardName);
    }
  }

  if (!commanders.length) {
    for (const fallback of extractFallbackCommanders(payload)) {
      if (!commanderSeen.has(fallback)) {
        commanderSeen.add(fallback);
        commanders.push(fallback);
      }
    }
  }

  if (!Object.keys(cards).length) {
    throw new AppError({
      userFacingError: 'Could not extract cards from this Archidekt deck.',
      adminFacingError: `No card entries parsed for Archidekt deck ${context.deckId} (${context.normalizedDeckUrl})`,
      errorTypeName: 'ArchidektDeckCardsMissingError',
      httpStatusCode: 422
    });
  }

  return { name, commanders, cards };
}

function extractDeckEntries(payload: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [payload.cards, payload.deckCards, payload.cardMap, payload.entries];
  for (const candidate of candidates) {
    const items = asEntryList(candidate);
    if (items.length) {
      return items;
    }
  }
  return [];
}

function asEntryList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).filter(isRecord);
  }
  return [];
}

function extractQuantity(entry: Record<string, unknown>): number {
  const values = [entry.quantity, entry.qty, entry.count, entry.copies];
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }
  return 0;
}

function extractCardName(entry: Record<string, unknown>): string {
  const candidates = [
    getNested(entry, ['card', 'oracleCard', 'name']),
    getNested(entry, ['card', 'name']),
    getNested(entry, ['oracleCard', 'name']),
    entry.name,
    entry.cardName
  ];

  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name) {
      return name;
    }
  }
  return '';
}

function extractCategories(entry: Record<string, unknown>): string[] {
  const raw = entry.categories ?? entry.category ?? entry.groups;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        if (item && typeof item === 'object') {
          const map = item as Record<string, unknown>;
          return String(map.name || map.label || map.category || '').trim();
        }
        return '';
      })
      .filter(Boolean);
  }

  if (raw && typeof raw === 'object') {
    return Object.values(raw)
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  return [];
}

function isCommanderEntry(categories: string[]): boolean {
  return categories.some((category) => normalizeName(category).includes('commander'));
}

function isExcludedEntry(categories: string[]): boolean {
  if (!categories.length) {
    return false;
  }
  const excluded = new Set(['maybeboard', 'sideboard', 'acquireboard', 'wishlist', 'tokens', 'token']);
  return categories.some((category) => excluded.has(normalizeName(category)));
}

function extractFallbackCommanders(payload: Record<string, unknown>): string[] {
  const fallback: string[] = [];
  const candidates = [payload.commander, payload.commanders];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const name = candidate.trim();
      if (name) {
        fallback.push(name);
      }
      continue;
    }
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const map = candidate as Record<string, unknown>;
      const direct = String(map.name || map.commander || '').trim();
      if (direct) {
        fallback.push(direct);
      }
      continue;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const name = typeof item === 'string' ? item : String((item as Record<string, unknown>)?.name || '');
        if (name.trim()) {
          fallback.push(name.trim());
        }
      }
    }
  }
  return fallback;
}

function extractDeckIdFromPath(pathname: string, rawInput: string): string {
  const match = /^\/decks\/(\d+)/.exec(pathname);
  if (!match?.[1]) {
    throw new AppError({
      userFacingError: 'Invalid Archidekt URL. Use archidekt.com/decks/<id>.',
      adminFacingError: `Could not parse Archidekt deck id from: ${rawInput}`,
      errorTypeName: 'ArchidektDeckIdParseError',
      httpStatusCode: 400
    });
  }
  return match[1];
}

function getNested(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
