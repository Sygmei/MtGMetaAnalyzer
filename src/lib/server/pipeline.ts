import { analyzeCards } from './analysis';
import { fetchMoxfieldDeck } from './moxfield';
import {
  getLatestCachedEventDate,
  insertDecksForCommander,
  loadDecksForCommander,
  upsertCommanderCache
} from './mtgtop8-cache-repo';
import { MtgTop8Client, type CrawlProgressEvent } from './mtgtop8';
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
  const headless = input.headless ?? true;
  input.onProgress?.({
    stage: 'moxfield',
    message: 'Fetching Moxfield deck...',
    percentHint: 5
  });
  const moxfieldDeck = await fetchMoxfieldDeck(input.moxfieldUrl, { headless });

  const mtgtop8 = new MtgTop8Client(25_000, input.delaySeconds ?? 0.2);
  input.onProgress?.({
    stage: 'commander',
    message: 'Matching commander on MtgTop8...',
    percentHint: 14
  });
  const commanderEntry = await mtgtop8.findCommanderEntry(moxfieldDeck.commanders);
  const commanderSlug = slugify(commanderEntry.name);

  const commanderInfo = {
    moxfieldCommanderQuery: moxfieldDeck.commanders.join(' / '),
    name: commanderEntry.name,
    score: commanderEntry.score,
    url: commanderEntry.url,
    slug: commanderSlug
  };

  await upsertCommanderCache({
    slug: commanderSlug,
    commanderName: commanderInfo.name,
    commanderUrl: commanderInfo.url,
    moxfieldCommanderQuery: commanderInfo.moxfieldCommanderQuery,
    score: commanderInfo.score
  });

  const refresh = Boolean(input.refreshCache);
  const latestCachedEventDate = refresh ? null : await getLatestCachedEventDate(commanderSlug);

  input.onProgress?.({
    stage: 'mtgtop8',
    message: 'Fetching MtgTop8 decks...',
    percentHint: 20
  });
  const newDeckRows = await mtgtop8.crawlCommanderDecks(commanderEntry.url, {
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
  });

  input.onProgress?.({
    stage: 'analysis',
    message: 'Running keep / cut / add analysis...',
    percentHint: 92
  });
  const insertedDeckRows = await insertDecksForCommander(commanderSlug, newDeckRows);
  const cachedDecks = await loadDecksForCommander(commanderSlug);

  const analysis = analyzeCards(moxfieldDeck, cachedDecks, {
    startDate: input.startDate,
    endDate: input.endDate,
    keepTop: input.keepTop,
    cutTop: input.cutTop,
    addTop: input.addTop
  });

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
