import { fail } from '@sveltejs/kit';

import { normalizeSupportedDeckUrl } from '$lib/adapters/deck-source';
import { saveAnalysisRun } from '$lib/server/analysis-runs-repo';
import { isAppError } from '$lib/server/app-error';
import { getTraceId, withSpan } from '$lib/server/otel';
import { completeProgress, failProgress, initProgress, updateProgress } from '$lib/server/progress';
import { analyzeDeck } from '$lib/server/pipeline';
import { parseDate } from '$lib/server/utils';

import type { Actions } from './$types';

const DEFAULT_VALUES = {
  inputMode: 'deck',
  commanderNames: '',
  moxfieldUrl: '',
  startDate: '',
  endDate: '',
  requiredCards: '',
  keepTop: '50',
  cutTop: '50',
  addTop: '50'
};

export const actions: Actions = {
  default: async (event) => {
    const { request } = event;
    const formData = await request.formData();
    const clientIp = resolveClientIp(event);
    const requestTraceId = normalizeTraceId(getTraceId());

    const values = {
      inputMode: String(formData.get('inputMode') || 'deck'),
      commanderNames: String(formData.get('commanderNames') || '').trim(),
      moxfieldUrl: String(formData.get('moxfieldUrl') || '').trim(),
      startDate: String(formData.get('startDate') || '').trim(),
      endDate: String(formData.get('endDate') || '').trim(),
      requiredCards: String(formData.get('requiredCards') || '').trim(),
      keepTop: String(formData.get('keepTop') || DEFAULT_VALUES.keepTop).trim(),
      cutTop: String(formData.get('cutTop') || DEFAULT_VALUES.cutTop).trim(),
      addTop: String(formData.get('addTop') || DEFAULT_VALUES.addTop).trim()
    };
    const progressId = String(formData.get('progressId') || '').trim();
    if (progressId) {
      await initProgress(progressId, values.inputMode === 'commander');
    }

    if (!['deck', 'commander'].includes(values.inputMode) ||
        (values.inputMode === 'commander' && (!values.commanderNames || values.commanderNames.length > 303))) {
      const message = 'Choose an input mode and enter a commander name.';
      if (progressId) await failProgress(progressId, message);
      return fail(400, { error: message, values });
    }
    if (values.inputMode === 'deck' && !values.moxfieldUrl) {
      if (progressId) {
        await failProgress(progressId, 'Deck URL is required');
      }
      return fail(400, {
        error: 'Deck URL is required',
        traceId: requestTraceId || undefined,
        values: { ...DEFAULT_VALUES, ...values }
      });
    }
    let normalizedMoxfieldUrl = '';
    if (values.inputMode === 'deck') {
      try {
        const normalized = normalizeSupportedDeckUrl(values.moxfieldUrl);
        normalizedMoxfieldUrl = normalized.normalizedUrl;
        values.moxfieldUrl = normalized.normalizedUrl;
      } catch (error) {
        const appError = isAppError(error) ? error : null;
        const status = appError?.httpStatusCode ?? 400;
        const userError =
          appError?.userFacingError ??
          'Invalid deck URL. Use moxfield.com/decks/<id>, archidekt.com/decks/<id>, or manabox.app/decks/<id>.';
        if (progressId) {
          await failProgress(progressId, userError);
        }
        return fail(status, {
          error: userError,
          traceId: requestTraceId || undefined,
          values: { ...DEFAULT_VALUES, ...values }
        });
      }

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
        traceId: requestTraceId || undefined,
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
        traceId: requestTraceId || undefined,
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    if (values.endDate && !endDate) {
      if (progressId) {
        await failProgress(progressId, 'Invalid end date. Use YYYY-MM-DD');
      }
      return fail(400, {
        error: 'Invalid end date. Use YYYY-MM-DD',
        traceId: requestTraceId || undefined,
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    if (startDate && endDate && startDate > endDate) {
      if (progressId) {
        await failProgress(progressId, 'Start date must be before or equal to end date');
      }
      return fail(400, {
        error: 'Start date must be before or equal to end date',
        traceId: requestTraceId || undefined,
        values: { ...DEFAULT_VALUES, ...values }
      });
    }

    let analysisTraceId = requestTraceId;
    try {
      const output = await withSpan(
        'analysis.execute',
        {
          'analysis.client_ip': clientIp,
          'analysis.deck_url': normalizedMoxfieldUrl
        },
        (span) => {
          analysisTraceId = normalizeTraceId(getTraceId(span));
          console.info(
            `[analysis] start trace_id=${analysisTraceId || 'unavailable'} ip=${clientIp} deckUrl=${normalizedMoxfieldUrl}`
          );

          return analyzeDeck({
            commanderNames: values.inputMode === 'commander' ? values.commanderNames : undefined,
            deckUrl: normalizedMoxfieldUrl,
            startDate,
            endDate,
            requiredCards: values.requiredCards.split(/\r?\n/).map((card) => card.trim()).filter(Boolean),
            keepTop,
            cutTop,
            addTop,
            refreshCache: false,
            headless: true,
            onProgress: progressId
              ? (event) => {
                  void updateProgress(progressId, {
                    stage: event.stage,
                    activeStageKey:
                      event.stage === 'done' ? 'analysis' : event.stage,
                    percent: event.percentHint,
                    message: event.message,
                    details: event.mtgtop8
                      ? {
                          mtgtop8: {
                            phase: event.mtgtop8.phase,
                            currentPage: event.mtgtop8.currentPage,
                            totalPages: event.mtgtop8.totalPages,
                            scannedPages: event.mtgtop8.scannedPages,
                            rowsOnPage: event.mtgtop8.rowsOnPage,
                            rowsToFetchOnPage: event.mtgtop8.rowsToFetchOnPage,
                            fetchedOnPage: event.mtgtop8.fetchedOnPage,
                            fetchedDecks: event.mtgtop8.fetchedDecks
                          }
                        }
                      : {}
                  });
                }
              : undefined
          });
        }
      );
      const shareId = await withSpan('analysis.persist', { 'analysis.client_ip': clientIp }, (span) =>
        saveAnalysisRun({
          moxfieldUrl: normalizedMoxfieldUrl,
          commanderName: output.commander.name,
          ignoreBefore: output.analysis.startDate,
          ignoreAfter: output.analysis.endDate,
          clientIp,
          userId: event.locals.user?.id ?? null,
          traceId: normalizeTraceId(span.spanContext().traceId),
          output,
          input: {
            inputMode: values.inputMode,
            commanderNames: values.commanderNames,
            startDate: values.startDate,
            endDate: values.endDate,
            requiredCards: values.requiredCards,
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
        `[analysis] success trace_id=${analysisTraceId || 'unavailable'} ip=${clientIp} deckUrl=${normalizedMoxfieldUrl} shareId=${shareId} totalDecks=${output.analysis.totalDecksConsidered}`
      );

      return {
        values: { ...DEFAULT_VALUES, ...values },
        output: outputWithShare
      };
    } catch (error) {
      const traceId = analysisTraceId || normalizeTraceId(getTraceId());
      const appError = isAppError(error) ? error : null;
      const status = appError?.httpStatusCode ?? 500;
      const userError = appError?.userFacingError ?? null;
      const errorType = appError?.errorTypeName ?? 'UnhandledAnalysisError';
      console.error(
        `[analysis] failed trace_id=${traceId || 'unavailable'} ip=${clientIp} deckUrl=${normalizedMoxfieldUrl || values.moxfieldUrl} status=${status} type=${errorType} admin_error=${appError?.adminFacingError || getErrorMessage(error)}`,
        error
      );
      if (progressId) {
        const progressMessage =
          status >= 500 && traceId
            ? `Analysis failed. Trace ID: ${traceId}`
            : traceId
              ? `${userError || 'The request could not be completed.'} (Trace ID: ${traceId})`
              : userError || 'The request could not be completed.';
        await failProgress(progressId, progressMessage);
      }
      if (status >= 500) {
        return fail(500, {
          traceId: traceId || undefined,
          values: { ...DEFAULT_VALUES, ...values }
        });
      }
      return fail(status, {
        error: userError || 'The request could not be completed.',
        traceId: traceId || undefined,
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

function normalizeTraceId(value: string | null | undefined): string | null {
  const candidate = String(value || '').trim();
  if (/^[0-9a-f]{32}$/.test(candidate) && !/^0+$/.test(candidate)) {
    return candidate;
  }
  return null;
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || '';
  }
  if (typeof error === 'string') {
    return error;
  }
  return '';
}
