import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite, GET;
const calls = [];
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    calls.push(url);
    const query = url.searchParams.get('q');
    if (query.includes('Unavailable')) return new Response('', { status: 503 });
    if (query.includes('No matches')) return new Response('', { status: 404 });
    return Response.json({ data: [
      { name: 'Lightning Bolt', type_line: 'Instant' },
      { name: 'Mountain', type_line: 'Basic Land — Mountain' },
      { name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', type_line: 'Enchantment — Saga // Enchantment Creature — Goblin Shaman' },
      { name: 'Thalia, Guardian of Thraben', type_line: 'Legendary Creature — Human Soldier' }
    ] });
  };
  vite = await createServer({ configFile: false,
    resolve: { alias: { '$lib': new URL('../src/lib', import.meta.url).pathname } },
    server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  ({ GET } = await vite.ssrLoadModule('/src/routes/analyzer/cards/+server.ts'));
});
after(async () => { globalThis.fetch = originalFetch; await vite?.close(); });
const search = (q) => GET({ url: new URL(`http://localhost/analyzer/cards?${new URLSearchParams({ q })}`) });

test('all card types are returned with complete names and anonymous access', async () => {
  const response = await search('Lightning');
  const { cards } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(cards[0].typeLine, 'Instant');
  assert.equal(cards[1].name, 'Mountain');
  assert.match(cards[2].name, / \/\/ /);
  assert.equal(cards[3].name, 'Thalia, Guardian of Thraben');
  assert.equal(calls[0].searchParams.get('q'), 'name:"Lightning"');
  assert.equal(calls[0].searchParams.get('unique'), 'cards');
});

test('short or oversized input does not call Scryfall', async () => {
  const count = calls.length;
  assert.deepEqual(await (await search(' ')).json(), { cards: [] });
  assert.deepEqual(await (await search('a')).json(), { cards: [] });
  await assert.rejects(search('a'.repeat(151)), (error) => error.status === 400);
  assert.equal(calls.length, count);
});

test('queries are escaped, cached and concurrent requests share one lookup', async () => {
  const count = calls.length;
  const query = 'Bolt" or is:commander';
  await Promise.all([search(query), search(query)]);
  await search(query);
  assert.equal(calls.length, count + 1);
  assert.equal(calls.at(-1).searchParams.get('q'), 'name:"Bolt\\" or is:commander"');
});

test('no results and upstream failures return different states', async () => {
  assert.deepEqual(await (await search('No matches')).json(), { cards: [] });
  await assert.rejects(search('Unavailable'), (error) => error.status === 503);
});
