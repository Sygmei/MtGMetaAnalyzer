import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { commanderCard, compatibleCommanders } from '../src/lib/commanders.ts';
import postgres from 'postgres';
import { chromium } from 'playwright';

const baseURL = process.env.TEST_BASE_URL;
const databaseURL = process.env.TEST_DATABASE_URL;

test('admin and player tournament browser flow', { skip: !baseURL || !databaseURL, timeout: 90000 }, async () => {
  const db = postgres(databaseURL, { max: 1 });
  const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL });
  const prefix = randomUUID().slice(0, 8);
  const users = ['Alex', 'Camille', 'Jules', 'Lou', 'Morgan', 'Robin', 'Visitor'].map((name, index) => ({ id: randomUUID(), name,
    username: `browser-${prefix}-${index}`, role: index === 0 ? 'admin' : 'user', token: randomUUID() }));
  const [admin, player] = users;
  const errors = [];
  let leagueId;
  const screenshots = process.env.TEST_SCREENSHOTS_DIR;
  try {
    for (const user of users) {
      await db`INSERT INTO users (id, username, display_name, role) VALUES (${user.id}, ${user.username}, ${user.name}, ${user.role})`;
      await db`INSERT INTO user_sessions (id, user_id, session_token) VALUES (${randomUUID()}, ${user.id}, ${user.token})`;
    }
    const adminContext = await browser.newContext({ baseURL, locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    await adminContext.addCookies([{ name: 'mtg_meta_session', value: admin.token, url: baseURL }]);
    const cards = JSON.parse(await readFile(new URL('./fixtures/commanders.json', import.meta.url), 'utf8')).map(commanderCard);
    let scryfallUnavailable = false;
    await adminContext.route('**/tournament/commanders?*', async (route) => {
      if (scryfallUnavailable) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      const params = new URL(route.request().url()).searchParams;
      if (params.has('name')) return route.fulfill({ json: { card: cards.find((card) => card.name === params.get('name')) ?? null } });
      const primary = cards.find((card) => card.id === params.get('with'));
      return route.fulfill({ json: { cards: cards.filter((card) => card.name.toLowerCase().includes((params.get('q') ?? '').toLowerCase())
        && (!primary || compatibleCommanders(primary, card))).slice(0, 12) } });
    });
    const page = await adminContext.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/tournament');
    await page.getByRole('heading', { name: 'Tournament', exact: true }).waitFor();
    const create = page.locator('form[action="?/create"]');
    if (!await create.isVisible()) await page.getByText('Create a league', { exact: true }).click();
    await create.locator('[name="name"]').fill(`Duel Commander League ${prefix}`);
    await create.locator('[name="description"]').fill('Our local league. Play, improve, and follow your progress across the season.');
    await create.locator('[name="startsOn"]').fill('2026-09-01');
    await create.locator('[name="endsOn"]').fill('2027-06-30');
    await create.getByRole('button', { name: 'Create league', exact: true }).click();
    await page.waitForURL(/\/tournament\/[^/]+$/);
    leagueId = new URL(page.url()).pathname.split('/')[2];
    for (const user of users.slice(0, 6)) {
      await page.locator('select[name="userId"]').selectOption(user.id);
      await page.getByRole('button', { name: 'Add player', exact: true }).click();
      await page.getByRole('button', { name: `Remove ${user.name}`, exact: true }).waitFor();
    }
    const roster = await db`SELECT id, user_id FROM tournament_members WHERE league_id = ${leagueId}`;
    const members = users.slice(0, 6).map((user) => ({ ...user, memberId: roster.find((row) => row.user_id === user.id).id }));
    const createEvent = page.locator('form[action="?/createEvent"]');
    await createEvent.locator('[name="name"]').fill('September opening event');
    await createEvent.locator('[name="eventDate"]').fill('2026-09-12');
    await createEvent.getByRole('button').click();
    await page.waitForURL(/\/events\/[^/]+$/);
    const eventURL = page.url();
    for (let i = 0; i < members.length; i++) await page.locator(`[name="rank:${members[i].memberId}"]`).fill(String(i + 1));
    const commanderNames = ['Ellie, Brick Master + Ellie, Vengeful Hunter', 'Nissa, Resurgent Animist', 'Slimefoot and Squee',
      'Juri, Master of the Revue', 'Terra, Herald of Hope', 'Asmoranomardicadaistinaculdacar'];
    const primaryInput = (member) => page.locator(`[id="commander-${member.memberId}"]`);
    const secondInput = (member) => page.locator(`[id="commander-second-${member.memberId}"]`);
    async function selectCard(input, name) {
      await input.fill(name);
      await page.getByRole('option').filter({ hasText: name }).first().waitFor();
      await input.press('ArrowDown');
      await input.press('Enter');
    }
    const first = members[0];
    await primaryInput(first).fill('Ellie, Brick');
    await page.getByRole('option').filter({ hasText: 'Ellie, Brick Master' }).waitFor();
    await primaryInput(first).press('ArrowDown');
    await primaryInput(first).press('Enter');
    await secondInput(first).waitFor();
    await secondInput(first).focus();
    await page.getByRole('option').filter({ hasText: 'Ellie, Vengeful Hunter' }).waitFor();
    assert.equal(await page.getByRole('option').count(), 1);
    await secondInput(first).press('ArrowDown');
    await secondInput(first).press('Enter');
    assert.equal(await page.locator(`[name="commanders:${first.memberId}"]`).inputValue(), commanderNames[0]);
    await selectCard(primaryInput(first), 'Nissa, Resurgent Animist');
    assert.equal(await secondInput(first).count(), 0);
    assert.equal(await page.locator(`[name="commanders:${first.memberId}"]`).inputValue(), 'Nissa, Resurgent Animist');
    await selectCard(primaryInput(first), "Abdel Adrian, Gorion's Ward");
    await selectCard(secondInput(first), 'Noble Heritage');
    await selectCard(primaryInput(first), 'Clara Oswald');
    assert.equal(await secondInput(first).inputValue(), '');
    await secondInput(first).focus();
    await page.getByRole('option').filter({ hasText: 'The First Doctor' }).waitFor();
    assert.equal(await page.getByRole('option').count(), 1);
    await secondInput(first).press('Escape');
    assert.equal(await page.getByRole('listbox').count(), 0);
    await primaryInput(first).fill('');
    assert.equal(await secondInput(first).count(), 0);
    // A failed lookup leaves a usable manual entry, without blocking result publication.
    scryfallUnavailable = true;
    await primaryInput(first).fill('Historical commander');
    await page.getByText('Scryfall is unavailable. You can still enter names manually.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Add second commander manually' }).click();
    await secondInput(first).fill('Historical partner');
    await secondInput(first).blur();
    scryfallUnavailable = false;
    for (let i = 0; i < members.length; i++) {
      const [primary, secondary] = commanderNames[i].split(' + ');
      await selectCard(primaryInput(members[i]), primary);
      if (secondary) await selectCard(secondInput(members[i]), secondary);
    }
    const preview = page.getByRole('table', { name: 'Points preview', exact: true });
    assert.deepEqual(await preview.locator('tbody tr td:last-child').allTextContents(), ['+7', '+4', '+3', '+2', '+1', '+1']);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Changes saved.' }).waitFor();

    const playerContext = await browser.newContext({ baseURL, locale: 'en-US', viewport: { width: 390, height: 844 } });
    await playerContext.addCookies([{ name: 'mtg_meta_session', value: player.token, url: baseURL }]);
    const playerPage = await playerContext.newPage();
    playerPage.on('pageerror', (error) => errors.push(error.message));
    await playerPage.goto(eventURL);
    await playerPage.getByText('Results have not been published yet.').waitFor();
    assert.equal(await playerPage.locator('input[name^="rank:"]').count(), 0);
    await page.getByRole('button', { name: 'Publish results', exact: true }).click();
    const results = page.getByRole('table', { name: 'Results', exact: true });
    await results.waitFor();
    assert.deepEqual(await results.locator('tbody tr td:last-child').allTextContents(), ['+7', '+4', '+3', '+2', '+1', '+1']);
    assert.deepEqual(await results.locator('tbody tr td:nth-child(2) span').allTextContents(), commanderNames);
    await page.locator(`[name="rank:${members[0].memberId}"]`).fill('2');
    assert.equal(await page.getByRole('button', { name: 'Publish corrections' }).isDisabled(), true);
    await page.locator(`[name="rank:${members[1].memberId}"]`).fill('1');
    await page.locator('[name="reason"]').fill('Corrected the final standings.');
    await page.getByRole('button', { name: 'Publish corrections', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('table[aria-label="Results"] tbody tr td:nth-child(2)')?.textContent?.startsWith('Camille'));
    assert.equal(await page.locator('[name="revision"]').inputValue(), '3');

    const unauthorized = await playerContext.request.post(`${eventURL}?/save`, { form: { name: 'Forbidden', eventDate: '2026-09-12', revision: '3', status: 'draft' }, headers: { origin: baseURL } });
    const denied = await unauthorized.json();
    assert.equal(denied.type, 'failure');
    assert.equal(denied.status, 401);
    assert.equal((await playerContext.request.get('/tournament/commanders?q=Ellie')).status(), 403);
    assert.equal((await adminContext.request.get('/tournament/commanders?with=invalid')).status(), 400);
    await playerPage.goto(`/tournament/${leagueId}`);
    await playerPage.getByRole('heading', { name: 'My progress' }).waitFor();
    await playerPage.getByText('Nissa, Resurgent Animist', { exact: true }).waitFor();
    const standings = playerPage.getByRole('table', { name: 'Standings', exact: true });
    assert.deepEqual(await standings.locator('tbody tr td:nth-child(3)').allTextContents(), ['7', '4', '3', '2', '1', '1']);
    assert.equal(await playerPage.getByRole('heading', { name: 'Manage players' }).count(), 0);
    assert.equal(await playerPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (screenshots) { await mkdir(screenshots, { recursive: true }); await playerPage.screenshot({ path: `${screenshots}/league-player-mobile.png`, fullPage: true }); }
    await playerPage.setViewportSize({ width: 320, height: 740 });
    assert.equal(await playerPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await playerPage.locator('.t-table-wrap').evaluateAll((wrappers) => wrappers.some((el) => el.scrollWidth > el.clientWidth)), false);
    assert.equal(await playerPage.locator('header nav a span').evaluateAll((labels) => labels.some((el) => el.scrollWidth > el.clientWidth)), false);
    if (screenshots) await playerPage.screenshot({ path: `${screenshots}/league-player-320.png`, fullPage: true });
    await page.goto(`/tournament/${leagueId}`);
    if (screenshots) await page.screenshot({ path: `${screenshots}/league-admin-desktop.png`, fullPage: true });
    await page.goto(eventURL);
    await secondInput(first).waitFor();
    assert.equal(await secondInput(first).inputValue(), 'Ellie, Vengeful Hunter');
    if (screenshots) await page.screenshot({ path: `${screenshots}/event-admin-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    await primaryInput(first).fill('Ellie');
    await page.getByRole('option').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const menuBounds = await page.getByRole('listbox').boundingBox();
    assert.ok(menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 740);
    if (screenshots) await page.screenshot({ path: `${screenshots}/commander-autocomplete-320.png` });
    await page.getByRole('option').filter({ hasText: 'Ellie, Brick Master' }).click();
    assert.equal(await primaryInput(first).inputValue(), 'Ellie, Brick Master');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await playerPage.goto(eventURL);
    const playerResults = playerPage.getByRole('table', { name: 'Results', exact: true });
    await playerResults.getByText('Asmoranomardicadaistinaculdacar', { exact: true }).waitFor();
    assert.equal(await playerPage.locator('.t-table-wrap').evaluateAll((wrappers) => wrappers.some((el) => el.scrollWidth > el.clientWidth)), false);
    if (screenshots) await playerPage.screenshot({ path: `${screenshots}/event-player-320.png`, fullPage: true });

    const visitorContext = await browser.newContext({ baseURL, locale: 'fr-FR', viewport: { width: 390, height: 844 } });
    await visitorContext.addCookies([{ name: 'mtg_meta_session', value: users[6].token, url: baseURL }]);
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(`/tournament/${leagueId}`);
    await visitorPage.getByRole('heading', { name: 'Classement', exact: true }).waitFor();
    assert.equal(await visitorPage.getByRole('heading', { name: 'Ma progression', exact: true }).count(), 0);
    assert.equal(await visitorPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (screenshots) await visitorPage.screenshot({ path: `${screenshots}/league-visitor-fr.png`, fullPage: true });
    const anonymous = await browser.newContext({ baseURL });
    assert.equal((await anonymous.request.get('/tournament/commanders?q=Ellie')).status(), 401);
    for (const path of ['/tournament', `/tournament/${leagueId}`, new URL(eventURL).pathname]) {
      const response = await anonymous.request.get(path, { maxRedirects: 0 });
      assert.equal(response.status(), 303);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    if (leagueId) {
      await db`DELETE FROM tournament_event_history WHERE event_id IN (SELECT id FROM tournament_events WHERE league_id = ${leagueId})`;
      await db`DELETE FROM tournament_results WHERE league_id = ${leagueId}`;
      await db`DELETE FROM tournament_events WHERE league_id = ${leagueId}`;
      await db`DELETE FROM tournament_members WHERE league_id = ${leagueId}`;
      await db`DELETE FROM tournament_leagues WHERE id = ${leagueId}`;
    }
    for (const user of users) await db`DELETE FROM users WHERE id = ${user.id}`;
    await db.end();
  }
});
