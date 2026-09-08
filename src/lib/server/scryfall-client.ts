const origin = 'https://api.scryfall.com';
export const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const cache = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
let queue = Promise.resolve();
let nextRequest = 0;

export async function request(path: string): Promise<any> {
  const cached = cache.get(path);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pending.has(path)) return pending.get(path);
  // A single queue spaces all upstream requests, including concurrent roster hydration.
  if (pending.size >= 64) throw new Error('Scryfall request queue full');
  const result = queue.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
    nextRequest = Date.now() + 150;
    const response = await fetch(`${origin}${path}`, {
      headers: { 'User-Agent': 'Karton/0.1 (card selection)', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (response.status === 429) nextRequest = Date.now() + 1000;
    if (!response.ok && response.status !== 404) throw new Error(`Scryfall returned ${response.status}`);
    const value = response.status === 404 ? null : await response.json();
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(path, { value, expires: Date.now() + (value ? 60 * 60 * 1000 : 60000) });
    return value;
  });
  queue = result.then(() => {}, () => {});
  pending.set(path, result);
  try { return await result; } finally { pending.delete(path); }
}

