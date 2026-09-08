import { error } from '@sveltejs/kit';
import { canManageUsers } from '$lib/server/auth';
import { commanderSearchResponse } from '$lib/server/commander-search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) error(401, 'Sign in to search commanders.');
  if (!canManageUsers(locals.user)) error(403, 'Only admins can edit tournament commanders.');
  return commanderSearchResponse(url);
};
