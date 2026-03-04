import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { analysisRuns } from './db-schema';
import { getDb } from './db';
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
  output: AnalyzeOutput;
  input: AnalysisInputSnapshot;
}

export async function saveAnalysisRun(input: SaveAnalysisRunInput): Promise<string> {
  const db = getDb();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shareId = generateShareId();
    try {
      await db.insert(analysisRuns).values({
        shareId,
        moxfieldUrl: input.moxfieldUrl,
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

  throw new Error('Could not allocate a unique share id for analysis run');
}

export async function findAnalysisRunByShareId(shareId: string): Promise<{
  shareId: string;
  moxfieldUrl: string;
  createdAt: string;
  payload: AnalyzeOutput;
  input: AnalysisInputSnapshot;
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      shareId: analysisRuns.shareId,
      moxfieldUrl: analysisRuns.moxfieldUrl,
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
