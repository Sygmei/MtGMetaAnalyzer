/** Only front-face characteristics determine commander eligibility and pairing. */
export interface ScryfallCommanderCard {
  id: string;
  oracle_id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  card_faces?: { name: string; type_line?: string; oracle_text?: string; power?: string; toughness?: string }[];
}

export type CommanderPairing =
  | { kind: 'partner'; group: string }
  | { kind: 'named'; name: string }
  | { kind: 'choose-background' | 'background' | 'doctor' | 'doctors-companion' };

export interface CommanderCard {
  id: string;
  oracleId: string;
  name: string;
  frontName: string;
  typeLine: string;
  pairings: CommanderPairing[];
  eligible: boolean;
}

export function commanderCard(card: ScryfallCommanderCard): CommanderCard {
  const front = card.card_faces?.[0] ?? card;
  const typeLine = front.type_line ?? '';
  const text = front.oracle_text ?? '';
  const legendary = /\bLegendary\b/.test(typeLine);
  const creature = /\bCreature\b/.test(typeLine);
  const background = legendary && /\bEnchantment\b/.test(typeLine) && /\bBackground\b/.test(typeLine);
  const pairings: CommanderPairing[] = [];
  // Parse the ability itself, not mentions inside reminder text or other abilities.
  for (const line of text.split('\n').map((line) => line.trim().split(' (')[0])) {
    const named = /^Partner with (.+)$/.exec(line);
    const group = /^Partner\s*[—–-]\s*(.+)$/.exec(line);
    if (named) pairings.push({ kind: 'named', name: named[1] });
    else if (group) pairings.push({ kind: 'partner', group: group[1] });
    else if (/^Partner$/i.test(line)) pairings.push({ kind: 'partner', group: '' });
    else if (/^Friends forever$/i.test(line)) pairings.push({ kind: 'partner', group: 'Friends forever' });
    else if (/^Choose a Background$/i.test(line)) pairings.push({ kind: 'choose-background' });
    else if (/^Doctor['’]s companion$/i.test(line)) pairings.push({ kind: 'doctors-companion' });
  }
  if (background) pairings.push({ kind: 'background' });
  if (legendary && creature && typeLine.split('—')[1]?.trim() === 'Time Lord Doctor') pairings.push({ kind: 'doctor' });
  const eligible = background || (legendary && (creature || /\bVehicle\b/.test(typeLine)
    || (/\bSpacecraft\b/.test(typeLine) && front.power !== undefined && front.toughness !== undefined)))
    || /\bcan be your commander\b/i.test(text);
  return { id: card.id, oracleId: card.oracle_id ?? card.id, name: card.name, frontName: front.name,
    typeLine, eligible, pairings: eligible ? pairings : [] };
}

const same = (a: string, b: string) => a.toLocaleLowerCase('en') === b.toLocaleLowerCase('en');

export function compatibleCommanders(first: CommanderCard, second: CommanderCard): boolean {
  if (!first.eligible || !second.eligible || first.oracleId === second.oracleId || same(first.name, second.name)) return false;
  return first.pairings.some((a) => second.pairings.some((b) => {
    if (a.kind === 'partner' && b.kind === 'partner') return same(a.group, b.group);
    if (a.kind === 'named' && b.kind === 'named') return same(a.name, second.frontName) && same(b.name, first.frontName);
    return (a.kind === 'choose-background' && b.kind === 'background')
      || (a.kind === 'background' && b.kind === 'choose-background')
      || (a.kind === 'doctor' && b.kind === 'doctors-companion')
      || (a.kind === 'doctors-companion' && b.kind === 'doctor');
  }));
}

export function splitCommanders(value: string): [string, string] {
  const [first = '', ...rest] = value.split(/\s+\+\s+/);
  return [first, rest.join(' + ')];
}
