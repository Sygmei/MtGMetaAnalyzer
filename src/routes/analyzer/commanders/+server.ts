import { commanderSearchResponse } from '$lib/server/commander-search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => commanderSearchResponse(url);
