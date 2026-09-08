import { redirect } from '@sveltejs/kit';
import { canManageUsers } from '$lib/server/auth';
import { createLeague, listLeagues, requireTournamentUser, tournamentFailure } from '$lib/server/tournaments';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireTournamentUser(locals.user);
  return { leagues: await listLeagues(user), admin: canManageUsers(user) };
};

export const actions: Actions = {
  create: async ({ locals, request }) => {
    let id: string;
    try { id = await createLeague(locals.user, await request.formData()); }
    catch (error) { return tournamentFailure(error); }
    throw redirect(303, `/tournament/${id}`);
  }
};
