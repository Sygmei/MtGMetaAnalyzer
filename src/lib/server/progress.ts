import { broadcastProgressUpdate, ensureProgressWebSocketServer } from './progress-ws';

export type ProgressStage = 'queued' | 'moxfield' | 'commander' | 'mtgtop8' | 'analysis' | 'done' | 'error';

export interface ProgressState {
  id: string;
  stage: ProgressStage;
  percent: number;
  message: string;
  updatedAt: string;
  startedAt: string;
  done: boolean;
  error: string | null;
}

interface ProgressRecord {
  state: ProgressState;
  expiresAtMs: number;
}

const TTL_MS = 30 * 60 * 1000;
const store = new Map<string, ProgressRecord>();

export function initProgress(id: string): ProgressState {
  ensureProgressWebSocketServer();
  cleanupExpired();
  const now = new Date().toISOString();
  const state: ProgressState = {
    id,
    stage: 'queued',
    percent: 1,
    message: 'Preparing analysis request...',
    updatedAt: now,
    startedAt: now,
    done: false,
    error: null
  };
  store.set(id, {
    state,
    expiresAtMs: Date.now() + TTL_MS
  });
  broadcastProgressUpdate(state);
  return state;
}

export function updateProgress(
  id: string,
  patch: Partial<Pick<ProgressState, 'stage' | 'percent' | 'message' | 'done' | 'error'>>
): ProgressState | null {
  ensureProgressWebSocketServer();
  cleanupExpired();
  const record = store.get(id);
  if (!record) {
    return null;
  }

  const nextPercent = patch.percent == null ? record.state.percent : clampPercent(patch.percent);
  const now = new Date().toISOString();
  record.state = {
    ...record.state,
    ...patch,
    percent: Math.max(record.state.percent, nextPercent),
    updatedAt: now
  };
  record.expiresAtMs = Date.now() + TTL_MS;
  broadcastProgressUpdate(record.state);
  return record.state;
}

export function completeProgress(id: string, message = 'Analysis complete.'): ProgressState | null {
  return updateProgress(id, {
    stage: 'done',
    percent: 100,
    message,
    done: true,
    error: null
  });
}

export function failProgress(id: string, errorMessage: string): ProgressState | null {
  return updateProgress(id, {
    stage: 'error',
    percent: 100,
    message: 'Analysis failed.',
    done: true,
    error: errorMessage
  });
}

export function getProgress(id: string): ProgressState | null {
  cleanupExpired();
  const record = store.get(id);
  if (!record) {
    return null;
  }
  record.expiresAtMs = Date.now() + TTL_MS;
  return record.state;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (value.expiresAtMs <= now) {
      store.delete(key);
    }
  }
}
