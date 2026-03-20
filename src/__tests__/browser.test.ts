import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Global browser API mocks — set up before each test
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
  // Stub document.createElement so getGpuRenderer() returns undefined
  // without throwing.
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => null,
    }),
  };
  // Stub btoa for base64 encoding used internally by the SDK.
  (globalThis as any).btoa = (str: string) => Buffer.from(str).toString('base64');
});

// Dynamically import the SDK after mocks are in place. We use a helper
// that re-imports on each call so the constructor runs with fresh mocks.
async function loadSDK() {
  // Bust the module cache so collectContext() picks up current globals.
  const modulePath = require.resolve('../index');
  delete require.cache[modulePath];
  return await import('../index');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SOCWardenBrowser', () => {
  it('collectContext returns all fields', async () => {
    const { SOCWardenBrowser } = await loadSDK();
    const sdk = new SOCWardenBrowser({
      mode: 'direct',
      apiKey: 'test-key',
      endpoint: 'https://ingest.example.com',
    });
    const ctx = sdk.collectContext();

    assert.strictEqual(ctx.timezone, 'America/New_York');
    assert.strictEqual(ctx.language, 'en-US');
    assert.strictEqual(ctx.platform, 'MacIntel');
    assert.strictEqual(ctx.screen, '1920x1080');
    assert.strictEqual(ctx.viewport, '1440x900');
    assert.strictEqual(ctx.color_depth, 24);
    assert.strictEqual(ctx.cookie_enabled, true);
    assert.strictEqual(ctx.do_not_track, false);
    assert.strictEqual(ctx.cpu_cores, 8);
  });

  it('direct mode payload has correct shape', async () => {
    const { SOCWardenBrowser } = await loadSDK();

    // Capture the fetch call
    let capturedUrl = '';
    let capturedInit: any = {};
    (globalThis as any).fetch = async (url: string, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 202 };
    };

    const sdk = new SOCWardenBrowser({
      mode: 'direct',
      apiKey: 'sk_test_abc',
      endpoint: 'https://ingest.example.com',
    });

    await sdk.track('test.event.fired', { key: 'val' });

    assert.strictEqual(capturedUrl, 'https://ingest.example.com/v1/events');
    assert.strictEqual(capturedInit.method, 'POST');

    const headers = capturedInit.headers;
    assert.strictEqual(headers['Content-Type'], 'application/json');
    assert.strictEqual(headers['Authorization'], 'Bearer sk_test_abc');

    const body = JSON.parse(capturedInit.body);
    assert.strictEqual(body.event, 'test.event.fired');
    assert.strictEqual(body.source, 'browser');
    assert.deepStrictEqual(body.metadata, { key: 'val' });
    assert.ok(body.context, 'body should include context');
    assert.ok(body.timestamp, 'body should include timestamp');
  });

  it('relay mode throws on track()', async () => {
    const { SOCWardenBrowser } = await loadSDK();
    const sdk = new SOCWardenBrowser({ mode: 'relay' });

    await assert.rejects(
      () => sdk.track('test.event', {}),
      (err: Error) => {
        assert.ok(
          err.message.includes('track() is only available in direct mode'),
          `unexpected error message: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('config validation — direct mode without apiKey throws', async () => {
    const { SOCWardenBrowser } = await loadSDK();

    assert.throws(
      () => new SOCWardenBrowser({ mode: 'direct', endpoint: 'https://ingest.example.com' }),
      (err: Error) => {
        assert.ok(
          err.message.includes('apiKey is required'),
          `unexpected error message: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('config validation — direct mode without endpoint throws', async () => {
    const { SOCWardenBrowser } = await loadSDK();

    assert.throws(
      () => new SOCWardenBrowser({ mode: 'direct', apiKey: 'sk_test' }),
      (err: Error) => {
        assert.ok(
          err.message.includes('endpoint is required'),
          `unexpected error message: ${err.message}`,
        );
        return true;
      },
    );
  });
});
