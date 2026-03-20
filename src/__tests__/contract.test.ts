/**
 * Cross-service contract tests verifying the Browser SDK payload
 * matches the ingestor's expected EventPayload schema.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// The ingestor's event type regex (from ingestor/internal/model/event.go).
const EVENT_TYPE_REGEX = /^[a-z][a-z0-9]{0,29}(\.[a-z][a-z0-9_]{0,29}){1,3}$/;

// Fields the ingestor's EventPayload struct accepts (POST /v1/events).
const INGESTOR_ALLOWED_FIELDS = new Set([
  'event',
  'source',
  'actor_id',
  'actor_email',
  'ip',
  'user_agent',
  'metadata',
  'timestamp',
  'context',
]);

// ---------------------------------------------------------------------------
// Browser API mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  (globalThis as any).navigator = {
    language: 'en-US',
    platform: 'MacIntel',
    cookieEnabled: true,
    doNotTrack: '0',
    hardwareConcurrency: 8,
  };
  (globalThis as any).screen = {
    width: 1920,
    height: 1080,
    colorDepth: 24,
  };
  (globalThis as any).window = {
    innerWidth: 1440,
    innerHeight: 900,
  };
  (globalThis as any).Intl = {
    DateTimeFormat: () => ({
      resolvedOptions: () => ({ timeZone: 'America/New_York' }),
    }),
  };
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => null,
    }),
  };
  (globalThis as any).btoa = (str: string) => Buffer.from(str).toString('base64');
});

async function loadSDK() {
  const modulePath = require.resolve('../index');
  delete require.cache[modulePath];
  return await import('../index');
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('Browser SDK -> Ingestor contract', () => {
  it('direct mode track() payload matches ingestor schema', async () => {
    const { SOCWardenBrowser } = await loadSDK();

    let capturedBody: Record<string, unknown> = {};
    (globalThis as any).fetch = async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return { ok: true, status: 202 };
    };

    const sdk = new SOCWardenBrowser({
      mode: 'direct',
      apiKey: 'sk_test_browser',
      endpoint: 'https://ingest.example.com',
    });

    await sdk.track('auth.login.success', { role: 'admin' });

    // Required fields
    assert.ok(capturedBody.event, 'payload must have event');
    assert.strictEqual(capturedBody.event, 'auth.login.success');
    assert.ok(
      EVENT_TYPE_REGEX.test(capturedBody.event as string),
      'event does not match ingestor regex',
    );

    assert.ok(capturedBody.source, 'payload must have source');
    assert.strictEqual(capturedBody.source, 'browser');

    // metadata must be an object
    assert.ok(capturedBody.metadata, 'payload must have metadata');
    assert.strictEqual(typeof capturedBody.metadata, 'object');
    assert.strictEqual((capturedBody.metadata as Record<string, unknown>).role, 'admin');

    // context must be present (browser context)
    assert.ok(capturedBody.context, 'payload must have context');
    const ctx = capturedBody.context as Record<string, unknown>;
    assert.strictEqual(ctx.timezone, 'America/New_York');
    assert.strictEqual(ctx.language, 'en-US');

    // timestamp must be present
    assert.ok(capturedBody.timestamp, 'payload must have timestamp');
    assert.strictEqual(typeof capturedBody.timestamp, 'string');

    // No unexpected fields
    for (const key of Object.keys(capturedBody)) {
      assert.ok(
        INGESTOR_ALLOWED_FIELDS.has(key),
        `payload contains unexpected field '${key}' not in ingestor schema`,
      );
    }
  });

  it('source is always "browser" in direct mode', async () => {
    const { SOCWardenBrowser } = await loadSDK();

    let capturedBody: Record<string, unknown> = {};
    (globalThis as any).fetch = async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return { ok: true, status: 202 };
    };

    const sdk = new SOCWardenBrowser({
      mode: 'direct',
      apiKey: 'sk_test_browser',
      endpoint: 'https://ingest.example.com',
    });

    await sdk.track('page.view');
    assert.strictEqual(capturedBody.source, 'browser');
  });

  it('event types match ingestor regex', () => {
    const events = [
      'auth.login.success',
      'auth.login.failure',
      'page.view',
      'form.submit',
      'auth.logout',
    ];
    for (const event of events) {
      assert.ok(
        EVENT_TYPE_REGEX.test(event),
        `event '${event}' does not match ingestor regex`,
      );
    }
  });

  it('minimal payload (no metadata) is schema-compliant', async () => {
    const { SOCWardenBrowser } = await loadSDK();

    let capturedBody: Record<string, unknown> = {};
    (globalThis as any).fetch = async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return { ok: true, status: 202 };
    };

    const sdk = new SOCWardenBrowser({
      mode: 'direct',
      apiKey: 'sk_test_browser',
      endpoint: 'https://ingest.example.com',
    });

    await sdk.track('auth.logout');

    assert.strictEqual(capturedBody.event, 'auth.logout');
    assert.strictEqual(capturedBody.source, 'browser');

    for (const key of Object.keys(capturedBody)) {
      assert.ok(
        INGESTOR_ALLOWED_FIELDS.has(key),
        `minimal payload contains unexpected field '${key}'`,
      );
    }
  });
});
