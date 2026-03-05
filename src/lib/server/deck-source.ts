import { AppError } from './app-error';
import { fetchArchidektDeck, normalizeArchidektDeckUrl } from './archidekt';
import { fetchMoxfieldDeck, normalizeMoxfieldDeckUrl } from './moxfield';
import type { DeckSource, InputDeck } from './types';

interface FetchInputDeckOptions {
  headless?: boolean;
}

export interface ResolvedDeckUrl {
  source: DeckSource;
  normalizedUrl: string;
}

export function normalizeSupportedDeckUrl(value: string): ResolvedDeckUrl {
  const input = String(value || '').trim();
  if (!input) {
    throw new AppError({
      userFacingError: 'Deck URL is required.',
      adminFacingError: 'Deck URL is empty.',
      errorTypeName: 'DeckUrlMissingError',
      httpStatusCode: 400
    });
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new AppError({
      userFacingError: 'Invalid deck URL. Use moxfield.com/decks/<id> or archidekt.com/decks/<id>.',
      adminFacingError: `Deck URL parse failure: ${value}`,
      errorTypeName: 'DeckUrlInvalidError',
      httpStatusCode: 400
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'moxfield.com' || host === 'www.moxfield.com') {
    return {
      source: 'moxfield',
      normalizedUrl: normalizeMoxfieldDeckUrl(input)
    };
  }
  if (host === 'archidekt.com' || host === 'www.archidekt.com') {
    return {
      source: 'archidekt',
      normalizedUrl: normalizeArchidektDeckUrl(input)
    };
  }

  throw new AppError({
    userFacingError: 'Unsupported deck host. Use moxfield.com or archidekt.com.',
    adminFacingError: `Unsupported deck host: ${host} input=${value}`,
    errorTypeName: 'DeckHostUnsupportedError',
    httpStatusCode: 400
  });
}

export async function fetchInputDeckFromUrl(value: string, options: FetchInputDeckOptions = {}): Promise<InputDeck> {
  const resolved = normalizeSupportedDeckUrl(value);
  if (resolved.source === 'moxfield') {
    return await fetchMoxfieldDeck(resolved.normalizedUrl, { headless: options.headless ?? true });
  }
  return await fetchArchidektDeck(resolved.normalizedUrl);
}

