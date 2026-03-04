import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { RawData } from 'ws';

import type { ProgressState } from './progress';

const DEFAULT_WS_PORT = 3210;
const WS_PATH = '/progress';

interface ClientSession {
  progressId: string | null;
}

interface ProgressWsRuntime {
  server: WebSocketServer;
  clients: Map<WebSocket, ClientSession>;
  initError: string | null;
}

type ProgressWsGlobal = typeof globalThis & {
  __mtgMetaProgressWsRuntime?: ProgressWsRuntime;
};

function getRuntime(): ProgressWsRuntime | null {
  return (globalThis as ProgressWsGlobal).__mtgMetaProgressWsRuntime ?? null;
}

function setRuntime(runtime: ProgressWsRuntime): void {
  (globalThis as ProgressWsGlobal).__mtgMetaProgressWsRuntime = runtime;
}

export function ensureProgressWebSocketServer(): void {
  const existing = getRuntime();
  if (existing) {
    return;
  }

  const port = safePort(process.env.PROGRESS_WS_PORT || process.env.PUBLIC_PROGRESS_WS_PORT, DEFAULT_WS_PORT);
  const clients = new Map<WebSocket, ClientSession>();

  try {
    const server = new WebSocketServer({ port });
    const runtime: ProgressWsRuntime = {
      server,
      clients,
      initError: null
    };
    setRuntime(runtime);

    server.on('connection', (socket: WebSocket, request: IncomingMessage) => {
      if (request.url !== WS_PATH) {
        socket.close(1008, 'Invalid websocket path');
        return;
      }

      clients.set(socket, { progressId: null });
      socket.on('message', (payload: RawData) => {
        const data = parseJson(payload.toString());
        if (!data || data.type !== 'subscribe') {
          return;
        }
        const progressId = typeof data.progressId === 'string' ? data.progressId.trim() : '';
        if (!progressId) {
          return;
        }
        clients.set(socket, { progressId });
      });

      socket.on('close', () => {
        clients.delete(socket);
      });
    });

    server.on('error', (error: Error) => {
      runtime.initError = error instanceof Error ? error.message : String(error);
    });
  } catch (error) {
    const runtime: ProgressWsRuntime = {
      server: null as unknown as WebSocketServer,
      clients,
      initError: error instanceof Error ? error.message : String(error)
    };
    setRuntime(runtime);
  }
}

export function broadcastProgressUpdate(state: ProgressState): void {
  ensureProgressWebSocketServer();
  const runtime = getRuntime();
  if (!runtime || runtime.initError) {
    return;
  }

  const message = JSON.stringify({
    type: 'progress',
    state
  });

  for (const [socket, client] of runtime.clients.entries()) {
    if (socket.readyState !== WebSocket.OPEN) {
      runtime.clients.delete(socket);
      continue;
    }
    if (client.progressId !== state.id) {
      continue;
    }
    try {
      socket.send(message);
    } catch {
      runtime.clients.delete(socket);
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
    }
  }
}

function safePort(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
