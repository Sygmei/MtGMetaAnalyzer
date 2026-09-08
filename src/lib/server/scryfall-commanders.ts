import { commanderCard, compatibleCommanders, type CommanderCard, type ScryfallCommanderCard } from '../commanders';

const origin = 'https://api.scryfall.com';
const eligibility = '(is:commander or (t:legendary t:background))';
const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const cache = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
let queue = Promise.resolve();
let nextRequest = 0;

async function request(path: string): Promise<any> {
  const cached = cache.get(path);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pending.has(path)) return pending.get(path);
  // A single queue spaces all upstream requests, including concurrent roster hydration.
  if (pending.size >= 64) throw new Error('Scryfall request queue full');
  const result = queue.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
    nextRequest = Date.now() + 150;
    const response = await fetch(`${origin}${path}`, {
      headers: { 'User-Agent': 'Karton/0.1 (tournament commander selection)', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (response.status === 429) nextRequest = Date.now() + 1000;
    if (!response.ok && response.status !== 404) throw new Error(`Scryfall returned ${response.status}`);
    const value = response.status === 404 ? null : await response.json();
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(path, { value, expires: Date.now() + (value ? 60 * 60 * 1000 : 60000) });
    return value;
  });
  queue = result.then(() => {}, () => {});
  pending.set(path, result);
  try { return await result; } finally { pending.delete(path); }
}

export async function findCommander(name: string): Promise<CommanderCard | null> {
  const card = await request(`/cards/named?${new URLSearchParams({ exact: name })}`);
  return card ? commanderCard(card) : null;
}

function partnerQuery(card: CommanderCard): string {
  return card.pairings.map((pairing) => {
    switch (pairing.kind) {
      case 'partner': return pairing.group
        ? `o:${quote(`Partner—${pairing.group}`)}`
        : '(kw:partner -o:"Partner with" -o:"Partner—")';
      case 'named': return `!${quote(pairing.name)}`;
      case 'choose-background': return '(t:legendary t:enchantment t:background)';
      case 'background': return 'o:"Choose a Background"';
      case 'doctor': return 'o:"Doctor\'s companion"';
      case 'doctors-companion': return '(t:legendary t:creature t:"Time Lord" t:doctor)';
    }
  }).join(' or ');
}

export async function searchCommanders(query: string, withId?: string): Promise<CommanderCard[]> {
  const rawPrimary = withId ? await request(`/cards/${withId}`) : null;
  const primary = rawPrimary ? commanderCard(rawPrimary) : null;
  if (withId && (!primary || !primary.pairings.length)) return [];
  const q = `${eligibility}${query ? ` name:${quote(query)}` : ''}${primary ? ` (${partnerQuery(primary)})` : ''}`;
  const result = await request(`/cards/search?${new URLSearchParams({ q, unique: 'cards', order: 'name' })}`);
  return (result?.data ?? []).map((raw: ScryfallCommanderCard) => commanderCard(raw))
    .filter((card: CommanderCard) => card.eligible && (!primary || compatibleCommanders(primary, card))).slice(0, 12);
}
