export type CardMap = Record<string, number>;

export type DeckSource = 'moxfield' | 'archidekt' | 'manabox';
export type CardListSource = DeckSource | 'mythic-tools';

export interface InputDeck {
  source: DeckSource;
  deckId: string;
  name: string;
  url: string;
  commanders: string[];
  cards: CardMap;
}

export type CommanderAnalysisDeck = Omit<InputDeck, 'source'> & { source: 'commander' };
export type AnalysisDeck = InputDeck | CommanderAnalysisDeck;
export type MoxfieldDeck = InputDeck;

export interface CardList {
  source: CardListSource;
  listId: string;
  name: string;
  url: string;
  cards: CardMap;
}

export interface MatchedCard {
  card: string;
  buyerQuantity: number;
  sellerQuantity: number;
  matchedQuantity: number;
  buyers: Array<{ listName: string; url: string; quantity: number }>;
  sellers: Array<{ listName: string; url: string; quantity: number }>;
}

export interface CardListWarning {
  role: 'buyer' | 'seller';
  listName: string;
  url: string;
  message: string;
}

export interface CardListMatchResult {
  buyers: CardList[];
  sellers: CardList[];
  matches: MatchedCard[];
  warnings: CardListWarning[];
  totals: {
    buyerLists: number;
    sellerLists: number;
    buyerCards: number;
    sellerCards: number;
    uniqueBuyerCards: number;
    uniqueSellerCards: number;
    matchedCards: number;
    matchedQuantity: number;
  };
}

export interface UserContactMatchResult {
  sellersToContact: CardListMatchResult;
  buyersToContact: CardListMatchResult;
}

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
  requiredCards?: string[];
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
  moxfieldDeck: AnalysisDeck;
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
