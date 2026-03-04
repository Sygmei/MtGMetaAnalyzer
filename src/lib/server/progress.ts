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

export async function initProgress(id: string): Promise<ProgressState> {
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
  return state;
}

export async function updateProgress(
  id: string,
  patch: Partial<Pick<ProgressState, 'stage' | 'percent' | 'message' | 'done' | 'error'>>
): Promise<ProgressState | null> {
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
    message: patch.message ?? record.state.message,
    updatedAt: new Date().toISOString(),
    done: patch.done == null ? record.state.done : Boolean(patch.done),
    error: patch.error == null ? record.state.error : patch.error
  };
  record.state.updatedAt = now;
  record.expiresAtMs = Date.now() + TTL_MS;
  return record.state;
}

export async function completeProgress(id: string, message = 'Analysis complete.'): Promise<ProgressState | null> {
  return await updateProgress(id, {
    stage: 'done',
    percent: 100,
    message,
    done: true,
    error: null
  });
}

export async function failProgress(id: string, errorMessage: string): Promise<ProgressState | null> {
  return await updateProgress(id, {
    stage: 'error',
    percent: 100,
    message: 'Analysis failed.',
    done: true,
    error: errorMessage
  });
}

export async function getProgress(id: string): Promise<ProgressState | null> {
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
