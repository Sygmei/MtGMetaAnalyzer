import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { redirect, fail } from '@sveltejs/kit';
import { rankStandings, scorePlacements, SCORING_VERSION, type Placement } from '../tournament';
import { AppError, isAppError } from './app-error';
import { ensureAdmin, type AppUser } from './auth';
import { getWriteDb } from './db';
import { tournamentLeagues as leagues, tournamentMembers as members, tournamentEvents as events,
  tournamentResults as results, tournamentEventHistory as history, users, type TournamentSnapshot } from './db-schema';

function invalid(message: string, status = 400): never {
  throw new AppError({ userFacingError: message, adminFacingError: message, errorTypeName: 'TournamentError', httpStatusCode: status });
}

export function requireTournamentUser(user: AppUser | null | undefined): AppUser {
  if (!user) throw redirect(303, '/');
  return user;
}

export function tournamentFailure(error: unknown) {
  if (isAppError(error)) return fail(error.httpStatusCode, { error: error.userFacingError });
  console.error('[tournament] action failed', error);
  return fail(500, { error: 'Could not save changes. Please retry.' });
}

function textField(value: FormDataEntryValue | null, label: string, max: number, optional = false): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if ((!optional && !text) || text.length > max) invalid(`${label} must be ${optional ? '0' : '1'}–${max} characters.`);
  return text;
}

function dateField(value: FormDataEntryValue | null): string {
  const raw = String(value || '');
  const date = new Date(`${raw}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    invalid('Enter a valid date.');
  }
  return raw;
}

function leagueInput(form: FormData) {
  const input = { name: textField(form.get('name'), 'League name', 120), description: textField(form.get('description'), 'Description', 3000, true),
    startsOn: dateField(form.get('startsOn')), endsOn: dateField(form.get('endsOn')) };
  if (input.endsOn < input.startsOn) invalid('The end date must be on or after the start date.');
  return input;
}

export async function createLeague(user: AppUser | null, form: FormData) {
  ensureAdmin(user);
  const id = randomUUID();
  await getWriteDb().insert(leagues).values({ id, ...leagueInput(form) });
  return id;
}

type Transaction = Parameters<Parameters<ReturnType<typeof getWriteDb>['transaction']>[0]>[0];
async function lockLeague(tx: Transaction, id: string, allowArchived = false) {
  const [league] = await tx.select().from(leagues).where(eq(leagues.id, id)).for('update');
  if (!league) invalid('League not found.', 404);
  if (league.archived && !allowArchived) invalid('Reopen this league before making changes.');
  return league;
}

export async function updateLeague(user: AppUser | null, id: string, form: FormData) {
  ensureAdmin(user);
  const input = leagueInput(form);
  await getWriteDb().transaction(async (tx) => {
    await lockLeague(tx, id, true);
    const existingEvents = await tx.select({ date: events.eventDate }).from(events).where(eq(events.leagueId, id));
    if (existingEvents.some((event) => event.date < input.startsOn || event.date > input.endsOn)) {
      invalid('League dates must include all existing events.');
    }
    await tx.update(leagues).set({ ...input, archived: form.get('archived') === 'on' }).where(eq(leagues.id, id));
  });
}

export async function addMember(user: AppUser | null, leagueId: string, form: FormData) {
  ensureAdmin(user);
  const userId = textField(form.get('userId'), 'Player', 100);
  await getWriteDb().transaction(async (tx) => {
    await lockLeague(tx, leagueId);
    const [player] = await tx.select().from(users).where(eq(users.id, userId));
    if (!player) invalid('Player not found.', 404);
    await tx.insert(members).values({ id: randomUUID(), leagueId, userId, name: player.displayName || player.username })
      .onConflictDoUpdate({ target: [members.leagueId, members.userId], set: { active: true } });
  });
}

export async function removeMember(user: AppUser | null, leagueId: string, form: FormData) {
  ensureAdmin(user);
  await getWriteDb().transaction(async (tx) => {
    await lockLeague(tx, leagueId);
    await tx.update(members).set({ active: false }).where(and(eq(members.leagueId, leagueId), eq(members.id, String(form.get('memberId') || ''))));
  });
}

export async function createEvent(user: AppUser | null, leagueId: string, form: FormData) {
  const admin = ensureAdmin(user);
  const name = textField(form.get('name'), 'Event name', 120);
  const eventDate = dateField(form.get('eventDate'));
  const id = randomUUID();
  await getWriteDb().transaction(async (tx) => {
    const league = await lockLeague(tx, leagueId);
    if (eventDate < league.startsOn || eventDate > league.endsOn) invalid('The event date must fall within the league dates.');
    await tx.insert(events).values({ id, leagueId, name, eventDate });
    await tx.insert(history).values({ id: randomUUID(), eventId: id, revision: 0, actorId: admin.id, actorName: admin.displayName || admin.username,
      snapshot: { name, eventDate, status: 'draft', scoringVersion: SCORING_VERSION, results: [] } });
  });
  return id;
}

export async function saveEvent(user: AppUser | null, leagueId: string, eventId: string, form: FormData) {
  const admin = ensureAdmin(user);
  const name = textField(form.get('name'), 'Event name', 120);
  const eventDate = dateField(form.get('eventDate'));
  const reason = textField(form.get('reason'), 'Correction reason', 1000, true);
  const status = String(form.get('status'));
  const revision = Number(form.get('revision'));
  if (!['draft', 'published'].includes(status) || !form.has('revision') || !Number.isInteger(revision) || revision < 0) invalid('Invalid event state.');
  const placements: Placement[] = [];
  for (const [key, value] of form.entries()) {
    if (key.startsWith('rank:') && String(value).trim()) placements.push({ memberId: key.slice(5), rank: Number(value) });
  }
  let scored: ReturnType<typeof scorePlacements>;
  try { scored = scorePlacements(placements); } catch (error) { invalid((error as Error).message); }
  if (status === 'published' && scored.length < 2) invalid('An event needs at least two participants to publish results.');
  await getWriteDb().transaction(async (tx) => {
    const league = await lockLeague(tx, leagueId);
    const [event] = await tx.select().from(events).where(and(eq(events.id, eventId), eq(events.leagueId, leagueId))).for('update');
    if (!event) invalid('Event not found.', 404);
    if (event.revision !== revision) invalid('Another admin changed this event. Reload the page before saving.', 409);
    if (event.scoringVersion !== SCORING_VERSION) invalid('This event uses an unsupported scoring version.');
    if (event.status === 'published' && !reason) invalid('Explain the correction or why results are being unpublished.');
    if (eventDate < league.startsOn || eventDate > league.endsOn) invalid('The event date must fall within the league dates.');
    const roster = await tx.select({ id: members.id, userId: members.userId, active: members.active,
      name: sql<string>`coalesce(${users.displayName}, ${users.username}, ${members.name})` })
      .from(members).leftJoin(users, eq(members.userId, users.id)).where(eq(members.leagueId, leagueId));
    const oldResults = await tx.select({ memberId: results.memberId, commanders: results.commanders }).from(results).where(eq(results.eventId, eventId));
    const oldIds = new Set(oldResults.map((row) => row.memberId));
    const eligible = new Map(roster.filter((member) => (member.active && member.userId) || oldIds.has(member.id)).map((member) => [member.id, member]));
    if (scored.some((row) => !eligible.has(row.memberId))) invalid('Results can only include eligible players from this league.');
    const previousCommanders = new Map(oldResults.map((row) => [row.memberId, row.commanders]));
    const awards = scored.map((row) => ({
      ...row,
      commanders: form.has(`commanders:${row.memberId}`)
        ? textField(form.get(`commanders:${row.memberId}`), 'Commander names', 300, true)
        : previousCommanders.get(row.memberId) ?? ''
    }));
    const snapshot: TournamentSnapshot = { name, eventDate, status: status as 'draft' | 'published', scoringVersion: event.scoringVersion,
      results: awards.map((row) => ({ ...row, name: eligible.get(row.memberId)!.name })) };
    await tx.delete(results).where(eq(results.eventId, eventId));
    if (awards.length) await tx.insert(results).values(awards.map((row) => ({ ...row, id: randomUUID(), leagueId, eventId })));
    await tx.update(events).set({ name, eventDate, status: snapshot.status, revision: revision + 1, updatedAt: new Date() }).where(eq(events.id, eventId));
    await tx.insert(history).values({ id: randomUUID(), eventId, revision: revision + 1, actorId: admin.id,
      actorName: admin.displayName || admin.username, reason, snapshot });
  });
}

async function leagueRoster(leagueId?: string) {
  return getWriteDb().select({ id: members.id, leagueId: members.leagueId, userId: members.userId, active: members.active,
    name: sql<string>`coalesce(${users.displayName}, ${users.username}, ${members.name})` })
    .from(members).leftJoin(users, eq(members.userId, users.id)).where(leagueId ? eq(members.leagueId, leagueId) : undefined).orderBy(asc(members.name));
}

async function publishedTotals(leagueId?: string) {
  return getWriteDb().select({ memberId: results.memberId, points: sql<number>`coalesce(sum(${results.points}), 0)::int`, attendance: sql<number>`count(*)::int` })
    .from(results).innerJoin(events, eq(results.eventId, events.id))
    .where(and(eq(events.status, 'published'), leagueId ? eq(events.leagueId, leagueId) : undefined)).groupBy(results.memberId);
}

function standingsFor(roster: Awaited<ReturnType<typeof leagueRoster>>, totals: Awaited<ReturnType<typeof publishedTotals>>) {
  const totalsById = new Map(totals.map((row) => [row.memberId, row]));
  return rankStandings(roster.map((member) => ({ ...member, memberId: member.id, points: totalsById.get(member.id)?.points ?? 0,
    attendance: totalsById.get(member.id)?.attendance ?? 0 })).filter((row) => row.active || row.attendance > 0));
}

export async function listLeagues(user: AppUser) {
  const db = getWriteDb();
  const [all, roster, totals] = await Promise.all([db.select().from(leagues).orderBy(asc(leagues.archived), desc(leagues.startsOn)), leagueRoster(), publishedTotals()]);
  return all.map((league) => {
    const leagueMembers = roster.filter((member) => member.leagueId === league.id);
    const standings = standingsFor(leagueMembers, totals);
    return { ...league, memberCount: leagueMembers.filter((member) => member.active && member.userId).length,
      mine: standings.find((row) => row.userId === user.id) ?? null };
  }).sort((a, b) => Number(a.archived) - Number(b.archived) || Number(Boolean(b.mine)) - Number(Boolean(a.mine)) || b.startsOn.localeCompare(a.startsOn));
}

export async function getLeague(leagueId: string, user: AppUser) {
  const db = getWriteDb();
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (!league) invalid('League not found.', 404);
  const [roster, totals, leagueEvents] = await Promise.all([leagueRoster(leagueId), publishedTotals(leagueId),
    db.select().from(events).where(eq(events.leagueId, leagueId)).orderBy(desc(events.eventDate), asc(events.id))]);
  const standings = standingsFor(roster, totals);
  const mine = standings.find((row) => row.userId === user.id) ?? null;
  const myHistory = mine ? await db.select({ eventId: events.id, eventName: events.name, eventDate: events.eventDate, rank: results.rank, points: results.points, commanders: results.commanders })
    .from(results).innerJoin(events, eq(results.eventId, events.id))
    .where(and(eq(results.memberId, mine.memberId), eq(events.status, 'published'))).orderBy(desc(events.eventDate), asc(events.id)) : [];
  return { league, roster, standings, events: leagueEvents, mine, myHistory };
}

export async function getEvent(leagueId: string, eventId: string, user: AppUser) {
  const db = getWriteDb();
  const admin = user.role === 'admin' || user.role === 'superadmin';
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  const [event] = await db.select().from(events).where(and(eq(events.leagueId, leagueId), eq(events.id, eventId)));
  if (!league || !event) invalid('Event not found.', 404);
  const roster = await leagueRoster(leagueId);
  const eventResults = admin || event.status === 'published' ? await db.select().from(results).where(eq(results.eventId, eventId)).orderBy(asc(results.rank)) : [];
  const resultIds = new Set(eventResults.map((row) => row.memberId));
  const revisions = admin ? await db.select().from(history).where(eq(history.eventId, eventId)).orderBy(desc(history.revision)) : [];
  return { league, event, results: eventResults.map((row) => ({ ...row, name: roster.find((member) => member.id === row.memberId)!.name })),
    roster: admin ? roster.filter((row) => (row.active && row.userId) || resultIds.has(row.id)) : [], history: revisions };
}
