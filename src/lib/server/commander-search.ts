import { json, error } from '@sveltejs/kit';
import { findCommander, searchCommanders } from './scryfall-commanders';

export async function commanderSearchResponse(url: URL) {
  const name = url.searchParams.get('name')?.trim();
  const query = url.searchParams.get('q')?.trim() ?? '';
  const withId = url.searchParams.get('with') ?? undefined;
  if ((name?.length ?? 0) > 300 || query.length > 150 || (withId && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(withId))) {
    error(400, 'Invalid commander search.');
  }
  if (!name && !withId && query.length < 2) return json({ cards: [] });
  try {
    return json(name ? { card: await findCommander(name) } : { cards: await searchCommanders(query, withId) },
      { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch {
    error(503, 'Scryfall is temporarily unavailable. You can still enter commander names manually.');
  }
}
