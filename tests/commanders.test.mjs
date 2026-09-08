import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commanderCard, compatibleCommanders, splitCommanders } from '../src/lib/commanders.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/commanders.json', import.meta.url)));
const get = (name) => commanderCard(raw.find((card) => card.name === name));
const card = (name, text, type = 'Legendary Creature — Human') => commanderCard({ id: name, name, type_line: type, oracle_text: text });

test('regular partners and text groups are distinct, including both saved Ellie commanders', () => {
  const yoshimaru = get('Yoshimaru, Ever Faithful');
  const ellie = get('Ellie, Brick Master');
  assert.equal(compatibleCommanders(yoshimaru, get("Kraum, Ludevic's Opus")), true);
  assert.equal(compatibleCommanders(ellie, get('Ellie, Vengeful Hunter')), true);
  assert.equal(compatibleCommanders(ellie, yoshimaru), false);
  assert.equal(compatibleCommanders(ellie, get('Cecily, Haunted Mage')), false);
  for (const group of ['Friends forever', 'Father & son', 'Character select', 'Survivors']) {
    assert.equal(compatibleCommanders(card('A', `Partner—${group} (Reminder.)`), card('B', `Partner—${group}`)), true);
  }
  assert.equal(compatibleCommanders(get('Cecily, Haunted Mage'), card('Legacy', 'Friends forever (Reminder.)')), true);
  assert.equal(compatibleCommanders(yoshimaru, { ...yoshimaru, id: 'another-printing' }), false);
});

test('named partners require reciprocal names and allow commander planeswalkers', () => {
  const will = get('Will Kenrith');
  const rowan = card('Rowan Kenrith', 'Partner with Will Kenrith\nRowan Kenrith can be your commander.', 'Legendary Planeswalker — Rowan');
  assert.equal(compatibleCommanders(will, rowan), true);
  assert.equal(compatibleCommanders(will, get('Yoshimaru, Ever Faithful')), false);
  assert.equal(compatibleCommanders(will, card('Rowan Kenrith', 'Partner with Somebody Else')), false);
});

test('Background and Doctor pairings work in either input order', () => {
  const pairs = [[get("Abdel Adrian, Gorion's Ward"), get('Noble Heritage')], [get('Clara Oswald'), get('The First Doctor')]];
  for (const [a, b] of pairs) {
    assert.equal(compatibleCommanders(a, b), true);
    assert.equal(compatibleCommanders(b, a), true);
    assert.equal(compatibleCommanders(a, get('Yoshimaru, Ever Faithful')), false);
  }
  assert.equal(compatibleCommanders(get('Clara Oswald'), card('Extra types', '', 'Legendary Creature — Time Lord Doctor Human')), false);
  assert.equal(compatibleCommanders(get("Abdel Adrian, Gorion's Ward"), card('Not legendary', '', 'Enchantment — Background')), false);
  assert.equal(compatibleCommanders(get('Faceless One'), get('Noble Heritage')), true);
});

test('Companion, rule mentions, tokens, and back faces do not introduce partner abilities', () => {
  assert.deepEqual(card('Companion', 'Companion — Your deck…').pairings, []);
  assert.deepEqual(card('Reminder', 'Other creatures with partner have flying.').pairings, []);
  assert.equal(card('Token', 'Partner', 'Token Creature — Human').eligible, false);
  const dfc = commanderCard({ id: 'dfc', name: 'Front // Back', type_line: 'Creature // Creature', card_faces: [
    { name: 'Front', type_line: 'Legendary Creature — Human', oracle_text: 'Transform Front.' },
    { name: 'Back', type_line: 'Legendary Creature — Human', oracle_text: 'Partner' }
  ] });
  assert.equal(dfc.eligible, true);
  assert.deepEqual(dfc.pairings, []);
  assert.deepEqual(splitCommanders('Front // Back'), ['Front // Back', '']);
  assert.deepEqual(splitCommanders('Ellie, Brick Master + Ellie, Vengeful Hunter'), ['Ellie, Brick Master', 'Ellie, Vengeful Hunter']);
});

test('Scryfall adapter caches concurrent lookups, escapes search text, filters pairs, and recovers from failures', async () => {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  try {
    const api = await vite.ssrLoadModule('/src/lib/server/scryfall-commanders.ts');
    const calls = [];
    let unavailable = false;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: new URL(url), time: Date.now() });
      assert.ok(init.headers['User-Agent'].startsWith('Karton/'));
      if (unavailable) return new Response('', { status: 503 });
      const parsed = new URL(url);
      const payload = parsed.pathname === '/cards/search' ? { data: raw }
        : parsed.pathname === '/cards/named' ? raw.find((card) => card.name === parsed.searchParams.get('exact'))
        : raw.find((card) => card.id === parsed.pathname.split('/').at(-1));
      return new Response(JSON.stringify(payload ?? {}), { status: payload ? 200 : 404 });
    };
    const [first, same] = await Promise.all([api.findCommander('Ellie, Brick Master'), api.findCommander('Ellie, Brick Master')]);
    assert.deepEqual(first, same);
    assert.equal(calls.length, 1);
    const matches = await api.searchCommanders('', first.id);
    assert.deepEqual(matches.map((card) => card.name), ['Ellie, Vengeful Hunter']);
    assert.ok(calls.slice(1).every((call, index) => call.time - calls[index].time >= 125));
    await api.searchCommanders('Ellie" or t:land');
    assert.ok(calls.at(-1).url.searchParams.get('q').includes('name:"Ellie\\" or t:land"'));
    assert.equal(await api.findCommander('Missing commander'), null);
    unavailable = true;
    await assert.rejects(api.findCommander('Nissa, Resurgent Animist'));
    unavailable = false;
    assert.equal((await api.findCommander('Nissa, Resurgent Animist')).name, 'Nissa, Resurgent Animist');
  } finally { globalThis.fetch = originalFetch; await vite.close(); }
});
