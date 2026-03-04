import { fail } from '@sveltejs/kit';

import { saveAnalysisRun } from '$lib/server/analysis-runs-repo';
import { withSpan } from '$lib/server/otel';
import { completeProgress, failProgress, initProgress, updateProgress } from '$lib/server/progress';
import { analyzeFromMoxfieldUrl } from '$lib/server/pipeline';
import { parseDate } from '$lib/server/utils';

import type { Actions } from './$types';

const DEFAULT_VALUES = {
  moxfieldUrl: '',
  startDate: '',
  endDate: '',
  keepTop: '50',
  cutTop: '50',
  addTop: '50'
};

export const actions: Actions = {
  default: async (event) => {
    const { request } = event;
    const formData = await request.formData();
    const clientIp = resolveClientIp(event);

    const values = {
      moxfieldUrl: String(formData.get('moxfieldUrl') || '').trim(),
      startDate: String(formData.get('startDate') || '').trim(),
      endDate: String(formData.get('endDate') || '').trim(),
      keepTop: String(formData.get('keepTop') || DEFAULT_VALUES.keepTop).trim(),
      cutTop: String(formData.get('cutTop') || DEFAULT_VALUES.cutTop).trim(),
      addTop: String(formData.get('addTop') || DEFAULT_VALUES.addTop).trim()
    };
    const progressId = String(formData.get('progressId') || '').trim();
    if (progressId) {
      await initProgress(progressId);
    }

    if (!values.moxfieldUrl) {
      if (progressId) {
        await failProgress(progressId, 'Moxfield URL is required');
      }
      return fail(400, {
        error: 'Moxfield URL is required',
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    const keepTop = parsePositiveInt(values.keepTop, 'keepTop');
    const cutTop = parsePositiveInt(values.cutTop, 'cutTop');
    const addTop = parsePositiveInt(values.addTop, 'addTop');

    if (typeof keepTop === 'string' || typeof cutTop === 'string' || typeof addTop === 'string') {
      if (progressId) {
        await failProgress(progressId, [keepTop, cutTop, addTop].find((item) => typeof item === 'string') || 'Invalid options');
      }
      return fail(400, {
        error: [keepTop, cutTop, addTop].find((item) => typeof item === 'string'),
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    const startDate = values.startDate ? parseDate(values.startDate) : null;
    const endDate = values.endDate ? parseDate(values.endDate) : null;

    if (values.startDate && !startDate) {
      if (progressId) {
        await failProgress(progressId, 'Invalid start date. Use YYYY-MM-DD');
      }
      return fail(400, {
        error: 'Invalid start date. Use YYYY-MM-DD',
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    if (values.endDate && !endDate) {
      if (progressId) {
        await failProgress(progressId, 'Invalid end date. Use YYYY-MM-DD');
      }
      return fail(400, {
        error: 'Invalid end date. Use YYYY-MM-DD',
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    if (startDate && endDate && startDate > endDate) {
      if (progressId) {
        await failProgress(progressId, 'Start date must be before or equal to end date');
      }
      return fail(400, {
        error: 'Start date must be before or equal to end date',
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    try {
      console.info(`[analysis] start ip=${clientIp} moxfieldUrl=${values.moxfieldUrl}`);
      const output = await withSpan(
        'analysis.execute',
        {
          'analysis.client_ip': clientIp,
          'analysis.moxfield_url': values.moxfieldUrl
        },
        () =>
          analyzeFromMoxfieldUrl({
            moxfieldUrl: values.moxfieldUrl,
            startDate,
            endDate,
            keepTop,
            cutTop,
            addTop,
            refreshCache: false,
            headless: true,
            onProgress: progressId
              ? (event) => {
                  void updateProgress(progressId, {
                    stage: event.stage,
                    percent: event.percentHint,
                    message: event.message
                  });
                }
              : undefined
          })
      );
      const shareId = await withSpan('analysis.persist', { 'analysis.client_ip': clientIp }, (span) =>
        saveAnalysisRun({
          moxfieldUrl: values.moxfieldUrl,
          clientIp,
          traceId: span.spanContext().traceId,
          output,
          input: {
            startDate: values.startDate,
            endDate: values.endDate,
            keepTop: values.keepTop,
            cutTop: values.cutTop,
            addTop: values.addTop
          }
        })
      );
      const shareUrl = new URL(`/analysis/${shareId}`, request.url).toString();
      const outputWithShare = {
        ...output,
        share: {
          id: shareId,
          url: shareUrl
        }
      };
      if (progressId) {
        await completeProgress(progressId);
      }
      console.info(
        `[analysis] success ip=${clientIp} moxfieldUrl=${values.moxfieldUrl} shareId=${shareId} totalDecks=${output.analysis.totalDecksConsidered}`
      );

      return {
        values: { ...DEFAULT_VALUES, ...values },
        output: outputWithShare
      };
    } catch (error) {
      console.error(`[analysis] failed ip=${clientIp} moxfieldUrl=${values.moxfieldUrl}`, error);
      if (progressId) {
        await failProgress(progressId, 'Analysis failed. Please retry.');
      }
      return fail(500, {
        error: 'Analysis failed. Please retry.',
        values: { ...DEFAULT_VALUES, ...values }
      });
    }
  }
};

function parsePositiveInt(raw: string, fieldName: string): number | string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    return `${fieldName} must be a positive integer`;
  }
  return value;
}

function resolveClientIp(event: Parameters<Actions['default']>[0]): string {
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
    // getClientAddress may be unavailable depending on runtime/proxy setup.
  }

  return 'unknown';
}
