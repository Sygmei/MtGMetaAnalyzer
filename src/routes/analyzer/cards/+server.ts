import { json, error } from '@sveltejs/kit';
import { searchCards } from '$lib/server/scryfall-cards';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q')?.trim() ?? '';
  if (query.length > 150) error(400, 'Invalid card search.');
  if (query.length < 2) return json({ cards: [] });
  try {
    return json({ cards: await searchCards(query) }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch {
    error(503, 'Card search is temporarily unavailable. Please try again.');
  }
};
