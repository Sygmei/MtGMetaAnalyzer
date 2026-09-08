import { compatibleCommanders, splitCommanders } from '../commanders';
import { AppError } from './app-error';
import { findCommander } from './scryfall-commanders';
import type { CommanderAnalysisDeck } from './types';

export async function resolveCommanderAnalysisDeck(value: string): Promise<CommanderAnalysisDeck> {
  const names = splitCommanders(value).map((name) => name.trim()).filter(Boolean);
  const invalid = (message: string) => new AppError({
    userFacingError: message, adminFacingError: message,
    errorTypeName: 'InvalidAnalysisCommander', httpStatusCode: 400
  });
  if (!names.length || names.some((name) => name.length > 150)) {
    throw invalid('Enter a commander name (up to 150 characters per commander).');
  }
  let cards;
  try {
    cards = await Promise.all(names.map(findCommander));
  } catch (cause) {
    throw new AppError({
      userFacingError: 'Commander lookup is temporarily unavailable. Please try again.',
      adminFacingError: 'Scryfall failed while resolving analysis commanders.',
      errorTypeName: 'AnalysisCommanderLookupUnavailable', httpStatusCode: 503, cause
    });
  }
  if (cards.some((card) => !card?.eligible)) {
    throw invalid('Choose a valid commander from the suggestions.');
  }
  const resolved = cards.filter((card) => card !== null);
  if (resolved.length === 2 && !compatibleCommanders(resolved[0], resolved[1])) {
    throw invalid('These commanders cannot be paired. Choose a compatible second commander.');
  }
  const commanders = resolved.map((card) => card.name);
  return { source: 'commander', deckId: '', name: commanders.join(' + '), url: '', commanders, cards: {} };
}
