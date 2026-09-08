import { error } from '@sveltejs/kit';
import { canManageUsers } from '$lib/server/auth';
import { isAppError } from '$lib/server/app-error';
import { getEvent, requireTournamentUser, saveEvent, tournamentFailure } from '$lib/server/tournaments';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const user = requireTournamentUser(locals.user);
  try { return { ...await getEvent(params.leagueId, params.eventId, user), admin: canManageUsers(user), userId: user.id }; }
  catch (caught) {
    if (isAppError(caught)) throw error(caught.httpStatusCode, caught.userFacingError);
    throw caught;
  }
};

export const actions: Actions = {
  save: async ({ locals, params, request }) => {
    const form = await request.formData();
    try { await saveEvent(locals.user, params.leagueId, params.eventId, form); return { success: true }; }
    catch (error) { return tournamentFailure(error); }
  }
};
