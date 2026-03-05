export type ProgressStage = 'queued' | 'moxfield' | 'commander' | 'mtgtop8' | 'analysis' | 'done' | 'error';
export type ProgressDisplayStage = 'queued' | 'moxfield' | 'commander' | 'mtgtop8' | 'analysis';

export interface ProgressStageItem {
  key: ProgressDisplayStage;
  label: string;
}

const DEFAULT_PROGRESS_STAGES: ProgressStageItem[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'moxfield', label: 'Gathering Moxfield decklist' },
  { key: 'commander', label: 'Finding Commander on MtGTop8' },
  { key: 'mtgtop8', label: 'Gathering MtGTop8 decklists' },
  { key: 'analysis', label: 'Analysis' }
];

export interface ProgressStageDetails {
  mtgtop8?: {
    phase: 'start' | 'page' | 'deck' | 'complete';
    currentPage: number;
    totalPages: number | null;
    scannedPages: number;
    rowsOnPage: number;
    rowsToFetchOnPage: number;
    fetchedOnPage: number;
    fetchedDecks: number;
  };
}

export interface ProgressState {
  id: string;
  stage: ProgressStage;
  activeStageKey: ProgressDisplayStage;
  stages: ProgressStageItem[];
  percent: number;
  message: string;
  updatedAt: string;
  startedAt: string;
  done: boolean;
  error: string | null;
  details: ProgressStageDetails;
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
    activeStageKey: 'queued',
    stages: DEFAULT_PROGRESS_STAGES,
    percent: 1,
    message: 'Preparing analysis request...',
    updatedAt: now,
    startedAt: now,
    done: false,
    error: null,
    details: {}
  };
  store.set(id, {
    state,
    expiresAtMs: Date.now() + TTL_MS
  });
  return state;
}

export async function updateProgress(
  id: string,
  patch: Partial<Pick<ProgressState, 'stage' | 'percent' | 'message' | 'done' | 'error' | 'details' | 'activeStageKey'>>
): Promise<ProgressState | null> {
  cleanupExpired();
  const record = store.get(id);
  if (!record) {
    return null;
  }

  const nextPercent = patch.percent == null ? record.state.percent : clampPercent(patch.percent);
  const now = new Date().toISOString();
  const nextStage = patch.stage ?? record.state.stage;
  const nextActiveStageKey = patch.activeStageKey ?? toDisplayStage(nextStage);
  record.state = {
    ...record.state,
    ...patch,
    stage: nextStage,
    activeStageKey: nextActiveStageKey,
    stages: record.state.stages?.length ? record.state.stages : DEFAULT_PROGRESS_STAGES,
    percent: Math.max(record.state.percent, nextPercent),
    message: patch.message ?? record.state.message,
    updatedAt: new Date().toISOString(),
    done: patch.done == null ? record.state.done : Boolean(patch.done),
    error: patch.error == null ? record.state.error : patch.error,
    details: patch.details ?? record.state.details
  };
  record.state.updatedAt = now;
  record.expiresAtMs = Date.now() + TTL_MS;
  return record.state;
}

export async function completeProgress(id: string, message = 'Analysis complete.'): Promise<ProgressState | null> {
  return await updateProgress(id, {
    stage: 'done',
    activeStageKey: 'analysis',
    percent: 100,
    message,
    done: true,
    error: null,
    details: {}
  });
}

export async function failProgress(id: string, errorMessage: string): Promise<ProgressState | null> {
  return await updateProgress(id, {
    stage: 'error',
    activeStageKey: 'analysis',
    percent: 100,
    message: 'Analysis failed.',
    done: true,
    error: errorMessage,
    details: {}
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

function toDisplayStage(stage: ProgressStage): ProgressDisplayStage {
  if (stage === 'done' || stage === 'error') {
    return 'analysis';
  }
  return stage;
}
