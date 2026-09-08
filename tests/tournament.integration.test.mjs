import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createServer } from 'vite';

const testUrl = process.env.TEST_DATABASE_URL;
const form = (data) => { const value = new FormData(); for (const [key, field] of Object.entries(data)) value.set(key, String(field)); return value; };
const rejects = (fn, status) => assert.rejects(fn, (error) => error.httpStatusCode === status);

test('tournament database lifecycle and permissions', { skip: !testUrl }, async (t) => {
  process.env.DATABASE_URL_RW = testUrl;
  process.env.DATABASE_URL_RO = testUrl;
  const db = postgres(testUrl, { max: 1 });
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const service = await vite.ssrLoadModule('/src/lib/server/tournaments.ts');
  const dbModule = await vite.ssrLoadModule('/src/lib/server/db.ts');
  const accounts = Array.from({ length: 8 }, (_, index) => ({ id: randomUUID(), username: `tournament-test-${randomUUID().slice(0, 8)}`,
    displayName: `Player ${index}`, role: index === 0 ? 'admin' : 'user', isSuperadmin: false, createdAt: new Date(), createdByUserId: null }));
  const [admin, player] = accounts;
  const ids = [];
  let leagueId, otherId, eventId, roster;
  const settings = { name: 'Test League', description: 'Independent dates', startsOn: '2026-09-01', endsOn: '2027-06-30' };
  const eventForm = (revision, status = 'published', overrides = {}) => form({ name: 'Opening event', eventDate: '2026-09-12', revision, status,
    ...Object.fromEntries(roster.slice(0, 6).map((member, i) => [`rank:${member.id}`, i + 1])), ...overrides });
  try {
    for (const user of accounts) await db`INSERT INTO users (id, username, display_name, role) VALUES (${user.id}, ${user.username}, ${user.displayName}, ${user.role})`;
    await t.test('only admins can mutate leagues', async () => {
      await rejects(() => service.createLeague(null, form(settings)), 401);
      await rejects(() => service.createLeague(player, form(settings)), 401);
      await rejects(() => service.createLeague(admin, form({ ...settings, endsOn: '2026-02-30' })), 400);
      leagueId = await service.createLeague(admin, form(settings)); ids.push(leagueId);
      otherId = await service.createLeague(admin, form({ ...settings, name: 'Other League' })); ids.push(otherId);
      await rejects(() => service.addMember(player, leagueId, form({ userId: player.id })), 401);
      for (const user of accounts.slice(0, 6)) await service.addMember(admin, leagueId, form({ userId: user.id }));
      await service.addMember(admin, leagueId, form({ userId: player.id }));
      roster = (await service.getLeague(leagueId, admin)).roster;
      assert.equal(roster.length, 6);
    });
    await t.test('draft scores are hidden and excluded; invalid ranks and cross-league players rejected', async () => {
      await rejects(() => service.createEvent(admin, leagueId, form({ name: 'Bad date', eventDate: '2028-01-01' })), 400);
      eventId = await service.createEvent(admin, leagueId, form({ name: 'Opening event', eventDate: '2026-09-12' }));
      await rejects(() => service.saveEvent(player, leagueId, eventId, eventForm(0)), 401);
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(0, 'published', { [`rank:${roster[1].id}`]: 1 })), 400);
      await service.addMember(admin, otherId, form({ userId: accounts[7].id }));
      const stranger = (await service.getLeague(otherId, admin)).roster[0];
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(0, 'published', { [`rank:${stranger.id}`]: 7 })), 400);
      await service.saveEvent(admin, leagueId, eventId, eventForm(0, 'draft'));
      assert.equal((await service.getEvent(leagueId, eventId, player)).results.length, 0);
      assert.equal((await service.getEvent(leagueId, eventId, player)).history.length, 0);
      assert.ok((await service.getLeague(leagueId, player)).standings.every((row) => row.points === 0));
    });
    await t.test('publication awards exactly once and stale submissions cannot overwrite', async () => {
      await service.saveEvent(admin, leagueId, eventId, eventForm(1));
      const view = await service.getLeague(leagueId, player);
      assert.deepEqual(view.standings.map((row) => row.points), [7, 4, 3, 2, 1, 1]);
      assert.deepEqual(view.standings.map((row) => row.rank), [1, 2, 3, 4, 5, 5]);
      assert.equal(view.myHistory.length, 1);
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(1)), 409);
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(2)), 400);
    });
    await t.test('corrections are atomic, auditable, and preserve earlier awards', async () => {
      await service.saveEvent(admin, leagueId, eventId, eventForm(2, 'published', { reason: 'Corrected the top two', [`rank:${roster[0].id}`]: 2, [`rank:${roster[1].id}`]: 1 }));
      const event = await service.getEvent(leagueId, eventId, admin);
      assert.equal(event.results[0].memberId, roster[1].id);
      assert.equal(event.history.length, 4);
      assert.equal(event.history[1].snapshot.results[0].memberId, roster[0].id);
      assert.equal(event.history[0].reason, 'Corrected the top two');
      const attempts = await Promise.allSettled([
        service.saveEvent(admin, leagueId, eventId, eventForm(3, 'published', { reason: 'Concurrent A' })),
        service.saveEvent(admin, leagueId, eventId, eventForm(3, 'published', { reason: 'Concurrent B' }))
      ]);
      assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(attempts.find((result) => result.status === 'rejected').reason.httpStatusCode, 409);
    });
    await t.test('unpublishing removes totals; republishing restores them without duplication', async () => {
      await service.saveEvent(admin, leagueId, eventId, eventForm(4, 'draft', { reason: 'Review results' }));
      assert.ok((await service.getLeague(leagueId, player)).standings.every((row) => row.points === 0));
      await service.saveEvent(admin, leagueId, eventId, eventForm(5));
      assert.deepEqual((await service.getLeague(leagueId, player)).standings.map((row) => row.points), [7, 4, 3, 2, 1, 1]);
    });
    await t.test('absent members do not affect the participant count', async () => {
      await service.addMember(admin, leagueId, form({ userId: accounts[6].id }));
      await service.saveEvent(admin, leagueId, eventId, eventForm(6, 'published', { reason: 'Confirmed attendance' }));
      const view = await service.getLeague(leagueId, player);
      assert.equal(view.standings.find((row) => row.userId === accounts[6].id).points, 0);
      assert.equal(view.standings[0].points, 7);
    });
    await t.test('commanders belong to an event, survive omitted fields, and are audited on correction', async () => {
      await service.addMember(admin, otherId, form({ userId: accounts[1].id }));
      await service.addMember(admin, otherId, form({ userId: accounts[2].id }));
      const otherRoster = (await service.getLeague(otherId, admin)).roster.filter((row) => [accounts[1].id, accounts[2].id].includes(row.userId));
      const id = await service.createEvent(admin, otherId, form({ name: 'Commander test', eventDate: '2026-10-01' }));
      const fields = { name: 'Commander test', eventDate: '2026-10-01', status: 'draft', revision: 0,
        [`rank:${otherRoster[0].id}`]: 1, [`rank:${otherRoster[1].id}`]: 2 };
      const pair = "Yoshimaru, Ever Faithful + Kraum, Ludevic's Opus";
      await rejects(() => service.saveEvent(admin, otherId, id, form({ ...fields, [`commanders:${otherRoster[0].id}`]: 'x'.repeat(301) })), 400);
      await service.saveEvent(admin, otherId, id, form({ ...fields, [`commanders:${otherRoster[0].id}`]: `  ${pair}  `,
        [`commanders:${otherRoster[1].id}`]: 'Nissa, Resurgent Animist' }));
      assert.equal((await service.getEvent(otherId, id, player)).results.length, 0);
      await service.saveEvent(admin, otherId, id, form({ ...fields, revision: 1, status: 'published' }));
      let view = await service.getEvent(otherId, id, player);
      assert.equal(view.results[0].commanders, pair);
      assert.equal(view.results[1].commanders, 'Nissa, Resurgent Animist');
      await service.saveEvent(admin, otherId, id, form({ ...fields, revision: 2, status: 'published', reason: 'Corrected commander names',
        [`commanders:${otherRoster[0].id}`]: 'Asmoranomardicadaistinaculdacar', [`commanders:${otherRoster[1].id}`]: '' }));
      view = await service.getEvent(otherId, id, admin);
      assert.equal(view.results[0].commanders, 'Asmoranomardicadaistinaculdacar');
      assert.equal(view.results[1].commanders, '');
      assert.deepEqual(view.results.map((row) => row.points), [3, 1]);
      assert.equal(view.history[1].snapshot.results[0].commanders, pair);
      assert.equal(view.history[0].snapshot.results[0].commanders, 'Asmoranomardicadaistinaculdacar');
      const participant = accounts.find((account) => account.id === otherRoster[0].userId);
      assert.equal((await service.getLeague(otherId, participant)).myHistory[0].commanders, 'Asmoranomardicadaistinaculdacar');
      assert.ok((await service.getEvent(leagueId, eventId, player)).results.every((row) => row.commanders === ''));
    });
    await t.test('membership changes preserve results; new events reject removed members', async () => {
      await service.removeMember(admin, leagueId, form({ memberId: roster[0].id }));
      assert.equal((await service.getLeague(leagueId, player)).standings.find((row) => row.memberId === roster[0].id).points, 7);
      const newEvent = await service.createEvent(admin, leagueId, form({ name: 'Second event', eventDate: '2026-09-19' }));
      await rejects(() => service.saveEvent(admin, leagueId, newEvent, eventForm(0)), 400);
      await db`DELETE FROM users WHERE id = ${roster[0].userId}`;
      const preserved = (await service.getLeague(leagueId, player)).standings.find((row) => row.memberId === roster[0].id);
      assert.equal(preserved.userId, null);
      assert.equal(preserved.points, 7);
    });
    await t.test('archiving prevents writes, and date edits must include events', async () => {
      await rejects(() => service.updateLeague(admin, leagueId, form({ ...settings, endsOn: '2026-09-11' })), 400);
      await service.updateLeague(admin, leagueId, form({ ...settings, archived: 'on' }));
      await rejects(() => service.createEvent(admin, leagueId, form({ name: 'Archived', eventDate: '2026-09-20' })), 400);
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(7, 'published', { reason: 'Archived' })), 400);
      await service.updateLeague(admin, leagueId, form(settings));
      assert.equal((await service.getLeague(leagueId, player)).league.archived, false);
    });
  } finally {
    for (const id of ids) {
      await db`DELETE FROM tournament_event_history WHERE event_id IN (SELECT id FROM tournament_events WHERE league_id = ${id})`;
      await db`DELETE FROM tournament_results WHERE league_id = ${id}`;
      await db`DELETE FROM tournament_events WHERE league_id = ${id}`;
      await db`DELETE FROM tournament_members WHERE league_id = ${id}`;
      await db`DELETE FROM tournament_leagues WHERE id = ${id}`;
    }
    for (const user of accounts) await db`DELETE FROM users WHERE id = ${user.id}`;
    await dbModule.getSqlClient().end();
    await vite.close();
    await db.end();
  }
});
