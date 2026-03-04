// @ts-nocheck
import { load } from 'cheerio';

import type { CommanderEntry, DeckRecord } from './types';
import {
  DEFAULT_USER_AGENT,
  absolutizeUrl,
  decodeHtmlText,
  normalizeName,
  parseDate,
  sleep,
  toDateStart,
  withQueryParams
} from './utils';

const BASE_URL = 'https://www.mtgtop8.com';
const DUEL_COMMANDER_ALL_META = '56';
const DUEL_COMMANDER_FORMAT = 'EDH';
const DUEL_COMMANDER_INDEX_URL = `${BASE_URL}/format?f=${DUEL_COMMANDER_FORMAT}&meta=${DUEL_COMMANDER_ALL_META}&a=`;

interface PageRequest {
  method: 'GET' | 'POST';
  url: string;
  data?: Record<string, string>;
}

interface CrawlOptions {
  maxPages?: number;
  delaySeconds?: number;
  newerThan?: Date | null;
  onProgress?: (event: CrawlProgressEvent) => void;
}

interface DeckSections {
  sections: Record<string, Record<string, number>>;
  parser: 'div' | 'table' | 'none';
}

export interface CrawlProgressEvent {
  phase: 'start' | 'page' | 'deck' | 'complete';
  currentPage: number;
  totalPages: number | null;
  scannedPages: number;
  rowsOnPage: number;
  rowsToFetchOnPage: number;
  fetchedOnPage: number;
  fetchedDecks: number;
}

export class MtgTop8Client {
  private timeoutMs: number;
  private delayMs: number;
  private headers: HeadersInit;

  constructor(timeoutMs = 25_000, delaySeconds = 0.2) {
    this.timeoutMs = timeoutMs;
    this.delayMs = Math.max(0, Math.trunc(delaySeconds * 1000));
    this.headers = {
      'user-agent': DEFAULT_USER_AGENT,
      'accept-language': 'en-US,en;q=0.9',
      referer: `${BASE_URL}/`
    };
  }

  async findCommanderEntry(commanders: string[]): Promise<CommanderEntry> {
    let entries = await this.loadCommanderEntries();
    if (!entries.length) {
      entries = await this.searchCommanderEntries(commanders);
    }
    if (!entries.length) {
      throw new Error('No commander archetypes discovered on MtgTop8');
    }

    const wanted = commanders.map((name) => normalizeName(name)).filter(Boolean);
    const wantedSet = new Set(wanted);

    let best: CommanderEntry | null = null;
    for (const [name, url] of entries) {
      const score = this.scoreNameMatch(normalizeName(name), wanted, wantedSet);
      if (!best || score > best.score) {
        best = {
          name,
          url: withQueryParams(url, {
            f: DUEL_COMMANDER_FORMAT,
            meta: DUEL_COMMANDER_ALL_META
          }),
          score
        };
      }
    }

    if (!best || best.score < 0.4) {
      throw new Error(
        `Unable to confidently match commander on MtgTop8. Best candidate '${best?.name || 'none'}' score=${best?.score.toFixed(2) || '0.00'}`
      );
    }

    return best;
  }

  async crawlCommanderDecks(commanderUrl: string, options: CrawlOptions = {}): Promise<DeckRecord[]> {
    const delayMs = options.delaySeconds == null ? this.delayMs : Math.max(0, Math.trunc(options.delaySeconds * 1000));
    const newerThanStamp = options.newerThan ? toDateStart(options.newerThan) : null;
    const firstUrl = withQueryParams(commanderUrl, { f: DUEL_COMMANDER_FORMAT, meta: DUEL_COMMANDER_ALL_META });
    const onProgress = options.onProgress;

    let request: PageRequest | null = { method: 'GET', url: firstUrl };
    const visited = new Set<string>();
    const seenDeckUrls = new Set<string>();
    const decks: DeckRecord[] = [];
    let pageCount = 0;
    let knownTotalPages: number | null = null;

    onProgress?.({
      phase: 'start',
      currentPage: 0,
      totalPages: null,
      scannedPages: 0,
      rowsOnPage: 0,
      rowsToFetchOnPage: 0,
      fetchedOnPage: 0,
      fetchedDecks: 0
    });

    while (request) {
      const requestKey = this.requestKey(request);
      if (visited.has(requestKey)) {
        break;
      }
      visited.add(requestKey);
      pageCount += 1;

      let html = await this.requestPage(request);
      let parsed = this.parseCommanderPage(html, request.url);
      parsed = await this.retryPageRequestIfStalled({
        request,
        parsed,
        seenDeckUrls
      });
      knownTotalPages = parsed.totalPages ?? knownTotalPages;
      const currentPage = parsed.currentPage ?? pageCount;

      const rowsToFetch = parsed.rows.filter((row) => {
        const parsedRowDate = parseDate(row.eventDate);
        const rowStamp = parsedRowDate ? toDateStart(parsedRowDate) : null;
        const isNewerThanCache = newerThanStamp == null || rowStamp == null || rowStamp > newerThanStamp;
        if (!isNewerThanCache) {
          return false;
        }
        if (seenDeckUrls.has(row.deckUrl)) {
          return false;
        }
        return true;
      });

      onProgress?.({
        phase: 'page',
        currentPage,
        totalPages: knownTotalPages,
        scannedPages: pageCount,
        rowsOnPage: parsed.rows.length,
        rowsToFetchOnPage: rowsToFetch.length,
        fetchedOnPage: 0,
        fetchedDecks: decks.length
      });

      let allRowsAreOlderOrEqual = parsed.rows.length > 0;
      let fetchedOnPage = 0;
      for (const row of rowsToFetch) {
        const parsedRowDate = parseDate(row.eventDate);
        const rowStamp = parsedRowDate ? toDateStart(parsedRowDate) : null;
        allRowsAreOlderOrEqual = false;
        seenDeckUrls.add(row.deckUrl);
        const { cards, sections } = await this.fetchDeckCards(row.deckUrl);
        decks.push({ ...row, cards, sections });
        fetchedOnPage += 1;
        onProgress?.({
          phase: 'deck',
          currentPage,
          totalPages: knownTotalPages,
          scannedPages: pageCount,
          rowsOnPage: parsed.rows.length,
          rowsToFetchOnPage: rowsToFetch.length,
          fetchedOnPage,
          fetchedDecks: decks.length
        });
        await sleep(delayMs);
      }

      if (newerThanStamp != null && parsed.rows.length > 0 && rowsToFetch.length === 0) {
        allRowsAreOlderOrEqual = true;
      }

      if (newerThanStamp != null && allRowsAreOlderOrEqual) {
        break;
      }

      if (options.maxPages && pageCount >= options.maxPages) {
        break;
      }

      request = parsed.next;
      await sleep(delayMs);
    }

    onProgress?.({
      phase: 'complete',
      currentPage: pageCount,
      totalPages: knownTotalPages,
      scannedPages: pageCount,
      rowsOnPage: 0,
      rowsToFetchOnPage: 0,
      fetchedOnPage: 0,
      fetchedDecks: decks.length
    });

    return decks;
  }

  async fetchDeckCards(deckUrl: string): Promise<{ cards: Record<string, number>; sections: Record<string, Record<string, number>> }> {
    const html = await this.get(deckUrl);
    const { sections } = extractDeckSections(html);

    const cards = { ...(sections.main || {}) };
    for (const [name, quantity] of Object.entries(sections.commander || {})) {
      if (!(name in cards)) {
        cards[name] = quantity;
      }
    }

    return { cards, sections };
  }

  private async retryPageRequestIfStalled(args: {
    request: PageRequest;
    parsed: { rows: DeckRecord[]; next: PageRequest | null; currentPage: number | null; totalPages: number | null };
    seenDeckUrls: Set<string>;
  }): Promise<{ rows: DeckRecord[]; next: PageRequest | null; currentPage: number | null; totalPages: number | null }> {
    const { request, parsed, seenDeckUrls } = args;
    if (request.method !== 'POST') {
      return parsed;
    }

    const targetPage = request.data?.current_page;
    if (!targetPage) {
      return parsed;
    }

    const newOnPage = parsed.rows.filter((row) => !seenDeckUrls.has(row.deckUrl)).length;
    if (newOnPage > 0) {
      return parsed;
    }

    const fallbacks: PageRequest[] = [
      { method: 'GET', url: withQueryParams(request.url, { cp: targetPage }) },
      { method: 'GET', url: withQueryParams(request.url, { current_page: targetPage }) },
      { method: 'POST', url: request.url, data: { cp: targetPage } },
      { method: 'POST', url: request.url, data: { current_page: targetPage, cp: targetPage } }
    ];

    for (const fallback of fallbacks) {
      if (this.requestKey(fallback) === this.requestKey(request)) {
        continue;
      }
      const html = await this.requestPage(fallback);
      const candidate = this.parseCommanderPage(html, fallback.url);
      const candidateNew = candidate.rows.filter((row) => !seenDeckUrls.has(row.deckUrl)).length;
      if (candidateNew > 0) {
        return candidate;
      }
    }

    return parsed;
  }

  private parseCommanderPage(html: string, pageUrl: string): {
    rows: DeckRecord[];
    next: PageRequest | null;
    currentPage: number | null;
    totalPages: number | null;
  } {
    const $ = load(html);
    const tableData = findResultsTable($, pageUrl);
    const next = findNextPageRequest($, pageUrl);
    const pagination = extractPaginationState($);

    if (!tableData) {
      return { rows: [], next, currentPage: pagination.currentPage, totalPages: pagination.totalPages };
    }

    const { tableIndex, headers } = tableData;
    const rows: DeckRecord[] = [];
    const requiredCells = Math.max(...Object.values(headers)) + 1;
    const table = $('table').eq(tableIndex);

    table.find('tr').each((_, tr) => {
      const cells = $(tr).find('td');
      if (!cells.length || cells.length < requiredCells) {
        return;
      }

      const rowText = cells
        .toArray()
        .map((cell) => $(cell).text().trim())
        .join(' ');
      const normalized = normalizeName(rowText);
      if (!normalized || (normalized.includes('deck') && normalized.includes('player'))) {
        return;
      }

      const deckCell = cells.eq(headers.deck);
      const deckUrl = extractDeckUrl($, deckCell, pageUrl);
      if (!deckUrl) {
        return;
      }

      const valueAt = (column: keyof typeof headers): string => {
        const idx = headers[column];
        return idx == null ? '' : cells.eq(idx).text().replace(/\s+/g, ' ').trim();
      };

      rows.push({
        deckName: valueAt('deck'),
        player: valueAt('player'),
        event: valueAt('event'),
        eventLevel: valueAt('level'),
        rank: valueAt('rank'),
        eventDate: valueAt('date'),
        deckUrl,
        pageUrl,
        cards: {},
        sections: {}
      });
    });

    return { rows, next, currentPage: pagination.currentPage, totalPages: pagination.totalPages };
  }

  private async loadCommanderEntries(): Promise<Array<[string, string]>> {
    const entries = new Map<string, string>();
    const queue: string[] = [
      DUEL_COMMANDER_INDEX_URL,
      `${BASE_URL}/format?f=${DUEL_COMMANDER_FORMAT}&meta=${DUEL_COMMANDER_ALL_META}`,
      `${BASE_URL}/format?f=${DUEL_COMMANDER_FORMAT}`
    ];
    const seen = new Set<string>();

    while (queue.length) {
      const scanUrl = queue.shift()!;
      if (seen.has(scanUrl)) {
        continue;
      }
      seen.add(scanUrl);

      const html = await this.get(scanUrl);
      const $ = load(html);
      for (const [name, url] of extractCommanderEntriesFromSoup($, scanUrl)) {
        entries.set(name, url);
      }

      const allCommanderDecksUrl = findAllCommanderDecksLink($, scanUrl);
      if (allCommanderDecksUrl && !seen.has(allCommanderDecksUrl) && !queue.includes(allCommanderDecksUrl)) {
        queue.push(allCommanderDecksUrl);
      }

      if (entries.size) {
        break;
      }
    }

    if (!entries.size) {
      for (const [name, url] of await this.loadCommanderEntriesFromDynamicEndpoint()) {
        entries.set(name, url);
      }
    }

    return [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  private async loadCommanderEntriesFromDynamicEndpoint(maxPages = 64): Promise<Array<[string, string]>> {
    const entries = new Map<string, string>();
    let noGrowthCount = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const url =
        `${BASE_URL}/cEDH_decks?f=${DUEL_COMMANDER_FORMAT}&show=alpha&cid=` +
        `&meta=${DUEL_COMMANDER_ALL_META}&gamerid1=&gamerid2=&cEDH_cp=${page}`;
      const html = await this.post(url);
      const $ = load(html);

      const before = entries.size;
      for (const [name, entryUrl] of extractCommanderEntriesFromSoup($, url)) {
        entries.set(name, entryUrl);
      }
      const after = entries.size;

      if (after === before) {
        noGrowthCount += 1;
      } else {
        noGrowthCount = 0;
      }

      if (page > 1 && entries.size > 0 && noGrowthCount >= 1) {
        break;
      }
    }

    return [...entries.entries()];
  }

  private async searchCommanderEntries(commanders: string[]): Promise<Array<[string, string]>> {
    const entries = new Map<string, string>();

    for (const commander of commanders.map((item) => item.trim()).filter(Boolean)) {
      for (const variant of commanderQueryVariants(commander)) {
        const encoded = encodeURIComponent(variant).replace(/%20/g, '+');
        const searchUrl = `${BASE_URL}/cEDH_card_search?n=${encoded}&b=1`;
        const html = await this.post(searchUrl);
        const matches = extractCommanderEntriesFromSearchHtml(html);

        for (const [name, archetypeId] of matches) {
          entries.set(
            name,
            `${BASE_URL}/archetype?a=${archetypeId}&meta=${DUEL_COMMANDER_ALL_META}&f=${DUEL_COMMANDER_FORMAT}`
          );
        }

        if (matches.length) {
          break;
        }
      }
    }

    return [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  private scoreNameMatch(candidate: string, wanted: string[], wantedSet: Set<string>): number {
    if (!candidate) {
      return 0;
    }
    if (wantedSet.has(candidate)) {
      return 1;
    }
    if (wanted.length && wanted.every((token) => candidate.includes(token))) {
      return 0.95;
    }

    const candidateWords = new Set(candidate.split(' '));
    const wantedWords = new Set(wanted.flatMap((item) => item.split(' ')).filter(Boolean));
    const overlap = [...candidateWords].filter((word) => wantedWords.has(word)).length;
    const coverage = wantedWords.size ? overlap / wantedWords.size : 0;
    const directContains = wanted.some((token) => token && candidate.includes(token)) ? 0.8 : 0;
    const similarity = Math.max(0, ...wanted.map((token) => sorensenDice(token, candidate)));
    return Math.max(coverage, directContains, similarity);
  }

  private requestKey(request: PageRequest): string {
    const payload = request.data
      ? Object.entries(request.data)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join('&')
      : '';
    return `${request.method}|${request.url}|${payload}`;
  }

  private async requestPage(request: PageRequest): Promise<string> {
    return request.method === 'POST' ? this.post(request.url, request.data) : this.get(request.url);
  }

  private async get(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`MtgTop8 GET failed ${response.status}: ${url}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(url: string, data: Record<string, string> = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const body = new URLSearchParams(data).toString();
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.headers,
          'content-type': 'application/x-www-form-urlencoded'
        },
        body,
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`MtgTop8 POST failed ${response.status}: ${url}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractDeckSections(html: string): DeckSections {
  const $ = load(html);
  const divSections = extractDeckSectionsFromDivLayout($);
  if (sectionsHaveCards(divSections)) {
    return { sections: divSections, parser: 'div' };
  }

  const tableSections = extractDeckSectionsFromTableLayout($);
  if (sectionsHaveCards(tableSections)) {
    return { sections: tableSections, parser: 'table' };
  }

  return { sections: tableSections, parser: 'none' };
}

function extractDeckSectionsFromDivLayout($: ReturnType<typeof load>): Record<string, Record<string, number>> {
  const sections: Record<string, Record<string, number>> = { main: {} };
  let currentSection = 'main';

  $('div').each((_, div) => {
    const classes = ($(div).attr('class') || '').split(/\s+/).filter(Boolean);

    if (classes.includes('O14')) {
      currentSection = resolveSectionFromHeader($(div).text(), currentSection);
      if (!sections[currentSection]) {
        sections[currentSection] = {};
      }
      return;
    }

    if (!classes.includes('deck_line')) {
      return;
    }

    const quantity = extractDivLineQuantity($, div);
    const cardName = extractDivLineCardName($, div);
    if (quantity == null || !cardName) {
      return;
    }

    let lineSection = currentSection;
    const rowId = ($(div).attr('id') || '').trim().toLowerCase();
    if (rowId.startsWith('sb') && currentSection === 'main') {
      lineSection = 'sideboard';
    }

    if (!sections[lineSection]) {
      sections[lineSection] = {};
    }
    sections[lineSection][cardName] = (sections[lineSection][cardName] || 0) + quantity;
  });

  return sections;
}

function extractDeckSectionsFromTableLayout($: ReturnType<typeof load>): Record<string, Record<string, number>> {
  const sections: Record<string, Record<string, number>> = { main: {} };
  let currentSection = 'main';

  $('tr').each((_, tr) => {
    const text = $(tr).text().replace(/\s+/g, ' ').trim();
    if (!text) {
      return;
    }

    currentSection = resolveSectionFromHeader(text, currentSection);
    if (isSectionHeaderOnly(text)) {
      if (!sections[currentSection]) {
        sections[currentSection] = {};
      }
      return;
    }

    const cells = $(tr).find('td');
    if (cells.length < 2) {
      return;
    }

    const quantity = parseQuantity(cells.eq(0).text());
    const name = extractCardNameFromTableCell($, cells.eq(1));
    if (quantity == null || !name) {
      return;
    }

    if (!sections[currentSection]) {
      sections[currentSection] = {};
    }
    sections[currentSection][name] = (sections[currentSection][name] || 0) + quantity;
  });

  return sections;
}

function resolveSectionFromHeader(text: string, currentSection: string): string {
  const upper = text.toUpperCase();
  if (upper.includes('SIDEBOARD')) {
    return 'sideboard';
  }
  if (upper.includes('COMMANDER')) {
    return 'commander';
  }
  if (upper.includes('MAYBEBOARD')) {
    return 'maybeboard';
  }
  if (upper.includes('MAINBOARD') || upper.includes('MAIN DECK')) {
    return 'main';
  }
  if (currentSection === 'commander' && /^\d+\s+[A-Z]/.test(upper)) {
    return 'main';
  }
  return currentSection;
}

function isSectionHeaderOnly(text: string): boolean {
  const upper = text.toUpperCase();
  return ['SIDEBOARD', 'COMMANDER', 'MAYBEBOARD', 'MAINBOARD', 'MAIN DECK'].some((token) =>
    upper.includes(token)
  );
}

function parseQuantity(text: string): number | null {
  const stripped = text.trim().replace(/[xX]$/, '');
  if (!/^\d+$/.test(stripped)) {
    return null;
  }
  return Number(stripped);
}

function extractCardNameFromTableCell($: ReturnType<typeof load>, cell: ReturnType<ReturnType<typeof load>['root']>): string {
  const anchor = cell.find('a').first();
  if (!anchor.length) {
    return '';
  }

  const href = (anchor.attr('href') || '').toLowerCase();
  const valid = ['cards=', 'search?', 'card?', 'find?', '/cards/'].some((token) => href.includes(token));
  if (!valid) {
    return '';
  }

  return anchor.text().replace(/\s+/g, ' ').trim();
}

function extractDivLineQuantity($: ReturnType<typeof load>, line: Parameters<ReturnType<typeof load>['find']>[0]): number | null {
  const text = $(line).text().replace(/\s+/g, ' ').trim();
  const match = /^(\d+)\b/.exec(text);
  return match ? Number(match[1]) : null;
}

function extractDivLineCardName($: ReturnType<typeof load>, line: Parameters<ReturnType<typeof load>['find']>[0]): string {
  const span = $(line).find('span.L14').first();
  if (span.length) {
    const value = span.text().replace(/\s+/g, ' ').trim();
    if (value) {
      return value;
    }
  }

  const anchor = $(line).find('a').first();
  if (anchor.length) {
    const value = anchor.text().replace(/\s+/g, ' ').trim();
    if (value) {
      return value;
    }
  }

  const onclick = ($(line).attr('onclick') || '').trim();
  const onclickMatch = /AffCard\(\s*'[^']*'\s*,\s*'((?:\\'|[^'])+)'/i.exec(onclick);
  if (onclickMatch) {
    return decodeHtmlText(onclickMatch[1].replace(/\\'/g, "'").replace(/\+/g, ' ')).trim();
  }

  const text = $(line).text().replace(/\s+/g, ' ').trim();
  const raw = /^\d+\s+(.+)$/.exec(text);
  return raw ? raw[1].trim() : '';
}

function sectionsHaveCards(sections: Record<string, Record<string, number>>): boolean {
  return Object.values(sections).some((cards) => Object.keys(cards).length > 0);
}

function findResultsTable(
  $: ReturnType<typeof load>,
  pageUrl: string
): { tableIndex: number; headers: Record<'deck' | 'player' | 'event' | 'level' | 'rank' | 'date', number> } | null {
  const desired = ['deck', 'player', 'event', 'level', 'rank', 'date'] as const;
  let best:
    | {
        tableIndex: number;
        headers: Record<'deck' | 'player' | 'event' | 'level' | 'rank' | 'date', number>;
        score: [number, number, number];
      }
    | null = null;

  $('table').each((tableIndex, table) => {
    $(table)
      .find('tr')
      .each((_, tr) => {
        const cells = $(tr).find('th, td');
        if (!cells.length) {
          return;
        }

        const headerMap: Partial<Record<(typeof desired)[number], number>> = {};
        cells.each((idx, cell) => {
          const normalized = normalizeName($(cell).text());
          for (const key of desired) {
            if (normalized === key && headerMap[key] == null) {
              headerMap[key] = idx;
            }
          }
        });

        if (!desired.every((key) => headerMap[key] != null)) {
          return;
        }

        const deckIdx = headerMap.deck as number;
        const deckHits = countDeckRowsForCandidate($, $(table), deckIdx, pageUrl);
        const score: [number, number, number] = [deckHits > 0 ? 1 : 0, deckHits, -Math.max(...Object.values(headerMap))];

        if (!best || compareTuple(score, best.score) > 0) {
          best = {
            tableIndex,
            headers: headerMap as Record<'deck' | 'player' | 'event' | 'level' | 'rank' | 'date', number>,
            score
          };
        }
      });
  });

  return best ? { tableIndex: best.tableIndex, headers: best.headers } : null;
}

function countDeckRowsForCandidate(
  $: ReturnType<typeof load>,
  table: ReturnType<ReturnType<typeof load>['root']>,
  deckIdx: number,
  baseUrl: string
): number {
  let hits = 0;

  table.find('tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length <= deckIdx) {
      return;
    }

    const deckCell = cells.eq(deckIdx);
    let rowHasDeck = false;
    deckCell.find('a').each((__, anchor) => {
      if (rowHasDeck) {
        return;
      }
      const href = ($(anchor).attr('href') || '').trim();
      if (!href.toLowerCase().includes('event?')) {
        return;
      }
      const absolute = absolutizeUrl(baseUrl, href);
      const query = new URL(absolute).searchParams;
      if (query.has('d')) {
        rowHasDeck = true;
      }
    });

    if (rowHasDeck) {
      hits += 1;
    }
  });

  return hits;
}

function findNextPageRequest($: ReturnType<typeof load>, baseUrl: string): PageRequest | null {
  const navForm = $('form[name="nav_form"]').first();
  const candidateNums: number[] = [];

  if (navForm.length) {
    const action = (navForm.attr('action') || '').trim();
    if (action) {
      const actionUrl = absolutizeUrl(baseUrl, action);
      let currentPage = 1;
      const cur = navForm.find('.Nav_cur').first();
      if (cur.length) {
        const match = /\d+/.exec(cur.text());
        if (match) {
          currentPage = Number(match[0]);
        }
      }

      let pageTarget: number | null = null;
      navForm.find('[onclick]').each((_, item) => {
        const onclick = ($(item).attr('onclick') || '').trim();
        const match = /PageSubmit_arch\((\d+)\)/.exec(onclick);
        if (!match) {
          return;
        }
        const pageNum = Number(match[1]);
        candidateNums.push(pageNum);
        const label = normalizeName($(item).text());
        if (label === 'next') {
          pageTarget = pageNum;
        }
      });

      if (pageTarget == null) {
        const larger = [...new Set(candidateNums)].filter((value) => value > currentPage).sort((a, b) => a - b);
        if (larger.length) {
          pageTarget = larger[0];
        }
      }

      if (pageTarget != null) {
        return {
          method: 'POST',
          url: actionUrl,
          data: { current_page: String(pageTarget) }
        };
      }
    }
  }

  let nextHref = '';
  $('a').each((_, anchor) => {
    if (nextHref) {
      return;
    }
    const text = $(anchor).text().trim().toLowerCase();
    if (text !== 'next') {
      return;
    }
    const href = ($(anchor).attr('href') || '').trim();
    if (href) {
      nextHref = href;
    }
  });

  if (nextHref) {
    return { method: 'GET', url: absolutizeUrl(baseUrl, nextHref) };
  }

  if (navForm.length) {
    navForm.find('[onclick]').each((_, item) => {
      const onclick = ($(item).attr('onclick') || '').trim();
      const match = /PageSubmit_arch\((\d+)\)/.exec(onclick);
      if (match) {
        candidateNums.push(Number(match[1]));
      }
    });

    if (candidateNums.length) {
      const first = [...new Set(candidateNums)].sort((a, b) => a - b)[0];
      const action = (navForm.attr('action') || '').trim();
      if (action) {
        return {
          method: 'POST',
          url: absolutizeUrl(baseUrl, action),
          data: { current_page: String(first) }
        };
      }
    }
  }

  return null;
}

function extractPaginationState($: ReturnType<typeof load>): { currentPage: number | null; totalPages: number | null } {
  const navForm = $('form[name="nav_form"]').first();
  if (!navForm.length) {
    return { currentPage: null, totalPages: null };
  }

  let currentPage: number | null = null;
  const currentText = navForm.find('.Nav_cur').first().text().trim();
  const currentMatch = /\d+/.exec(currentText);
  if (currentMatch) {
    currentPage = Number(currentMatch[0]);
  }

  const pageNumbers = new Set<number>();
  if (currentPage != null) {
    pageNumbers.add(currentPage);
  }

  navForm.find('[onclick]').each((_, item) => {
    const onclick = ($(item).attr('onclick') || '').trim();
    const match = /PageSubmit_arch\((\d+)\)/.exec(onclick);
    if (!match) {
      return;
    }
    const page = Number(match[1]);
    if (Number.isFinite(page) && page > 0) {
      pageNumbers.add(page);
    }
  });

  const totalPages = pageNumbers.size ? Math.max(...pageNumbers) : null;
  if (currentPage == null && totalPages != null) {
    currentPage = 1;
  }

  return { currentPage, totalPages };
}

function extractDeckUrl(
  $: ReturnType<typeof load>,
  deckCell: ReturnType<ReturnType<typeof load>['root']>,
  baseUrl: string
): string {
  let deckUrl = '';

  deckCell.find('a').each((_, anchor) => {
    if (deckUrl) {
      return;
    }
    const href = ($(anchor).attr('href') || '').trim();
    if (!href || !href.includes('event?')) {
      return;
    }
    const absolute = absolutizeUrl(baseUrl, href);
    const query = new URL(absolute).searchParams;
    if (query.has('d')) {
      deckUrl = absolute;
    }
  });

  return deckUrl;
}

function extractCommanderEntriesFromSoup(
  $: ReturnType<typeof load>,
  pageUrl: string
): Array<[string, string]> {
  const entries = new Map<string, string>();

  $('a').each((_, anchor) => {
    const href = ($(anchor).attr('href') || '').trim();
    if (!href.includes('archetype?')) {
      return;
    }

    const absoluteUrl = absolutizeUrl(pageUrl, href);
    const query = new URL(absoluteUrl).searchParams;
    const formatValue = (query.get('f') || DUEL_COMMANDER_FORMAT).toUpperCase();
    if (formatValue !== DUEL_COMMANDER_FORMAT) {
      return;
    }

    const name = readAnchorLabel($, anchor);
    if (!name) {
      return;
    }

    entries.set(name, absoluteUrl);
  });

  return [...entries.entries()];
}

function readAnchorLabel($: ReturnType<typeof load>, anchor: Parameters<ReturnType<typeof load>['find']>[0]): string {
  const text = $(anchor).text().replace(/\s+/g, ' ').trim();
  if (text) {
    return text;
  }

  const image = $(anchor).find('img').first();
  if (image.length) {
    const alt = (image.attr('alt') || '').replace(/\s+/g, ' ').trim();
    if (alt) {
      return alt;
    }
    const title = (image.attr('title') || '').replace(/\s+/g, ' ').trim();
    if (title) {
      return title;
    }
  }

  return '';
}

function findAllCommanderDecksLink($: ReturnType<typeof load>, baseUrl: string): string | null {
  let result: string | null = null;

  $('a').each((_, anchor) => {
    if (result) {
      return;
    }

    const label = normalizeName($(anchor).text());
    if (!label.includes('all commander decks')) {
      return;
    }

    const href = ($(anchor).attr('href') || '').trim();
    if (!href) {
      return;
    }

    const absolute = absolutizeUrl(baseUrl, href);
    result = withQueryParams(absolute, {
      f: DUEL_COMMANDER_FORMAT,
      meta: DUEL_COMMANDER_ALL_META
    });
  });

  return result;
}

function commanderQueryVariants(value: string): string[] {
  const variants = [value];
  if (value.includes('//')) {
    variants.push(...value.split('//').map((part) => part.trim()).filter(Boolean));
  }
  if (value.includes(' / ')) {
    variants.push(...value.split(' / ').map((part) => part.trim()).filter(Boolean));
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of variants) {
    const key = normalizeName(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function extractCommanderEntriesFromSearchHtml(payload: string): Array<[string, string]> {
  const matches = [...payload.matchAll(/AddCom\(\s*'(?<id>\d+)'\s*,\s*'[^']*'\s*,\s*'(?<name>(?:\\'|[^'])+)'\s*\)/gi)];
  const entries: Array<[string, string]> = [];

  for (const match of matches) {
    const id = match.groups?.id;
    const rawName = match.groups?.name;
    if (!id || !rawName) {
      continue;
    }
    const name = decodeHtmlText(rawName.replace(/\\'/g, "'")).replace(/\s+/g, ' ').trim();
    if (name) {
      entries.push([name, id]);
    }
  }

  return entries;
}

function compareTuple(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) {
    return a[0] - b[0];
  }
  if (a[1] !== b[1]) {
    return a[1] - b[1];
  }
  return a[2] - b[2];
}

function sorensenDice(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const pairsA = bigrams(a);
  const pairsB = bigrams(b);
  if (!pairsA.length || !pairsB.length) {
    return 0;
  }

  const counts = new Map<string, number>();
  for (const pair of pairsA) {
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }

  let intersection = 0;
  for (const pair of pairsB) {
    const value = counts.get(pair) || 0;
    if (value > 0) {
      counts.set(pair, value - 1);
      intersection += 1;
    }
  }

  return (2 * intersection) / (pairsA.length + pairsB.length);
}

function bigrams(value: string): string[] {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length < 2) {
    return [];
  }
  const pairs: string[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) {
    pairs.push(clean.slice(i, i + 2));
  }
  return pairs;
}
