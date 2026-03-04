// @ts-nocheck
import { load } from 'cheerio';
import { chromium } from 'playwright';

import type { CardMap, MoxfieldDeck } from './types';
import { DEFAULT_USER_AGENT, normalizeName } from './utils';

interface FetchMoxfieldOptions {
  timeoutMs?: number;
  headless?: boolean;
}

const SCRYFALL_NAMED_FUZZY_URL = 'https://api.scryfall.com/cards/named';
const SCRYFALL_TIMEOUT_MS = 8_000;
const scryfallNameCache = new Map<string, string>();
const MOXFIELD_ALLOWED_HOSTS = new Set(['moxfield.com', 'www.moxfield.com']);

export function extractDeckId(moxfieldUrl: string): string {
  const normalized = normalizeMoxfieldDeckUrl(moxfieldUrl);
  const pathname = new URL(normalized).pathname;
  const match = /^\/decks\/([A-Za-z0-9_-]+)/.exec(pathname);
  if (!match?.[1]) {
    throw new Error(`Could not parse Moxfield deck id from: ${normalized}`);
  }
  return match[1];
}

export function normalizeMoxfieldDeckUrl(value: string): string {
  const input = String(value || '').trim();
  if (!input) {
    throw new Error('Moxfield URL is required');
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`Invalid Moxfield URL: ${value}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (!MOXFIELD_ALLOWED_HOSTS.has(host)) {
    throw new Error(`Invalid Moxfield host: ${parsed.hostname}`);
  }

  const match = /^\/decks\/([A-Za-z0-9_-]+)/.exec(parsed.pathname);
  if (!match?.[1]) {
    throw new Error(`Could not parse Moxfield deck id from: ${value}`);
  }

  return `https://moxfield.com/decks/${match[1]}`;
}

export async function fetchMoxfieldDeck(
  moxfieldUrl: string,
  options: FetchMoxfieldOptions = {}
): Promise<MoxfieldDeck> {
  const normalizedMoxfieldUrl = normalizeMoxfieldDeckUrl(moxfieldUrl);
  const deckId = extractDeckId(normalizedMoxfieldUrl);
  const timeoutMs = options.timeoutMs ?? 25_000;
  const headless = options.headless ?? true;

  let networkPayload: Record<string, unknown> | null = null;
  let pageHtml = '';

  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      userAgent: process.env.MOXFIELD_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
      locale: 'en-US'
    });
    const page = await context.newPage();

    page.on('response', async (response) => {
      const url = response.url().toLowerCase();
      if (!url.includes('/decks/all/') || !url.includes('moxfield.com')) {
        return;
      }
      if (response.status() !== 200) {
        return;
      }
      try {
        const payload = (await response.json()) as unknown;
        const extracted = extractDeckPayloadFromTree(payload);
        if (extracted) {
          networkPayload = extracted;
        }
      } catch {
        // ignore noisy response parse errors
      }
    });

    await page.goto(normalizedMoxfieldUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => null);
    pageHtml = await page.content();

    await context.close();
  } finally {
    await browser.close();
  }

  const domPayload = extractDeckPayloadFromDomHtml(pageHtml, deckId);
  const nextDataPayload = extractDeckPayloadFromHtml(pageHtml);

  let payload = networkPayload;
  if (payload && domPayload) {
    payload = mergeDeckPayload(payload, domPayload);
  } else if (!payload) {
    payload = nextDataPayload;
    if (payload && domPayload) {
      payload = mergeDeckPayload(payload, domPayload);
    } else if (!payload) {
      payload = domPayload;
    }
  }

  if (!payload) {
    throw new Error(`Unable to fetch Moxfield deck ${deckId}: Playwright extraction failed`);
  }

  const commanders = extractCommanders(payload);
  if (!commanders.length) {
    throw new Error('Could not detect commander from Moxfield deck payload');
  }

  const cards = extractCards(getMainboardPayload(payload));
  const normalizedDeck = await normalizeMoxfieldDeckNames({
    deckId,
    name: String(payload.name || deckId),
    url: normalizedMoxfieldUrl,
    commanders,
    cards
  }, pageHtml);

  return normalizedDeck;
}

async function normalizeMoxfieldDeckNames(deck: MoxfieldDeck, html: string): Promise<MoxfieldDeck> {
  if (!html.trim()) {
    return deck;
  }

  const aliases = await buildCanonicalAliasMapFromHtml(html);
  if (!aliases.size) {
    return deck;
  }

  let commanderRenamed = 0;
  const commanders = dedupePreserveOrder(
    deck.commanders
      .map((name) => {
        const canonical = aliases.get(normalizeName(name)) || name;
        if (canonical !== name) {
          commanderRenamed += 1;
        }
        return canonical;
      })
      .filter(Boolean)
  );

  const cards: CardMap = {};
  let cardRenamed = 0;
  for (const [rawName, quantity] of Object.entries(deck.cards)) {
    const normalized = normalizeName(rawName);
    const canonicalName = aliases.get(normalized) || rawName;
    if (canonicalName !== rawName) {
      cardRenamed += 1;
    }
    cards[canonicalName] = (cards[canonicalName] || 0) + quantity;
  }

  if (cardRenamed || commanderRenamed) {
    console.info(
      `Moxfield: normalized flavor names aliases=${aliases.size} cards_renamed=${cardRenamed} commanders_renamed=${commanderRenamed}`
    );
  }

  return {
    ...deck,
    commanders,
    cards
  };
}

async function buildCanonicalAliasMapFromHtml(html: string): Promise<Map<string, string>> {
  const $ = load(html);
  const flavorToHint = new Map<string, { display: string; hint: string }>();

  $('a[href^="/cards/"]').each((_, anchor) => {
    const href = String($(anchor).attr('href') || '').trim();
    const displayName = $(anchor).text().replace(/\s+/g, ' ').trim();
    const canonicalHint = extractCardNameHintFromHref(href);
    if (!displayName || !canonicalHint) {
      return;
    }

    const displayNorm = normalizeName(displayName);
    const hintNorm = normalizeName(canonicalHint);
    if (!displayNorm || !hintNorm || displayNorm === hintNorm) {
      return;
    }
    if (!flavorToHint.has(displayNorm)) {
      flavorToHint.set(displayNorm, { display: displayName, hint: canonicalHint });
    }
  });

  if (!flavorToHint.size) {
    return new Map<string, string>();
  }

  const hintToCanonical = new Map<string, string>();
  await Promise.all(
    [...new Set([...flavorToHint.values()].map((entry) => entry.hint))].map(async (hint) => {
      const canonical = await resolveScryfallCanonicalName(hint);
      hintToCanonical.set(hint, canonical || hint);
    })
  );

  const aliases = new Map<string, string>();
  for (const [displayNorm, entry] of flavorToHint.entries()) {
    const canonical = hintToCanonical.get(entry.hint);
    if (!canonical) {
      continue;
    }
    const preferred = choosePreferredCanonicalName(entry.display, canonical);
    if (!preferred || normalizeName(preferred) === displayNorm) {
      continue;
    }
    aliases.set(displayNorm, preferred);
  }

  return aliases;
}

function choosePreferredCanonicalName(displayName: string, resolvedName: string): string {
  const normalizedDisplay = normalizeName(displayName);
  const faces = resolvedName
    .split(/\s*\/\/\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!faces.length) {
    return resolvedName;
  }
  if (faces.length === 1 || !normalizedDisplay) {
    return faces[0];
  }

  for (const face of faces) {
    if (normalizeName(face) === normalizedDisplay) {
      return face;
    }
  }
  for (const face of faces) {
    const normalizedFace = normalizeName(face);
    if (!normalizedFace) {
      continue;
    }
    if (normalizedFace.includes(normalizedDisplay) || normalizedDisplay.includes(normalizedFace)) {
      return face;
    }
  }

  return faces[0];
}

function extractCardNameHintFromHref(href: string): string | null {
  if (!href) {
    return null;
  }

  const match = href.match(/^\/cards\/[A-Za-z0-9]+-([A-Za-z0-9-]+)$/);
  if (!match || !match[1]) {
    return null;
  }

  return match[1]
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveScryfallCanonicalName(nameHint: string): Promise<string | null> {
  const key = normalizeName(nameHint);
  if (!key) {
    return null;
  }
  if (scryfallNameCache.has(key)) {
    return scryfallNameCache.get(key) || null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRYFALL_TIMEOUT_MS);
  try {
    const url = new URL(SCRYFALL_NAMED_FUZZY_URL);
    url.searchParams.set('fuzzy', nameHint);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'user-agent': process.env.MOXFIELD_USER_AGENT?.trim() || DEFAULT_USER_AGENT
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    const resolved = extractScryfallCardName(payload);
    if (resolved) {
      scryfallNameCache.set(key, resolved);
    }
    return resolved;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractScryfallCardName(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const item = payload as Record<string, unknown>;
  const name = String(item.name || '').trim();
  return name || null;
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function extractCards(boardPayload: unknown): CardMap {
  const cards: CardMap = {};
  if (!boardPayload || typeof boardPayload !== 'object') {
    return cards;
  }

  const entries = Array.isArray(boardPayload)
    ? boardPayload
    : Object.values(boardPayload as Record<string, unknown>);

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const quantity = safeInt(item.quantity);
    const embeddedCard =
      item.card && typeof item.card === 'object'
        ? (item.card as Record<string, unknown>)
        : item;
    const name = String(
      embeddedCard.name || embeddedCard.cardName || embeddedCard.card_name || item.name || ''
    ).trim();
    if (quantity > 0 && name) {
      cards[name] = quantity;
    }
  }

  return cards;
}

function extractCommanders(payload: Record<string, unknown>): string[] {
  const commandersPayload = getCommandersPayload(payload);

  if (commandersPayload && typeof commandersPayload === 'object' && !Array.isArray(commandersPayload)) {
    const names = Object.values(commandersPayload)
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return '';
        }
        const item = entry as Record<string, unknown>;
        const card = item.card && typeof item.card === 'object' ? (item.card as Record<string, unknown>) : item;
        return String(card.name || item.name || item.cardName || '').trim();
      })
      .filter(Boolean);
    if (names.length) {
      return names;
    }
  }

  if (Array.isArray(commandersPayload)) {
    const names = commandersPayload
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return '';
        }
        const item = entry as Record<string, unknown>;
        const card = item.card && typeof item.card === 'object' ? (item.card as Record<string, unknown>) : item;
        return String(card.name || card.cardName || item.name || '').trim();
      })
      .filter(Boolean);
    if (names.length) {
      return names;
    }
  }

  const fallback = String(payload.commander || '').trim();
  return fallback ? [fallback] : [];
}

function payloadLooksLikeDeck(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  return Boolean(Object.keys(extractCards(getMainboardPayload(payload))).length || extractCommanders(payload).length);
}

function extractDeckPayloadFromTree(root: unknown): Record<string, unknown> | null {
  const stack: unknown[] = [root];
  const seen = new Set<object>();

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') {
      continue;
    }

    if (seen.has(node)) {
      continue;
    }
    seen.add(node);

    if (!Array.isArray(node) && payloadLooksLikeDeck(node)) {
      return node;
    }

    if (Array.isArray(node)) {
      stack.push(...node);
    } else {
      stack.push(...Object.values(node));
    }
  }

  return null;
}

function extractDeckPayloadFromHtml(html: string): Record<string, unknown> | null {
  const matches = [...html.matchAll(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>\s*([\s\S]*?)\s*<\/script>/gi)];
  for (const match of matches) {
    const raw = match[1];
    try {
      const payload = JSON.parse(raw) as unknown;
      const extracted = extractDeckPayloadFromTree(payload);
      if (extracted) {
        return extracted;
      }
    } catch {
      // keep scanning
    }
  }
  return null;
}

function getMainboardPayload(payload: Record<string, unknown>): unknown {
  if (payload.mainboard) {
    return payload.mainboard;
  }
  if (payload.mainBoard) {
    return payload.mainBoard;
  }

  const boards = payload.boards;
  if (boards && typeof boards === 'object' && !Array.isArray(boards)) {
    const map = boards as Record<string, unknown>;
    return map.mainboard || map.mainBoard || map.main || {};
  }

  return {};
}

function getCommandersPayload(payload: Record<string, unknown>): unknown {
  if (payload.commanders) {
    return payload.commanders;
  }
  if (payload.commander && (Array.isArray(payload.commander) || typeof payload.commander === 'object')) {
    return payload.commander;
  }

  const boards = payload.boards;
  if (boards && typeof boards === 'object' && !Array.isArray(boards)) {
    const map = boards as Record<string, unknown>;
    return map.commanders || map.commander || map.command || {};
  }

  return {};
}

function mergeDeckPayload(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...primary };

  if (!String(primary.name || '').trim()) {
    merged.name = fallback.name || merged.name;
  }

  if (!Object.keys(extractCards(getMainboardPayload(primary))).length) {
    merged.mainboard = fallback.mainboard || {};
  } else if (!merged.mainboard && fallback.mainboard) {
    merged.mainboard = fallback.mainboard;
  }

  if (!extractCommanders(primary).length) {
    merged.commanders = fallback.commanders || {};
  } else if (!merged.commanders && fallback.commanders) {
    merged.commanders = fallback.commanders;
  }

  return merged;
}

function extractDeckPayloadFromDomHtml(html: string, deckId: string): Record<string, unknown> | null {
  const $ = load(html);
  const articles = $('article').toArray();

  let best: { commanders: Record<string, unknown>; mainboard: Record<string, unknown> } | null = null;
  let bestScore = -1;

  for (const article of articles) {
    const parsed = parseArticleDeck($, article);
    if (!parsed) {
      continue;
    }
    const totalCards = Object.values(parsed.mainboard).reduce((acc, row) => {
      const item = row as Record<string, unknown>;
      return acc + safeInt(item.quantity);
    }, 0);
    const score = totalCards + (Object.keys(parsed.commanders).length ? 1000 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = parsed;
    }
  }

  if (!best) {
    return null;
  }

  return {
    publicId: deckId,
    name: extractDeckNameFromDom($) || deckId,
    commanders: best.commanders,
    mainboard: best.mainboard
  };
}

function parseArticleDeck(
  $: ReturnType<typeof load>,
  articleEl: ReturnType<ReturnType<typeof load>['root']>['0']
): { commanders: Record<string, unknown>; mainboard: Record<string, unknown> } | null {
  const commanders: Record<string, { quantity: number; card: { name: string } }> = {};
  const mainboard: Record<string, { quantity: number; card: { name: string } }> = {};
  let sawCard = false;

  $(articleEl)
    .find('ul')
    .each((_, ul) => {
      const label = extractSectionLabel($, ul).toLowerCase();
      if (!label) {
        return;
      }

      $(ul)
        .find('li')
        .each((__, li) => {
          const anchor = $(li).find('a[href^="/cards/"]').first();
          if (!anchor.length) {
            return;
          }

          const name = anchor.text().trim();
          if (!name) {
            return;
          }

          const qtyInput = $(li).find('input').first().attr('value');
          const quantity = Math.max(1, safeInt(qtyInput));

          const target = label.includes('commander') ? commanders : mainboard;
          if (target[name]) {
            target[name].quantity += quantity;
          } else {
            target[name] = { quantity, card: { name } };
          }
          sawCard = true;
        });
    });

  if (!sawCard || !Object.keys(mainboard).length) {
    return null;
  }

  return { commanders, mainboard };
}

function extractSectionLabel($: ReturnType<typeof load>, ul: ReturnType<ReturnType<typeof load>['root']>['0']): string {
  const firstLi = $(ul).find('li').first();
  if (!firstLi.length) {
    return '';
  }

  const value = firstLi
    .text()
    .replace(/\bChange\b/gi, ' ')
    .replace(/\(\d+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value || value.length > 60) {
    return '';
  }

  return value;
}

function extractDeckNameFromDom($: ReturnType<typeof load>): string {
  const h1 = $('h1').first().text().trim();
  if (h1) {
    return h1;
  }

  const title = $('title').first().text().trim();
  if (!title) {
    return '';
  }
  return title.split('//')[0].trim();
}

function safeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.trunc(parsed);
}
