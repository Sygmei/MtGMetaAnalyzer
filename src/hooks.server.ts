import type { Handle } from '@sveltejs/kit';

import { initOpenTelemetry, withSpan } from '$lib/server/otel';
import { ensureProgressWebSocketServer } from '$lib/server/progress-ws';

initOpenTelemetry();
ensureProgressWebSocketServer();

export const handle: Handle = async ({ event, resolve }) => {
  const clientIp = resolveClientIp(event);
  return await withSpan(
    'http.request',
    {
      'http.method': event.request.method,
      'http.route': event.url.pathname,
      'client.address': clientIp
    },
    async (span) => {
      const response = await resolve(event);
      span.setAttribute('http.status_code', response.status);
      return response;
    }
  );
};

function resolveClientIp(event: Parameters<Handle>[0]['event']): string {
  const headers = event.request.headers;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded
      .split(',')
      .map((item) => item.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }

  const realIp = headers.get('x-real-ip');
  if (realIp?.trim()) {
    return realIp.trim();
  }

  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp?.trim()) {
    return cfIp.trim();
  }

  try {
    const addr = event.getClientAddress();
    if (addr?.trim()) {
      return addr.trim();
    }
  } catch {
    // may be unavailable in some runtimes
  }

  return 'unknown';
}
