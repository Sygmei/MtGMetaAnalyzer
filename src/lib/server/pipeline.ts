import { analyzeCards } from './analysis';
import { fetchInputDeckFromUrl } from '../adapters/deck-source';
import { getDuelCommanderDeckBannedCardsNormalized } from '../adapters/duel-commander-banlist';
import { MtgTop8Client, type CrawlProgressEvent } from '../adapters/mtgtop8';
import { isAppError } from './app-error';
import { resolveCommanderAnalysisDeck } from './commander-analysis';
import {
  getLatestCachedEventDate,
  insertDecksForCommander,
  loadDecksForCommanderFromWrite,
  upsertCommanderCache
} from './mtgtop8-cache-repo';
import { withSpan } from './otel';
import type { AnalyzeOutput, DeckRecord } from './types';
import { formatDate, slugify } from './utils';

interface AnalyzePipelineInput {
  deckUrl?: string;
  commanderNames?: string;
  requiredCards?: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  keepTop?: number;
  cutTop?: number;
  addTop?: number;
  refreshCache?: boolean;
  headless?: boolean;
  maxPages?: number;
  delaySeconds?: number;
  mtgtop8DeckFetchConcurrency?: number;
  onProgress?: (event: AnalyzePipelineProgressEvent) => void;
}

export interface AnalyzePipelineProgressEvent {
  stage: 'moxfield' | 'commander' | 'mtgtop8' | 'analysis' | 'done';
  message: string;
  percentHint: number;
  mtgtop8?: CrawlProgressEvent;
}

export async function analyzeFromDeckUrl(input: AnalyzePipelineInput & { deckUrl: string }): Promise<AnalyzeOutput> {
  return analyzeDeck(input);
}

export async function analyzeDeck(input: AnalyzePipelineInput): Promise<AnalyzeOutput> {
  return await withSpan(
    'analysis.pipeline',
    {
      'analysis.deck_url': input.deckUrl ?? '',
      'analysis.keep_top': input.keepTop ?? 50,
      'analysis.cut_top': input.cutTop ?? 50,
      'analysis.add_top': input.addTop ?? 50
    },
    async (pipelineSpan) => {
      const headless = input.headless ?? true;
      input.onProgress?.({
        stage: input.commanderNames ? 'commander' : 'moxfield',
        message: input.commanderNames ? 'Resolving commander...' : 'Fetching input deck...',
        percentHint: 5
      });
      const inputDeck = input.commanderNames
        ? await resolveCommanderAnalysisDeck(input.commanderNames)
        : await withSpan(
            'deck.fetch_input',
            { 'deck.url': input.deckUrl ?? '', 'deck.headless': headless },
            () => fetchInputDeckFromUrl(input.deckUrl ?? '', { headless })
          );
      pipelineSpan.setAttribute('deck.source', inputDeck.source);

      const mtgtop8 = new MtgTop8Client(25_000, input.delaySeconds ?? 0.2);
      input.onProgress?.({
        stage: 'commander',
        message: 'Matching commander on MtgTop8...',
        percentHint: 14
      });
      const commanderEntry = await withSpan(
        'mtgtop8.find_commander',
        { 'commander.query_count': inputDeck.commanders.length },
        () => mtgtop8.findCommanderEntry(inputDeck.commanders)
      );
      const commanderSlug = slugify(commanderEntry.name);
      pipelineSpan.setAttribute('commander.slug', commanderSlug);
      pipelineSpan.setAttribute('commander.name', commanderEntry.name);

      const commanderInfo = {
        moxfieldCommanderQuery: inputDeck.commanders.join(' / '),
        name: commanderEntry.name,
        score: commanderEntry.score,
        url: commanderEntry.url,
        slug: commanderSlug
      };

      await withSpan('db.upsert_commander_cache', { 'commander.slug': commanderSlug }, () =>
        upsertCommanderCache({
          slug: commanderSlug,
          commanderName: commanderInfo.name,
          commanderUrl: commanderInfo.url,
          moxfieldCommanderQuery: commanderInfo.moxfieldCommanderQuery,
          score: commanderInfo.score
        })
      );

      const refresh = Boolean(input.refreshCache);
      const deckFetchConcurrency = resolveMtgTop8DeckFetchConcurrency(input.mtgtop8DeckFetchConcurrency);
      const latestCachedEventDate = refresh
        ? null
        : await withSpan('db.get_latest_cached_date', { 'commander.slug': commanderSlug }, () =>
            getLatestCachedEventDate(commanderSlug)
          );

      input.onProgress?.({
        stage: 'mtgtop8',
        message: 'Fetching MtgTop8 decks...',
        percentHint: 20
      });
      let newDeckRows: DeckRecord[] = [];
      try {
        newDeckRows = await withSpan(
          'mtgtop8.crawl_decks',
          { 'commander.slug': commanderSlug, 'mtgtop8.max_pages': input.maxPages ?? 0 },
          () =>
            mtgtop8.crawlCommanderDecks(commanderEntry.url, {
              maxPages: input.maxPages,
              delaySeconds: input.delaySeconds,
              deckFetchConcurrency,
              newerThan: latestCachedEventDate,
              onProgress: (event) => {
                const percentHint = computeMtgTop8PercentHint(event);
                const message = formatMtgTop8Message(event);
                input.onProgress?.({
                  stage: 'mtgtop8',
                  message,
                  percentHint,
                  mtgtop8: event
                });
              }
            })
        );
      } catch (error) {
        if (!latestCachedEventDate || !isAppError(error) || error.httpStatusCode < 500) {
          throw error;
        }

        console.warn(
          `[analysis] MtgTop8 refresh failed for commander=${commanderSlug}; using cached decks through ${formatDate(latestCachedEventDate)}. error_type=${error.errorTypeName} admin_error=${error.adminFacingError}`
        );
        input.onProgress?.({
          stage: 'mtgtop8',
          message: 'MtgTop8 refresh timed out; using cached decklists...',
          percentHint: 90
        });
      }

      input.onProgress?.({
        stage: 'analysis',
        message: input.commanderNames ? 'Analyzing popular cards...' : 'Running keep / cut / add analysis...',
        percentHint: 92
      });
      const insertedDeckRows = await withSpan('db.insert_decks', { 'commander.slug': commanderSlug }, () =>
        insertDecksForCommander(commanderSlug, newDeckRows)
      );
      const cachedDecks = await withSpan('db.load_cached_decks', { 'commander.slug': commanderSlug }, () =>
        loadDecksForCommanderFromWrite(commanderSlug)
      );
      const bannedCardsNormalized = await withSpan('banlist.load', {}, () => getDuelCommanderDeckBannedCardsNormalized());

      const analysis = await withSpan(
        'analysis.compute',
        {
          'analysis.cached_decks': cachedDecks.length,
          'analysis.inserted_decks': insertedDeckRows
        },
        () =>
          analyzeCards(inputDeck, cachedDecks, {
            startDate: input.startDate,
            endDate: input.endDate,
            requiredCards: input.requiredCards,
            keepTop: input.keepTop,
            cutTop: input.cutTop,
            addTop: input.addTop,
            bannedCardsNormalized
          })
      );

      input.onProgress?.({
        stage: 'done',
        message: 'Analysis complete.',
        percentHint: 100
      });

      return {
        moxfieldDeck: inputDeck,
        commander: commanderInfo,
        analyzedAt: new Date().toISOString(),
        analysis,
        cache: {
          latestCachedEventDate: latestCachedEventDate ? formatDate(latestCachedEventDate) : null,
          fetchedDeckRows: newDeckRows.length,
          insertedDeckRows,
          totalCachedDeckRows: cachedDecks.length
        }
      };
    }
  );
}

export async function analyzeFromMoxfieldUrl(input: {
  moxfieldUrl: string;
  requiredCards?: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  keepTop?: number;
  cutTop?: number;
  addTop?: number;
  refreshCache?: boolean;
  headless?: boolean;
  maxPages?: number;
  delaySeconds?: number;
  mtgtop8DeckFetchConcurrency?: number;
  onProgress?: (event: AnalyzePipelineProgressEvent) => void;
}): Promise<AnalyzeOutput> {
  return await analyzeFromDeckUrl({
    deckUrl: input.moxfieldUrl,
    requiredCards: input.requiredCards,
    startDate: input.startDate,
    endDate: input.endDate,
    keepTop: input.keepTop,
    cutTop: input.cutTop,
    addTop: input.addTop,
    refreshCache: input.refreshCache,
    headless: input.headless,
    maxPages: input.maxPages,
    delaySeconds: input.delaySeconds,
    mtgtop8DeckFetchConcurrency: input.mtgtop8DeckFetchConcurrency,
    onProgress: input.onProgress
  });
}

function resolveMtgTop8DeckFetchConcurrency(override?: number): number {
  const candidate =
    typeof override === 'number' && Number.isFinite(override)
      ? override
      : Number(process.env.MTGTOP8_DECK_FETCH_CONCURRENCY || '3');
  if (!Number.isFinite(candidate)) {
    return 3;
  }
  return Math.max(1, Math.min(12, Math.trunc(candidate)));
}

function computeMtgTop8PercentHint(event: CrawlProgressEvent): number {
  const mtgTop8Start = 20;
  const mtgTop8Range = 70;

  if (!event.totalPages || event.totalPages <= 0) {
    if (event.phase === 'complete') {
      return mtgTop8Start + mtgTop8Range;
    }
    return mtgTop8Start + Math.min(10, event.scannedPages * 2);
  }

  const pageBase = Math.max(0, (event.currentPage - 1) / event.totalPages);
  const pageWithin =
    event.rowsToFetchOnPage > 0 ? event.fetchedOnPage / event.rowsToFetchOnPage : event.phase === 'page' ? 0 : 1;
  const ratio = Math.max(0, Math.min(1, pageBase + pageWithin / event.totalPages));
  return mtgTop8Start + mtgTop8Range * ratio;
}

function formatMtgTop8Message(event: CrawlProgressEvent): string {
  if (event.phase === 'start') {
    return 'Fetching MtgTop8 pages...';
  }
  if (event.phase === 'complete') {
    return `Fetched ${event.fetchedDecks} MtgTop8 deck${event.fetchedDecks === 1 ? '' : 's'}.`;
  }

  const pageLabel =
    event.totalPages && event.totalPages > 0
      ? `page ${event.currentPage}/${event.totalPages}`
      : `page ${event.currentPage}`;

  if (event.phase === 'page') {
    return `Scanning MtgTop8 ${pageLabel} (${event.rowsToFetchOnPage} new deck${event.rowsToFetchOnPage === 1 ? '' : 's'}).`;
  }

  return `Fetching decklists on ${pageLabel} (${event.fetchedOnPage}/${event.rowsToFetchOnPage}).`;
}
