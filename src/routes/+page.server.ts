import { fail } from '@sveltejs/kit';

import { saveAnalysisRun } from '$lib/server/analysis-runs-repo';
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
  default: async ({ request }) => {
    const formData = await request.formData();

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
      initProgress(progressId);
    }

    if (!values.moxfieldUrl) {
      if (progressId) {
        failProgress(progressId, 'Moxfield URL is required');
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
        failProgress(progressId, [keepTop, cutTop, addTop].find((item) => typeof item === 'string') || 'Invalid options');
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
        failProgress(progressId, 'Invalid start date. Use YYYY-MM-DD');
      }
      return fail(400, {
        error: 'Invalid start date. Use YYYY-MM-DD',
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    if (values.endDate && !endDate) {
      if (progressId) {
        failProgress(progressId, 'Invalid end date. Use YYYY-MM-DD');
      }
      return fail(400, {
        error: 'Invalid end date. Use YYYY-MM-DD',
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    if (startDate && endDate && startDate > endDate) {
      if (progressId) {
        failProgress(progressId, 'Start date must be before or equal to end date');
      }
      return fail(400, {
        error: 'Start date must be before or equal to end date',
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    try {
      const output = await analyzeFromMoxfieldUrl({
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
              updateProgress(progressId, {
                stage: event.stage,
                percent: event.percentHint,
                message: event.message
              });
            }
          : undefined
      });
      const shareId = await saveAnalysisRun({
        moxfieldUrl: values.moxfieldUrl,
        output,
        input: {
          startDate: values.startDate,
          endDate: values.endDate,
          keepTop: values.keepTop,
          cutTop: values.cutTop,
          addTop: values.addTop
        }
      });
      const shareUrl = new URL(`/analysis/${shareId}`, request.url).toString();
      const outputWithShare = {
        ...output,
        share: {
          id: shareId,
          url: shareUrl
        }
      };
      if (progressId) {
        completeProgress(progressId);
      }

      return {
        values: { ...DEFAULT_VALUES, ...values },
        output: outputWithShare
      };
    } catch (error) {
      if (progressId) {
        failProgress(progressId, error instanceof Error ? error.message : 'Unexpected error during analysis');
      }
      return fail(500, {
        error: error instanceof Error ? error.message : 'Unexpected error during analysis',
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
