import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const TRACER_NAME = 'mtg-meta-analyzer';
const DEFAULT_SERVICE_NAME = 'mtg-meta-analyzer-web';
const DEFAULT_SERVICE_VERSION = '0.1.0';
const DEFAULT_OTLP_HTTP_TRACES_URL = 'http://127.0.0.1:4318/v1/traces';

type PrimitiveAttribute = string | number | boolean;
type AttributeValue = PrimitiveAttribute;

let initialized = false;
let provider: NodeTracerProvider | null = null;

export function initOpenTelemetry(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  if (!isEnabled()) {
    return;
  }

  const tracesUrl = resolveTracesUrl();
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME;
  const serviceVersion = process.env.npm_package_version?.trim() || DEFAULT_SERVICE_VERSION;

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'service.version': serviceVersion
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: tracesUrl }))]
  });
  provider.register();

  const shutdown = () => {
    if (!provider) {
      return;
    }
    void provider.shutdown().catch((error: unknown) => {
      console.error('[otel] shutdown failed', error);
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  console.info(`[otel] initialized exporter=${tracesUrl} service=${serviceName}`);
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: (span: Span) => Promise<T> | T
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return await tracer.startActiveSpan(name, async (span) => {
    applyAttributes(span, attributes);
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

function applyAttributes(span: Span, attributes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attributes)) {
    const parsed = normalizeAttribute(value);
    if (parsed === undefined) {
      continue;
    }
    span.setAttribute(key, parsed);
  }
}

function normalizeAttribute(value: unknown): AttributeValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value == null) {
    return undefined;
  }

  return String(value);
}

function isEnabled(): boolean {
  const raw = process.env.OTEL_ENABLED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveTracesUrl(): string {
  const explicit = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (explicit) {
    return explicit;
  }

  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (base) {
    return `${base.replace(/\/+$/, '')}/v1/traces`;
  }

  return DEFAULT_OTLP_HTTP_TRACES_URL;
}
