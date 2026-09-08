import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/commanders.json', import.meta.url)));
const cachedDecks = [
  { eventDate: '2026-09-01', cards: { 'Lightning Bolt': 1, Mountain: 12 }, sections: { main: { 'Lightning Bolt': 1, Mountain: 12 } } },
  { eventDate: '2026-09-01', cards: { Island: 12 }, sections: { main: { Island: 12 } } }
];
const mocks = {
  'mtgtop8-cache-repo': `export const getLatestCachedEventDate = async () => null;
    export const insertDecksForCommander = async () => 0;
    export const loadDecksForCommanderFromWrite = async () => ${JSON.stringify(cachedDecks)};
    export const upsertCommanderCache = async () => {};`,
  'mtgtop8': `export class MtgTop8Client {
    async findCommanderEntry(names) { return { name: names.join(' / '), score: 1, url: 'https://mtgtop8.com/test' }; }
    async crawlCommanderDecks() { return []; }
  }`,
  'duel-commander-banlist': 'export const getDuelCommanderDeckBannedCardsNormalized = async () => new Set();',
  'deck-source': `export const normalizeSupportedDeckUrl = (url) => ({ normalizedUrl: url });
    export let fetchCount = 0;
    export async function fetchInputDeckFromUrl(url) {
      fetchCount++;
      return { source: 'moxfield', deckId: 'fixture', name: 'Fixture deck', url,
        commanders: ['Yoshimaru, Ever Faithful'], cards: { 'Lightning Bolt': 1 } };
    }`,
  'analysis-runs-repo': 'export let saved; export async function saveAnalysisRun(value) { saved = value; return "fixture-share"; }'
};
let vite, resolveCommanderAnalysisDeck, analyzeDeck, actions, savedRepo, source, publicSearch, tournamentSearch;
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.scryfall.com');
    const name = url.searchParams.get('exact');
    if (name === 'Lookup outage') throw new Error('Fixture outage');
    const card = fixtures.find((card) => card.name.toLowerCase() === name?.toLowerCase());
    return new Response(JSON.stringify(card ?? (name ? null : { data: fixtures })), { status: name && !card ? 404 : 200 });
  };
  vite = await createServer({ configFile: false, resolve: { alias: { '$lib': new URL('../src/lib', import.meta.url).pathname } },
    server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', plugins: [{
    name: 'analysis-fixtures', enforce: 'pre',
    resolveId(id) {
      const key = id.split('/').at(-1).replace(/\.ts$/, '');
      if (mocks[key]) return `\0fixture:${key}`;
    },
    load(id) { if (id.startsWith('\0fixture:')) return mocks[id.slice(9)]; }
  }] });
  ({ resolveCommanderAnalysisDeck } = await vite.ssrLoadModule('/src/lib/server/commander-analysis.ts'));
  ({ analyzeDeck } = await vite.ssrLoadModule('/src/lib/server/pipeline.ts'));
  ({ actions } = await vite.ssrLoadModule('/src/routes/analyzer/+page.server.ts'));
  savedRepo = await vite.ssrLoadModule('/src/lib/server/analysis-runs-repo.ts');
  source = await vite.ssrLoadModule('/src/lib/adapters/deck-source.ts');
  publicSearch = await vite.ssrLoadModule('/src/routes/analyzer/commanders/+server.ts');
  tournamentSearch = await vite.ssrLoadModule('/src/routes/tournament/commanders/+server.ts');
});
after(async () => { globalThis.fetch = originalFetch; await vite?.close(); });

test('commander input resolves canonical names and supports compatible partners', async () => {
  const single = await resolveCommanderAnalysisDeck('yoshimaru, ever faithful');
  assert.equal(single.source, 'commander');
  assert.deepEqual(single.commanders, ['Yoshimaru, Ever Faithful']);
  assert.deepEqual(single.cards, {});
  const pair = await resolveCommanderAnalysisDeck("Yoshimaru, Ever Faithful + Kraum, Ludevic's Opus");
  assert.equal(pair.commanders.length, 2);
});

test('invalid, incompatible and unavailable commanders fail clearly', async () => {
  for (const name of ['', 'Unknown commander', 'Yoshimaru, Ever Faithful + Ellie, Brick Master']) {
    await assert.rejects(resolveCommanderAnalysisDeck(name), (error) => error.httpStatusCode === 400);
  }
  await assert.rejects(resolveCommanderAnalysisDeck('Lookup outage'), (error) => error.httpStatusCode === 503);
});

test('commander-only pipeline bypasses deck fetching and respects card and date filters', async () => {
  const events = [];
  const output = await analyzeDeck({ commanderNames: 'Yoshimaru, Ever Faithful', requiredCards: ['Lightning Bolt'],
    startDate: new Date('2026-09-01'), endDate: new Date('2026-09-01'), onProgress: (event) => events.push(event) });
  assert.equal(source.fetchCount, 0);
  assert.equal(output.analysis.totalDecksConsidered, 1);
  assert.deepEqual(output.analysis.keep, []);
  assert.deepEqual(output.analysis.cut, []);
  assert.deepEqual(output.analysis.toAdd.map((card) => [card.card, card.ratio]), [['Lightning Bolt', 1], ['Mountain', 1]]);
  assert.equal(events.some((event) => event.stage === 'moxfield'), false);
});

const submit = (values) => actions.default({
  request: new Request('http://localhost/analyzer', { method: 'POST', body: new URLSearchParams(values) }),
  locals: { user: null }, getClientAddress: () => '127.0.0.1'
});

test('commander form submission persists mode, filters and share output without a deck URL', async () => {
  const result = await submit({ inputMode: 'commander', commanderNames: 'Yoshimaru, Ever Faithful', requiredCards: 'Lightning Bolt' });
  assert.equal(result.output.share.id, 'fixture-share');
  assert.equal(result.output.moxfieldDeck.source, 'commander');
  assert.equal(savedRepo.saved.moxfieldUrl, '');
  assert.equal(savedRepo.saved.input.inputMode, 'commander');
  assert.equal(savedRepo.saved.input.commanderNames, 'Yoshimaru, Ever Faithful');
  assert.deepEqual(savedRepo.saved.output.analysis.requiredCards, ['Lightning Bolt']);
  assert.equal((await submit({ inputMode: 'commander' })).status, 400);
});

test('existing deck URL submissions still fetch a deck and produce keep/cut results', async () => {
  const result = await submit({ moxfieldUrl: 'https://www.moxfield.com/decks/fixture' });
  assert.equal(result.output.moxfieldDeck.source, 'moxfield');
  assert.equal(source.fetchCount, 1);
  assert.equal(result.output.analysis.keep[0].card, 'Lightning Bolt');
});

test('analyzer autocomplete works anonymously while tournament search stays protected', async () => {
  const url = new URL('http://localhost/analyzer/commanders?q=Yoshi');
  const response = await publicSearch.GET({ url, locals: { user: null } });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).cards.length);
  await assert.rejects(tournamentSearch.GET({ url, locals: { user: null } }), (error) => error.status === 401);
  await assert.rejects(publicSearch.GET({ url: new URL('http://localhost/analyzer/commanders?with=invalid') }), (error) => error.status === 400);
});
