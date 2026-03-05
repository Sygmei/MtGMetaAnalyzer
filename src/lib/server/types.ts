export type CardMap = Record<string, number>;

export type DeckSource = 'moxfield' | 'archidekt';

export interface InputDeck {
  source: DeckSource;
  deckId: string;
  name: string;
  url: string;
  commanders: string[];
  cards: CardMap;
}

export type MoxfieldDeck = InputDeck;

export interface DeckRecord {
  deckName: string;
  player: string;
  event: string;
  eventLevel: string;
  rank: string;
  eventDate: string;
  deckUrl: string;
  pageUrl: string;
  cards: CardMap;
  sections: Record<string, CardMap>;
}

export interface CommanderEntry {
  name: string;
  url: string;
  score: number;
}

export interface CardStat {
  card: string;
  decksWithCard: number;
  totalDecks: number;
  ratio: number;
  banned?: boolean;
}

export interface AnalysisResult {
  startDate: string | null;
  endDate: string | null;
  totalDecksConsidered: number;
  keep: CardStat[];
  cut: CardStat[];
  toAdd: CardStat[];
  allStats: CardStat[];
}

export interface CachedCommanderInfo {
  moxfieldCommanderQuery: string;
  name: string;
  score: number;
  url: string;
  slug: string;
}

export interface AnalyzeOutput {
  moxfieldDeck: InputDeck;
  commander: CachedCommanderInfo;
  analyzedAt: string;
  analysis: AnalysisResult;
  share?: {
    id: string;
    url: string;
  };
  cache: {
    latestCachedEventDate: string | null;
    fetchedDeckRows: number;
    insertedDeckRows: number;
    totalCachedDeckRows: number;
  };
}
