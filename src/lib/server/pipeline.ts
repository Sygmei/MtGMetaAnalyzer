import { analyzeCards } from './analysis';
import { getDuelCommanderDeckBannedCardsNormalized } from './duel-commander-banlist';
import { fetchMoxfieldDeck } from './moxfield';
import {
  getLatestCachedEventDate,
  insertDecksForCommander,
  loadDecksForCommander,
  upsertCommanderCache
} from './mtgtop8-cache-repo';
import { MtgTop8Client, type CrawlProgressEvent } from './mtgtop8';
import { withSpan } from './otel';
import type { AnalyzeOutput } from './types';
import { formatDate, slugify } from './utils';

interface AnalyzePipelineInput {
  moxfieldUrl: string;
  startDate?: Date | null;
  endDate?: Date | null;
  keepTop?: number;
  cutTop?: number;
  addTop?: number;
  refreshCache?: boolean;
  headless?: boolean;
  maxPages?: number;
  delaySeconds?: number;
  onProgress?: (event: AnalyzePipelineProgressEvent) => void;
}

export interface AnalyzePipelineProgressEvent {
  stage: 'moxfield' | 'commander' | 'mtgtop8' | 'analysis' | 'done';
  message: string;
  percentHint: number;
  mtgtop8?: CrawlProgressEvent;
}

export async function analyzeFromMoxfieldUrl(input: AnalyzePipelineInput): Promise<AnalyzeOutput> {
  return await withSpan(
    'analysis.pipeline',
    {
      'analysis.moxfield_url': input.moxfieldUrl,
      'analysis.keep_top': input.keepTop ?? 50,
      'analysis.cut_top': input.cutTop ?? 50,
      'analysis.add_top': input.addTop ?? 50
    },
    async (pipelineSpan) => {
      const headless = input.headless ?? true;
      input.onProgress?.({
        stage: 'moxfield',
        message: 'Fetching Moxfield deck...',
        percentHint: 5
      });
      const moxfieldDeck = await withSpan(
        'moxfield.fetch_deck',
        { 'moxfield.url': input.moxfieldUrl, 'moxfield.headless': headless },
        () => fetchMoxfieldDeck(input.moxfieldUrl, { headless })
      );

      const mtgtop8 = new MtgTop8Client(25_000, input.delaySeconds ?? 0.2);
      input.onProgress?.({
        stage: 'commander',
        message: 'Matching commander on MtgTop8...',
        percentHint: 14
      });
      const commanderEntry = await withSpan(
        'mtgtop8.find_commander',
        { 'commander.query_count': moxfieldDeck.commanders.length },
        () => mtgtop8.findCommanderEntry(moxfieldDeck.commanders)
      );
      const commanderSlug = slugify(commanderEntry.name);
      pipelineSpan.setAttribute('commander.slug', commanderSlug);
      pipelineSpan.setAttribute('commander.name', commanderEntry.name);

      const commanderInfo = {
        moxfieldCommanderQuery: moxfieldDeck.commanders.join(' / '),
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
      const newDeckRows = await withSpan(
        'mtgtop8.crawl_decks',
        { 'commander.slug': commanderSlug, 'mtgtop8.max_pages': input.maxPages ?? 0 },
        () =>
          mtgtop8.crawlCommanderDecks(commanderEntry.url, {
            maxPages: input.maxPages,
            delaySeconds: input.delaySeconds,
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

      input.onProgress?.({
        stage: 'analysis',
        message: 'Running keep / cut / add analysis...',
        percentHint: 92
      });
      const insertedDeckRows = await withSpan('db.insert_decks', { 'commander.slug': commanderSlug }, () =>
        insertDecksForCommander(commanderSlug, newDeckRows)
      );
      const cachedDecks = await withSpan('db.load_cached_decks', { 'commander.slug': commanderSlug }, () =>
        loadDecksForCommander(commanderSlug)
      );
      const bannedCardsNormalized = await withSpan('banlist.load', {}, () => getDuelCommanderDeckBannedCardsNormalized());

      const analysis = await withSpan(
        'analysis.compute',
        {
          'analysis.cached_decks': cachedDecks.length,
          'analysis.inserted_decks': insertedDeckRows
        },
        () =>
          analyzeCards(moxfieldDeck, cachedDecks, {
            startDate: input.startDate,
            endDate: input.endDate,
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
        moxfieldDeck,
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
