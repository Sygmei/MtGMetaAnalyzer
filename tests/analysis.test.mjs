import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite;
let analyzeCards;
before(async () => {
  vite = await createServer({ configFile: false, resolve: { alias: { '$lib': new URL('../src/lib', import.meta.url).pathname } },
    server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  ({ analyzeCards } = await vite.ssrLoadModule('/src/lib/server/analysis.ts'));
});
after(async () => { await vite?.close(); });

const input = {
  source: 'moxfield', deckId: 'test', name: 'Test', url: '',
  commanders: ['Commander'], cards: { Commander: 1, 'Lightning Bolt': 1, Island: 10 }
};
const deck = (cards, eventDate = '2026-09-01') => ({
  deckName: 'Test', player: '', event: '', eventLevel: '', rank: '',
  eventDate, deckUrl: '', pageUrl: '', cards, sections: { main: cards }
});
const decks = [
  deck({ 'Lightning Bolt': 1, Island: 10, Counterspell: 1 }),
  deck({ 'Lightning Bolt': 1, Mountain: 10 }),
  deck({ Island: 10, Counterspell: 1 })
];

test('empty card filters preserve the existing analysis', () => {
  assert.deepEqual(analyzeCards(input, decks, { requiredCards: [' ', ''] }), analyzeCards(input, decks));
  assert.equal(analyzeCards(input, decks).totalDecksConsidered, 3);
});

test('every required card must match and statistics use only matching decks', () => {
  const result = analyzeCards(input, decks, { requiredCards: ['Lightning Bolt', 'Island'] });
  assert.equal(result.totalDecksConsidered, 1);
  assert.equal(result.keep.find((card) => card.card === 'Lightning Bolt').ratio, 1);
  assert.deepEqual(result.toAdd.map((card) => [card.card, card.decksWithCard, card.totalDecks]), [['Counterspell', 1, 1]]);
});

test('card names ignore case and whitespace, deduplicate, and preserve commas', () => {
  const result = analyzeCards(input, [deck({ 'Thalia, Guardian of Thraben': 1 })], {
    requiredCards: ['  Thalia, Guardian of Thraben  ', 'thalia, guardian of thraben', '']
  });
  assert.equal(result.totalDecksConsidered, 1);
  assert.equal(result.requiredCards.length, 1);
  assert.equal(analyzeCards(input, decks, { requiredCards: ['Bolt'] }).totalDecksConsidered, 0);
});

test('double-faced card names match either face and abbreviated deck names', () => {
  const full = 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki';
  for (const required of [full, 'Fable of the Mirror-Breaker', 'Reflection of Kiki-Jiki']) {
    assert.equal(analyzeCards(input, [deck({ [full]: 1 })], { requiredCards: [required] }).totalDecksConsidered, 1);
  }
  assert.equal(analyzeCards(input, [deck({ 'Fable of the Mirror-Breaker': 1 })], { requiredCards: [full] }).totalDecksConsidered, 1);
});

test('card filters combine with inclusive date boundaries', () => {
  const result = analyzeCards(input, [
    deck({ 'Lightning Bolt': 1 }, '2026-08-31'),
    deck({ 'Lightning Bolt': 1 }, '2026-09-01'),
    deck({ 'Lightning Bolt': 1 }, '2026-09-02'),
    deck({ 'Lightning Bolt': 1 }, '2026-09-03'),
    deck({ Island: 1 }, '2026-09-01')
  ], { requiredCards: ['Lightning Bolt'], startDate: new Date('2026-09-01'), endDate: new Date('2026-09-02') });
  assert.equal(result.totalDecksConsidered, 2);
});

test('no matches and zero quantities produce no misleading recommendations', () => {
  const result = analyzeCards(input, [deck({ 'Lightning Bolt': 0 })], { requiredCards: ['Lightning Bolt'] });
  assert.equal(result.totalDecksConsidered, 0);
  for (const key of ['keep', 'cut', 'toAdd', 'allStats']) assert.deepEqual(result[key], []);
  assert.deepEqual(result.requiredCards, ['Lightning Bolt']);
});

test('commander popular cards include cards beyond the top 50 even when seen in only one deck', () => {
  const commonCards = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`Common card ${index}`, 1]));
  const tournamentDecks = [deck(commonCards), deck({ ...commonCards, 'Singleton card': 1 })];
  const commanderInput = { ...input, source: 'commander', cards: {} };

  for (const options of [{}, { addTop: 1 }]) {
    const result = analyzeCards(commanderInput, tournamentDecks, options);
    assert.equal(result.toAdd.length, 61);
    assert.deepEqual(result.toAdd.at(-1), {
      card: 'Singleton card', decksWithCard: 1, totalDecks: 2, ratio: 0.5, banned: false
    });
  }

  assert.equal(analyzeCards(input, tournamentDecks).toAdd.length, 50);
  assert.equal(analyzeCards(input, tournamentDecks, { addTop: 1 }).toAdd.length, 1);
});
