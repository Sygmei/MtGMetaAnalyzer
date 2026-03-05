import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { AppError } from './app-error';
import { analysisRuns } from './db-schema';
import { getReadDb, getWriteDb } from './db';
import type { AnalyzeOutput } from './types';

interface AnalysisInputSnapshot {
  startDate: string;
  endDate: string;
  keepTop: string;
  cutTop: string;
  addTop: string;
}

interface SaveAnalysisRunInput {
  moxfieldUrl: string;
  commanderName: string;
  ignoreBefore: string | null;
  ignoreAfter: string | null;
  clientIp: string;
  traceId?: string | null;
  output: AnalyzeOutput;
  input: AnalysisInputSnapshot;
}

export async function saveAnalysisRun(input: SaveAnalysisRunInput): Promise<string> {
  const db = getWriteDb();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shareId = generateShareId();
    try {
      await db.insert(analysisRuns).values({
        shareId,
        moxfieldUrl: input.moxfieldUrl,
        commanderName: input.commanderName,
        ignoreBefore: input.ignoreBefore,
        ignoreAfter: input.ignoreAfter,
        clientIp: input.clientIp,
        traceId: input.traceId ?? null,
        payloadJson: input.output,
        inputJson: input.input
      });
      return shareId;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  throw new AppError({
    userFacingError: 'Could not save analysis permalink. Please retry.',
    adminFacingError: 'Could not allocate a unique share id for analysis run after 8 attempts.',
    errorTypeName: 'AnalysisShareIdAllocationError',
    httpStatusCode: 500
  });
}

export async function findAnalysisRunByShareId(shareId: string): Promise<{
  shareId: string;
  moxfieldUrl: string;
  commanderName: string | null;
  ignoreBefore: string | null;
  ignoreAfter: string | null;
  clientIp: string;
  traceId: string | null;
  createdAt: string;
  payload: AnalyzeOutput;
  input: AnalysisInputSnapshot;
} | null> {
  const db = getReadDb();
  const rows = await db
    .select({
      shareId: analysisRuns.shareId,
      moxfieldUrl: analysisRuns.moxfieldUrl,
      commanderName: analysisRuns.commanderName,
      ignoreBefore: analysisRuns.ignoreBefore,
      ignoreAfter: analysisRuns.ignoreAfter,
      clientIp: analysisRuns.clientIp,
      traceId: analysisRuns.traceId,
      createdAt: analysisRuns.createdAt,
      payloadJson: analysisRuns.payloadJson,
      inputJson: analysisRuns.inputJson
    })
    .from(analysisRuns)
    .where(eq(analysisRuns.shareId, shareId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    shareId: row.shareId,
    moxfieldUrl: row.moxfieldUrl,
    commanderName: row.commanderName,
    ignoreBefore: row.ignoreBefore,
    ignoreAfter: row.ignoreAfter,
    clientIp: row.clientIp,
    traceId: row.traceId,
    createdAt: asIsoString(row.createdAt),
    payload: row.payloadJson,
    input: row.inputJson
  };
}

function generateShareId(): string {
  return randomBytes(6).toString('base64url');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function asIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}
