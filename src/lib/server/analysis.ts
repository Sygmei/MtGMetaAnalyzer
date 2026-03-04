import type { AnalysisResult, CardStat, DeckRecord, MoxfieldDeck } from './types';
import { formatDate, normalizeName, parseDate, toDateStart } from './utils';

interface AnalyzeOptions {
  startDate?: Date | null;
  endDate?: Date | null;
  keepTop?: number;
  cutTop?: number;
  addTop?: number;
  bannedCardsNormalized?: Set<string>;
}

export function analyzeCards(
  moxfieldDeck: MoxfieldDeck,
  cachedDecks: DeckRecord[],
  options: AnalyzeOptions = {}
): AnalysisResult {
  const keepTop = options.keepTop ?? 50;
  const cutTop = options.cutTop ?? 50;
  const addTop = options.addTop ?? 50;
  const bannedCards = options.bannedCardsNormalized || new Set<string>();

  const startBoundary = options.startDate ? toDateStart(options.startDate) : Number.NEGATIVE_INFINITY;
  const endBoundary = options.endDate ? toDateStart(options.endDate) : Number.POSITIVE_INFINITY;

  const commanderSet = new Set(moxfieldDeck.commanders);
  const commanderNormSet = new Set(moxfieldDeck.commanders.map((name) => normalizeName(name)));
  const moxfieldCardNames = Object.keys(moxfieldDeck.cards).filter((card) => !commanderSet.has(card));
  const moxfieldCardSet = new Set(Object.keys(moxfieldDeck.cards));

  const filteredDecks: DeckRecord[] = [];
  for (const deck of cachedDecks) {
    const parsedDate = parseDate(deck.eventDate);
    if (!parsedDate) {
      continue;
    }
    const stamp = toDateStart(parsedDate);
    if (stamp < startBoundary || stamp > endBoundary) {
      continue;
    }
    filteredDecks.push(deck);
  }

  const frequencies: Record<string, number> = {};
  for (const name of moxfieldCardNames) {
    frequencies[name] = 0;
  }

  const addFrequencies: Record<string, number> = {};
  for (const deck of filteredDecks) {
    const deckMainCards = deckMainboardCardSet(deck, commanderNormSet);

    for (const name of moxfieldCardNames) {
      if (deckMainCards.has(name)) {
        frequencies[name] += 1;
      }
    }

    for (const card of deckMainCards) {
      if (moxfieldCardSet.has(card)) {
        continue;
      }
      addFrequencies[card] = (addFrequencies[card] || 0) + 1;
    }
  }

  const totalDecks = filteredDecks.length;
  const keepCutStats: CardStat[] = moxfieldCardNames.map((card) =>
    buildCardStat(card, frequencies[card], totalDecks, bannedCards)
  );

  const toAddStats: CardStat[] = Object.entries(addFrequencies).map(([card, decksWithCard]) =>
    buildCardStat(card, decksWithCard, totalDecks, bannedCards)
  );

  const byDesc = (a: CardStat, b: CardStat): number => {
    if (a.decksWithCard !== b.decksWithCard) {
      return b.decksWithCard - a.decksWithCard;
    }
    return a.card.localeCompare(b.card);
  };
  const byAsc = (a: CardStat, b: CardStat): number => {
    if (a.decksWithCard !== b.decksWithCard) {
      return a.decksWithCard - b.decksWithCard;
    }
    return a.card.localeCompare(b.card);
  };

  const allStats = [...keepCutStats].sort(byDesc);
  const keep = allStats.slice(0, keepTop);
  const cut = [...keepCutStats].sort(byAsc).slice(0, cutTop);
  const toAdd = [...toAddStats].sort(byDesc).slice(0, addTop);

  return {
    startDate: options.startDate ? formatDate(options.startDate) : null,
    endDate: options.endDate ? formatDate(options.endDate) : null,
    totalDecksConsidered: totalDecks,
    keep,
    cut,
    toAdd,
    allStats
  };
}

function deckMainboardCardSet(deck: DeckRecord, commanderNormSet: Set<string>): Set<string> {
  const main = deck.sections.main;
  if (main && Object.keys(main).length) {
    return new Set(Object.keys(main));
  }

  return new Set(
    Object.keys(deck.cards).filter((name) => !commanderNormSet.has(normalizeName(name)))
  );
}

function buildCardStat(
  card: string,
  decksWithCard: number,
  totalDecks: number,
  bannedCardsNormalized: Set<string>
): CardStat {
  return {
    card,
    decksWithCard,
    totalDecks,
    ratio: totalDecks > 0 ? decksWithCard / totalDecks : 0,
    banned: bannedCardsNormalized.has(normalizeName(card))
  };
}
