import { json } from '@sveltejs/kit';

import { getProgress } from '$lib/server/progress';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id?.trim();
  if (!id) {
    return json({ error: 'Progress id is required' }, { status: 400 });
  }

  const state = await getProgress(id);
  if (!state) {
    return json({ error: 'Progress id not found' }, { status: 404 });
  }

  return json(state);
};
