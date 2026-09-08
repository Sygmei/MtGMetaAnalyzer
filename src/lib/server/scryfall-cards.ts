import { request, quote } from './scryfall-client';

export async function searchCards(query: string): Promise<Array<{ name: string; typeLine: string }>> {
  const q = `name:${quote(query)}`;
  const result = await request(`/cards/search?${new URLSearchParams({ q, unique: 'cards', order: 'name' })}`);
  return (result?.data ?? []).slice(0, 12).map((card: { name: string; type_line?: string }) => ({
    name: card.name,
    typeLine: card.type_line ?? ''
  }));
}
