import { commanderCard, compatibleCommanders, type CommanderCard, type ScryfallCommanderCard } from '../commanders';

import { request, quote } from './scryfall-client';

const eligibility = '(is:commander or (t:legendary t:background))';

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
