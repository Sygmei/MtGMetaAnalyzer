// @ts-nocheck
import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { load } from 'cheerio';
import { trace } from '@opentelemetry/api';
import { chromium } from 'playwright';

import { AppError, isAppError } from './app-error';
import type { CardMap, MoxfieldDeck } from './types';
import { DEFAULT_USER_AGENT, normalizeName } from './utils';

interface FetchMoxfieldOptions {
  timeoutMs?: number;
  headless?: boolean;
}

const SCRYFALL_NAMED_FUZZY_URL = 'https://api.scryfall.com/cards/named';
const SCRYFALL_TIMEOUT_MS = 8_000;
const scryfallNameCache = new Map<string, string>();
const MOXFIELD_ALLOWED_HOSTS = new Set(['moxfield.com', 'www.moxfield.com']);
const MOXFIELD_PLAYWRIGHT_MAX_ATTEMPTS = 2;
const MOXFIELD_EARLY_SIGNAL_TIMEOUT_MS = 7_000;
const MOXFIELD_RETRY_DELAY_MS = 800;
const DEFAULT_S3_SCREENSHOT_PREFIX = 'traces/screenshots';

let s3Client: S3Client | null = null;

interface S3ScreenshotConfig {
  endpointUrl: string | null;
  regionName: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  keyPrefix: string;
}

interface UploadedScreenshot {
  objectKey: string;
  objectUrl: string;
}

export function extractDeckId(moxfieldUrl: string): string {
  const normalized = normalizeMoxfieldDeckUrl(moxfieldUrl);
  const pathname = new URL(normalized).pathname;
  const match = /^\/decks\/([A-Za-z0-9_-]+)/.exec(pathname);
  if (!match?.[1]) {
    throw new AppError({
      userFacingError: 'Invalid Moxfield URL. Use moxfield.com/decks/<id>.',
      adminFacingError: `Could not parse Moxfield deck id from normalized url: ${normalized}`,
      errorTypeName: 'MoxfieldDeckIdParseError',
      httpStatusCode: 400
    });
  }
  return match[1];
}

export function normalizeMoxfieldDeckUrl(value: string): string {
  const input = String(value || '').trim();
  if (!input) {
    throw new AppError({
      userFacingError: 'Moxfield URL is required.',
      adminFacingError: 'Moxfield URL is empty.',
      errorTypeName: 'MoxfieldUrlMissingError',
      httpStatusCode: 400
    });
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new AppError({
      userFacingError: 'Invalid Moxfield URL. Use moxfield.com/decks/<id>.',
      adminFacingError: `Invalid Moxfield URL parse failure: ${value}`,
      errorTypeName: 'MoxfieldUrlInvalidError',
      httpStatusCode: 400
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (!MOXFIELD_ALLOWED_HOSTS.has(host)) {
    throw new AppError({
      userFacingError: 'Invalid Moxfield URL host. Use moxfield.com.',
      adminFacingError: `Invalid Moxfield host: ${parsed.hostname}`,
      errorTypeName: 'MoxfieldHostInvalidError',
      httpStatusCode: 400
    });
  }

  const match = /^\/decks\/([A-Za-z0-9_-]+)/.exec(parsed.pathname);
  if (!match?.[1]) {
    throw new AppError({
      userFacingError: 'Invalid Moxfield URL. Use moxfield.com/decks/<id>.',
      adminFacingError: `Could not parse Moxfield deck id from input: ${value}`,
      errorTypeName: 'MoxfieldDeckIdParseError',
      httpStatusCode: 400
    });
  }

  return `https://moxfield.com/decks/${match[1]}`;
}

export async function fetchMoxfieldDeck(
  moxfieldUrl: string,
  options: FetchMoxfieldOptions = {}
): Promise<MoxfieldDeck> {
  const normalizedMoxfieldUrl = normalizeMoxfieldDeckUrl(moxfieldUrl);
  const deckId = extractDeckId(normalizedMoxfieldUrl);
  const timeoutMs = options.timeoutMs ?? 25_000;
  const headless = options.headless ?? true;

  let networkPayload: Record<string, unknown> | null = null;
  let pageHtml = '';
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MOXFIELD_PLAYWRIGHT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fetched = await fetchMoxfieldDeckWithPlaywrightAttempt({
        deckId,
        deckUrl: normalizedMoxfieldUrl,
        timeoutMs,
        headless,
        attempt,
        maxAttempts: MOXFIELD_PLAYWRIGHT_MAX_ATTEMPTS
      });
      networkPayload = fetched.networkPayload;
      pageHtml = fetched.pageHtml;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!shouldRetryMoxfieldPlaywrightError(error) || attempt >= MOXFIELD_PLAYWRIGHT_MAX_ATTEMPTS) {
        throw error;
      }
      attachPlaywrightRetryToTrace({
        deckId,
        deckUrl: normalizedMoxfieldUrl,
        attempt,
        maxAttempts: MOXFIELD_PLAYWRIGHT_MAX_ATTEMPTS,
        error
      });
      await delay(MOXFIELD_RETRY_DELAY_MS);
    }
  }

  if (!pageHtml && !networkPayload && lastError) {
    throw lastError;
  }

  const domPayload = extractDeckPayloadFromDomHtml(pageHtml, deckId);
  const nextDataPayload = extractDeckPayloadFromHtml(pageHtml);

  let payload = networkPayload;
  if (payload && domPayload) {
    payload = mergeDeckPayload(payload, domPayload);
  } else if (!payload) {
    payload = nextDataPayload;
    if (payload && domPayload) {
      payload = mergeDeckPayload(payload, domPayload);
    } else if (!payload) {
      payload = domPayload;
    }
  }

  if (!payload) {
    throw new AppError({
      userFacingError: 'Could not extract this Moxfield deck. Verify the URL and that the deck is public.',
      adminFacingError: `Playwright extraction failed for Moxfield deck ${deckId} (${normalizedMoxfieldUrl})`,
      errorTypeName: 'MoxfieldDeckExtractionError',
      httpStatusCode: 422
    });
  }

  const commanders = extractCommanders(payload);
  if (!commanders.length) {
    throw new AppError({
      userFacingError: 'Could not detect a commander in this Moxfield deck.',
      adminFacingError: `Commander detection failed for Moxfield deck ${deckId}`,
      errorTypeName: 'MoxfieldCommanderMissingError',
      httpStatusCode: 422
    });
  }

  const cards = extractCards(getMainboardPayload(payload));
  const normalizedDeck = await normalizeMoxfieldDeckNames({
    deckId,
    name: String(payload.name || deckId),
    url: normalizedMoxfieldUrl,
    commanders,
    cards
  }, pageHtml);

  return normalizedDeck;
}

async function fetchMoxfieldDeckWithPlaywrightAttempt(args: {
  deckId: string;
  deckUrl: string;
  timeoutMs: number;
  headless: boolean;
  attempt: number;
  maxAttempts: number;
}): Promise<{ networkPayload: Record<string, unknown> | null; pageHtml: string }> {
  let browser: any = null;
  let context: any = null;
  let page: any = null;
  let networkPayload: Record<string, unknown> | null = null;
  let pageHtml = '';

  try {
    try {
      browser = await chromium.launch({ headless: args.headless });
    } catch (error) {
      throw new AppError({
        userFacingError: 'Moxfield browser session could not start. Please retry.',
        adminFacingError: `Playwright browser launch failed for deck=${args.deckId} attempt=${args.attempt}/${args.maxAttempts} cause=${error instanceof Error ? error.message : String(error)}`,
        errorTypeName: 'MoxfieldBrowserLaunchError',
        httpStatusCode: 502,
        cause: error
      });
    }

    context = await browser.newContext({
      userAgent: process.env.MOXFIELD_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
      locale: 'en-US'
    });
    page = await context.newPage();

    page.on('response', async (response: any) => {
      const url = response.url().toLowerCase();
      if (!url.includes('/decks/all/') || !url.includes('moxfield.com')) {
        return;
      }
      if (response.status() !== 200) {
        return;
      }
      try {
        const payload = (await response.json()) as unknown;
        const extracted = extractDeckPayloadFromTree(payload);
        if (extracted) {
          networkPayload = extracted;
        }
      } catch {
        // ignore noisy response parse errors
      }
    });

    try {
      const response = await page.goto(args.deckUrl, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
      const status = response?.status?.() ?? 0;
      if (status >= 400) {
        const screenshot = await capturePlaywrightFailureScreenshot(page, args.deckId);
        attachPlaywrightFailureToTrace({
          deckId: args.deckId,
          deckUrl: args.deckUrl,
          reason: 'navigation_http_status',
          screenshot,
          error: `status=${status}`,
          attempt: args.attempt,
          maxAttempts: args.maxAttempts
        });
        throw new AppError({
          userFacingError: 'Could not load this Moxfield deck page. Verify the URL and that the deck is public.',
          adminFacingError: [
            `Moxfield navigation returned status ${status} for ${args.deckUrl}`,
            `attempt=${args.attempt}/${args.maxAttempts}`,
            screenshot?.objectUrl ? `screenshot_object_url=${screenshot.objectUrl}` : 'screenshot_object_url=unavailable'
          ].join(' | '),
          errorTypeName: 'MoxfieldNavigationHttpError',
          httpStatusCode: 422
        });
      }
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }
      const screenshot = await capturePlaywrightFailureScreenshot(page, args.deckId);
      attachPlaywrightFailureToTrace({
        deckId: args.deckId,
        deckUrl: args.deckUrl,
        reason: 'page_load_failed',
        screenshot,
        error,
        attempt: args.attempt,
        maxAttempts: args.maxAttempts
      });
      throw new AppError({
        userFacingError: 'Could not load this Moxfield deck page. Verify the URL and that the deck is public.',
        adminFacingError: [
          `Playwright failed to load Moxfield page ${args.deckUrl}`,
          `attempt=${args.attempt}/${args.maxAttempts}`,
          screenshot?.objectUrl ? `screenshot_object_url=${screenshot.objectUrl}` : 'screenshot_object_url=unavailable',
          `cause=${error instanceof Error ? error.message : String(error)}`
        ].join(' | '),
        errorTypeName: 'MoxfieldPageLoadError',
        httpStatusCode: 422,
        cause: error
      });
    }

    const earlySignalTimeoutMs = Math.min(args.timeoutMs, MOXFIELD_EARLY_SIGNAL_TIMEOUT_MS);
    const hasEarlySignal = await waitForEarlyMoxfieldSignal({
      page,
      timeoutMs: earlySignalTimeoutMs,
      hasNetworkPayload: () => Boolean(networkPayload)
    });
    if (!hasEarlySignal) {
      const screenshot = await capturePlaywrightFailureScreenshot(page, args.deckId);
      const error = `No Moxfield data signal within ${earlySignalTimeoutMs}ms`;
      attachPlaywrightFailureToTrace({
        deckId: args.deckId,
        deckUrl: args.deckUrl,
        reason: 'early_signal_timeout',
        screenshot,
        error,
        attempt: args.attempt,
        maxAttempts: args.maxAttempts
      });
      throw new AppError({
        userFacingError: 'Could not load this Moxfield deck page. Verify the URL and that the deck is public.',
        adminFacingError: [
          `No Moxfield data signal detected after navigation for ${args.deckUrl}`,
          `attempt=${args.attempt}/${args.maxAttempts}`,
          `timeout_ms=${earlySignalTimeoutMs}`,
          screenshot?.objectUrl ? `screenshot_object_url=${screenshot.objectUrl}` : 'screenshot_object_url=unavailable'
        ].join(' | '),
        errorTypeName: 'MoxfieldEarlySignalTimeoutError',
        httpStatusCode: 422
      });
    }

    await page.waitForLoadState('networkidle', { timeout: Math.min(args.timeoutMs, 8_000) }).catch(() => null);
    pageHtml = await page.content();
    return { networkPayload, pageHtml };
  } finally {
    if (context) {
      await context.close().catch(() => null);
    }
    if (browser) {
      await browser.close().catch(() => null);
    }
  }
}

async function capturePlaywrightFailureScreenshot(page: any, deckId: string): Promise<UploadedScreenshot | null> {
  try {
    const buffer = await page.screenshot({
      fullPage: true,
      type: 'jpeg',
      quality: 70
    });
    return await uploadMoxfieldFailureScreenshotToS3(buffer, deckId);
  } catch {
    return null;
  }
}

function attachPlaywrightFailureToTrace(args: {
  deckId: string;
  deckUrl: string;
  reason: string;
  screenshot: UploadedScreenshot | null;
  error: unknown;
  attempt?: number;
  maxAttempts?: number;
}): void {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }

  span.setAttribute('moxfield.playwright.failure.reason', args.reason);
  span.setAttribute('moxfield.playwright.failure.deck_id', args.deckId);
  span.setAttribute('moxfield.playwright.failure.url', args.deckUrl);
  if (args.attempt != null) {
    span.setAttribute('moxfield.playwright.failure.attempt', args.attempt);
  }
  if (args.maxAttempts != null) {
    span.setAttribute('moxfield.playwright.failure.max_attempts', args.maxAttempts);
  }
  if (args.screenshot) {
    span.setAttribute('moxfield.playwright.failure.screenshot_s3_key', args.screenshot.objectKey);
    span.setAttribute('moxfield.playwright.failure.screenshot_s3_url', args.screenshot.objectUrl);
  }
  span.addEvent('moxfield.playwright.failure', {
    'moxfield.playwright.failure.reason': args.reason,
    'moxfield.playwright.failure.deck_id': args.deckId,
    'moxfield.playwright.failure.url': args.deckUrl,
    'moxfield.playwright.failure.attempt': args.attempt ?? 0,
    'moxfield.playwright.failure.max_attempts': args.maxAttempts ?? 0,
    'moxfield.playwright.failure.screenshot_s3_key': args.screenshot?.objectKey || 'unavailable',
    'moxfield.playwright.failure.screenshot_s3_url': args.screenshot?.objectUrl || 'unavailable',
    'moxfield.playwright.failure.error': args.error instanceof Error ? args.error.message : String(args.error)
  });
}

function attachPlaywrightRetryToTrace(args: {
  deckId: string;
  deckUrl: string;
  attempt: number;
  maxAttempts: number;
  error: unknown;
}): void {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }

  span.addEvent('moxfield.playwright.retry', {
    'moxfield.playwright.retry.deck_id': args.deckId,
    'moxfield.playwright.retry.url': args.deckUrl,
    'moxfield.playwright.retry.attempt': args.attempt,
    'moxfield.playwright.retry.max_attempts': args.maxAttempts,
    'moxfield.playwright.retry.error_type': isAppError(args.error) ? args.error.errorTypeName : 'UnknownError'
  });
}

function shouldRetryMoxfieldPlaywrightError(error: unknown): boolean {
  if (!isAppError(error)) {
    return false;
  }

  return (
    error.errorTypeName === 'MoxfieldBrowserLaunchError' ||
    error.errorTypeName === 'MoxfieldPageLoadError' ||
    error.errorTypeName === 'MoxfieldNavigationHttpError' ||
    error.errorTypeName === 'MoxfieldEarlySignalTimeoutError'
  );
}

async function waitForEarlyMoxfieldSignal(args: {
  page: any;
  timeoutMs: number;
  hasNetworkPayload: () => boolean;
}): Promise<boolean> {
  const deadline = Date.now() + Math.max(500, args.timeoutMs);
  while (Date.now() < deadline) {
    if (args.hasNetworkPayload()) {
      return true;
    }
    const hasNextData = await args.page
      .evaluate(() => {
        const script = document.querySelector('script#__NEXT_DATA__');
        return Boolean(script && script.textContent && script.textContent.trim().length > 0);
      })
      .catch(() => false);
    if (hasNextData) {
      return true;
    }
    await delay(200);
  }
  return args.hasNetworkPayload();
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadMoxfieldFailureScreenshotToS3(
  screenshotBuffer: Uint8Array,
  deckId: string
): Promise<UploadedScreenshot | null> {
  const config = getS3ScreenshotConfig();
  if (!config) {
    return null;
  }

  try {
    const client = getS3Client(config);
    const safeDeckId = sanitizeS3KeyPart(deckId || 'unknown');
    const key = `${config.keyPrefix}/${safeDeckId}/${Date.now()}-${randomUUID()}.jpg`;
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: screenshotBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'no-store',
        Metadata: {
          source: 'moxfield-playwright-failure',
          deck_id: safeDeckId
        }
      })
    );

    return {
      objectKey: key,
      objectUrl: buildS3ObjectUrl(config, key)
    };
  } catch (error) {
    const span = trace.getActiveSpan();
    span?.addEvent('moxfield.playwright.failure.s3_upload_failed', {
      'moxfield.playwright.failure.s3_upload_error': error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function getS3Client(config: S3ScreenshotConfig): S3Client {
  if (s3Client) {
    return s3Client;
  }

  s3Client = new S3Client({
    region: config.regionName,
    endpoint: config.endpointUrl || undefined,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
  return s3Client;
}

function getS3ScreenshotConfig(): S3ScreenshotConfig | null {
  const endpointUrl = normalizeOptional(process.env.S3_ENDPOINT_URL) || normalizeOptional(process.env.AWS_ENDPOINT_URL);
  const regionName = normalizeOptional(process.env.S3_REGION_NAME) || normalizeOptional(process.env.AWS_REGION);
  const bucketName = normalizeOptional(process.env.S3_BUCKET_NAME);
  const accessKeyId = normalizeOptional(process.env.S3_ACCESS_KEY_ID) || normalizeOptional(process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey =
    normalizeOptional(process.env.S3_SECRET_ACCESS_KEY) || normalizeOptional(process.env.AWS_SECRET_ACCESS_KEY);

  if (!regionName || !bucketName || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const keyPrefix = sanitizeS3Prefix(normalizeOptional(process.env.S3_SCREENSHOT_PREFIX) || DEFAULT_S3_SCREENSHOT_PREFIX);
  const forcePathStyle = parseBoolean(process.env.S3_FORCE_PATH_STYLE, endpointUrl ? true : false);

  return {
    endpointUrl,
    regionName,
    bucketName,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    keyPrefix
  };
}

function buildS3ObjectUrl(config: S3ScreenshotConfig, key: string): string {
  const encodedKey = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  if (config.endpointUrl) {
    const endpoint = config.endpointUrl.replace(/\/+$/, '');
    return `${endpoint}/${encodeURIComponent(config.bucketName)}/${encodedKey}`;
  }

  return `https://${config.bucketName}.s3.${config.regionName}.amazonaws.com/${encodedKey}`;
}

function sanitizeS3Prefix(value: string): string {
  const trimmed = value.replace(/^\/+|\/+$/g, '');
  return trimmed || DEFAULT_S3_SCREENSHOT_PREFIX;
}

function sanitizeS3KeyPart(value: string): string {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  return normalized || 'unknown';
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = normalizeOptional(value)?.toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

async function normalizeMoxfieldDeckNames(deck: MoxfieldDeck, html: string): Promise<MoxfieldDeck> {
  if (!html.trim()) {
    return deck;
  }

  const aliases = await buildCanonicalAliasMapFromHtml(html);
  if (!aliases.size) {
    return deck;
  }

  let commanderRenamed = 0;
  const commanders = dedupePreserveOrder(
    deck.commanders
      .map((name) => {
        const canonical = aliases.get(normalizeName(name)) || name;
        if (canonical !== name) {
          commanderRenamed += 1;
        }
        return canonical;
      })
      .filter(Boolean)
  );

  const cards: CardMap = {};
  let cardRenamed = 0;
  for (const [rawName, quantity] of Object.entries(deck.cards)) {
    const normalized = normalizeName(rawName);
    const canonicalName = aliases.get(normalized) || rawName;
    if (canonicalName !== rawName) {
      cardRenamed += 1;
    }
    cards[canonicalName] = (cards[canonicalName] || 0) + quantity;
  }

  if (cardRenamed || commanderRenamed) {
    console.info(
      `Moxfield: normalized flavor names aliases=${aliases.size} cards_renamed=${cardRenamed} commanders_renamed=${commanderRenamed}`
    );
  }

  return {
    ...deck,
    commanders,
    cards
  };
}

async function buildCanonicalAliasMapFromHtml(html: string): Promise<Map<string, string>> {
  const $ = load(html);
  const flavorToHint = new Map<string, { display: string; hint: string }>();

  $('a[href^="/cards/"]').each((_, anchor) => {
    const href = String($(anchor).attr('href') || '').trim();
    const displayName = $(anchor).text().replace(/\s+/g, ' ').trim();
    const canonicalHint = extractCardNameHintFromHref(href);
    if (!displayName || !canonicalHint) {
      return;
    }

    const displayNorm = normalizeName(displayName);
    const hintNorm = normalizeName(canonicalHint);
    if (!displayNorm || !hintNorm || displayNorm === hintNorm) {
      return;
    }
    if (!flavorToHint.has(displayNorm)) {
      flavorToHint.set(displayNorm, { display: displayName, hint: canonicalHint });
    }
  });

  if (!flavorToHint.size) {
    return new Map<string, string>();
  }

  const hintToCanonical = new Map<string, string>();
  await Promise.all(
    [...new Set([...flavorToHint.values()].map((entry) => entry.hint))].map(async (hint) => {
      const canonical = await resolveScryfallCanonicalName(hint);
      hintToCanonical.set(hint, canonical || hint);
    })
  );

  const aliases = new Map<string, string>();
  for (const [displayNorm, entry] of flavorToHint.entries()) {
    const canonical = hintToCanonical.get(entry.hint);
    if (!canonical) {
      continue;
    }
    const preferred = choosePreferredCanonicalName(entry.display, canonical);
    if (!preferred || normalizeName(preferred) === displayNorm) {
      continue;
    }
    aliases.set(displayNorm, preferred);
  }

  return aliases;
}

function choosePreferredCanonicalName(displayName: string, resolvedName: string): string {
  const normalizedDisplay = normalizeName(displayName);
  const faces = resolvedName
    .split(/\s*\/\/\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!faces.length) {
    return resolvedName;
  }
  if (faces.length === 1 || !normalizedDisplay) {
    return faces[0];
  }

  for (const face of faces) {
    if (normalizeName(face) === normalizedDisplay) {
      return face;
    }
  }
  for (const face of faces) {
    const normalizedFace = normalizeName(face);
    if (!normalizedFace) {
      continue;
    }
    if (normalizedFace.includes(normalizedDisplay) || normalizedDisplay.includes(normalizedFace)) {
      return face;
    }
  }

  return faces[0];
}

function extractCardNameHintFromHref(href: string): string | null {
  if (!href) {
    return null;
  }

  const match = href.match(/^\/cards\/[A-Za-z0-9]+-([A-Za-z0-9-]+)$/);
  if (!match || !match[1]) {
    return null;
  }

  return match[1]
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveScryfallCanonicalName(nameHint: string): Promise<string | null> {
  const key = normalizeName(nameHint);
  if (!key) {
    return null;
  }
  if (scryfallNameCache.has(key)) {
    return scryfallNameCache.get(key) || null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRYFALL_TIMEOUT_MS);
  try {
    const url = new URL(SCRYFALL_NAMED_FUZZY_URL);
    url.searchParams.set('fuzzy', nameHint);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'user-agent': process.env.MOXFIELD_USER_AGENT?.trim() || DEFAULT_USER_AGENT
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    const resolved = extractScryfallCardName(payload);
    if (resolved) {
      scryfallNameCache.set(key, resolved);
    }
    return resolved;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractScryfallCardName(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const item = payload as Record<string, unknown>;
  const name = String(item.name || '').trim();
  return name || null;
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function extractCards(boardPayload: unknown): CardMap {
  const cards: CardMap = {};
  if (!boardPayload || typeof boardPayload !== 'object') {
    return cards;
  }

  const entries = Array.isArray(boardPayload)
    ? boardPayload
    : Object.values(boardPayload as Record<string, unknown>);

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const quantity = safeInt(item.quantity);
    const embeddedCard =
      item.card && typeof item.card === 'object'
        ? (item.card as Record<string, unknown>)
        : item;
    const name = String(
      embeddedCard.name || embeddedCard.cardName || embeddedCard.card_name || item.name || ''
    ).trim();
    if (quantity > 0 && name) {
      cards[name] = quantity;
    }
  }

  return cards;
}

function extractCommanders(payload: Record<string, unknown>): string[] {
  const commandersPayload = getCommandersPayload(payload);

  if (commandersPayload && typeof commandersPayload === 'object' && !Array.isArray(commandersPayload)) {
    const names = Object.values(commandersPayload)
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return '';
        }
        const item = entry as Record<string, unknown>;
        const card = item.card && typeof item.card === 'object' ? (item.card as Record<string, unknown>) : item;
        return String(card.name || item.name || item.cardName || '').trim();
      })
      .filter(Boolean);
    if (names.length) {
      return names;
    }
  }

  if (Array.isArray(commandersPayload)) {
    const names = commandersPayload
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return '';
        }
        const item = entry as Record<string, unknown>;
        const card = item.card && typeof item.card === 'object' ? (item.card as Record<string, unknown>) : item;
        return String(card.name || card.cardName || item.name || '').trim();
      })
      .filter(Boolean);
    if (names.length) {
      return names;
    }
  }

  const fallback = String(payload.commander || '').trim();
  return fallback ? [fallback] : [];
}

function payloadLooksLikeDeck(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  return Boolean(Object.keys(extractCards(getMainboardPayload(payload))).length || extractCommanders(payload).length);
}

function extractDeckPayloadFromTree(root: unknown): Record<string, unknown> | null {
  const stack: unknown[] = [root];
  const seen = new Set<object>();

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') {
      continue;
    }

    if (seen.has(node)) {
      continue;
    }
    seen.add(node);

    if (!Array.isArray(node) && payloadLooksLikeDeck(node)) {
      return node;
    }

    if (Array.isArray(node)) {
      stack.push(...node);
    } else {
      stack.push(...Object.values(node));
    }
  }

  return null;
}

function extractDeckPayloadFromHtml(html: string): Record<string, unknown> | null {
  const matches = [...html.matchAll(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>\s*([\s\S]*?)\s*<\/script>/gi)];
  for (const match of matches) {
    const raw = match[1];
    try {
      const payload = JSON.parse(raw) as unknown;
      const extracted = extractDeckPayloadFromTree(payload);
      if (extracted) {
        return extracted;
      }
    } catch {
      // keep scanning
    }
  }
  return null;
}

function getMainboardPayload(payload: Record<string, unknown>): unknown {
  if (payload.mainboard) {
    return payload.mainboard;
  }
  if (payload.mainBoard) {
    return payload.mainBoard;
  }

  const boards = payload.boards;
  if (boards && typeof boards === 'object' && !Array.isArray(boards)) {
    const map = boards as Record<string, unknown>;
    return map.mainboard || map.mainBoard || map.main || {};
  }

  return {};
}

function getCommandersPayload(payload: Record<string, unknown>): unknown {
  if (payload.commanders) {
    return payload.commanders;
  }
  if (payload.commander && (Array.isArray(payload.commander) || typeof payload.commander === 'object')) {
    return payload.commander;
  }

  const boards = payload.boards;
  if (boards && typeof boards === 'object' && !Array.isArray(boards)) {
    const map = boards as Record<string, unknown>;
    return map.commanders || map.commander || map.command || {};
  }

  return {};
}

function mergeDeckPayload(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...primary };

  if (!String(primary.name || '').trim()) {
    merged.name = fallback.name || merged.name;
  }

  if (!Object.keys(extractCards(getMainboardPayload(primary))).length) {
    merged.mainboard = fallback.mainboard || {};
  } else if (!merged.mainboard && fallback.mainboard) {
    merged.mainboard = fallback.mainboard;
  }

  if (!extractCommanders(primary).length) {
    merged.commanders = fallback.commanders || {};
  } else if (!merged.commanders && fallback.commanders) {
    merged.commanders = fallback.commanders;
  }

  return merged;
}

function extractDeckPayloadFromDomHtml(html: string, deckId: string): Record<string, unknown> | null {
  const $ = load(html);
  const articles = $('article').toArray();

  let best: { commanders: Record<string, unknown>; mainboard: Record<string, unknown> } | null = null;
  let bestScore = -1;

  for (const article of articles) {
    const parsed = parseArticleDeck($, article);
    if (!parsed) {
      continue;
    }
    const totalCards = Object.values(parsed.mainboard).reduce((acc, row) => {
      const item = row as Record<string, unknown>;
      return acc + safeInt(item.quantity);
    }, 0);
    const score = totalCards + (Object.keys(parsed.commanders).length ? 1000 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = parsed;
    }
  }

  if (!best) {
    return null;
  }

  return {
    publicId: deckId,
    name: extractDeckNameFromDom($) || deckId,
    commanders: best.commanders,
    mainboard: best.mainboard
  };
}

function parseArticleDeck(
  $: ReturnType<typeof load>,
  articleEl: ReturnType<ReturnType<typeof load>['root']>['0']
): { commanders: Record<string, unknown>; mainboard: Record<string, unknown> } | null {
  const commanders: Record<string, { quantity: number; card: { name: string } }> = {};
  const mainboard: Record<string, { quantity: number; card: { name: string } }> = {};
  let sawCard = false;

  $(articleEl)
    .find('ul')
    .each((_, ul) => {
      const label = extractSectionLabel($, ul).toLowerCase();
      if (!label) {
        return;
      }

      $(ul)
        .find('li')
        .each((__, li) => {
          const anchor = $(li).find('a[href^="/cards/"]').first();
          if (!anchor.length) {
            return;
          }

          const name = anchor.text().trim();
          if (!name) {
            return;
          }

          const qtyInput = $(li).find('input').first().attr('value');
          const quantity = Math.max(1, safeInt(qtyInput));

          const target = label.includes('commander') ? commanders : mainboard;
          if (target[name]) {
            target[name].quantity += quantity;
          } else {
            target[name] = { quantity, card: { name } };
          }
          sawCard = true;
        });
    });

  if (!sawCard || !Object.keys(mainboard).length) {
    return null;
  }

  return { commanders, mainboard };
}

function extractSectionLabel($: ReturnType<typeof load>, ul: ReturnType<ReturnType<typeof load>['root']>['0']): string {
  const firstLi = $(ul).find('li').first();
  if (!firstLi.length) {
    return '';
  }

  const value = firstLi
    .text()
    .replace(/\bChange\b/gi, ' ')
    .replace(/\(\d+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value || value.length > 60) {
    return '';
  }

  return value;
}

function extractDeckNameFromDom($: ReturnType<typeof load>): string {
  const h1 = $('h1').first().text().trim();
  if (h1) {
    return h1;
  }

  const title = $('title').first().text().trim();
  if (!title) {
    return '';
  }
  return title.split('//')[0].trim();
}

function safeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.trunc(parsed);
}
