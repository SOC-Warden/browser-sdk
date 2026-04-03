import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Global browser API mocks — set up before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  (globalThis as any).navigator = {
    language: 'en-US',
    languages: ['en-US', 'en'],
    maxTouchPoints: 0,
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
  (globalThis as any).location = {
    href: 'https://app.example.com/dashboard?page=1',
  };
  // Stub document.createElement so getGpuRenderer() returns undefined
  // without throwing.
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => null,
    }),
    referrer: 'https://google.com',
    title: 'My Dashboard',
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
  // D5 FIX: Test with consentLevel: 'full' to verify all fields are collected.
  // Default 'basic' only collects non-fingerprinting fields (page URL, language, etc.).
  it('collectContext returns all fields when consentLevel is full', async () => {
    const { SOCWardenBrowser } = await loadSDK();
    const sdk = new SOCWardenBrowser({
      mode: 'direct',
      apiKey: 'test-key',
      endpoint: 'https://ingest.example.com',
      consentLevel: 'full', // D5 FIX: must opt in to collect fingerprinting data
    });
    const ctx = sdk.collectContext();

    assert.strictEqual(ctx.timezone, 'America/New_York');
    assert.strictEqual(ctx.language, 'en-US');
    assert.deepStrictEqual(ctx.languages, ['en-US', 'en']);
    assert.strictEqual(ctx.touch, false);
    assert.strictEqual(ctx.platform, 'MacIntel');
    assert.strictEqual(ctx.screen, '1920x1080');
    assert.strictEqual(ctx.viewport, '1440x900');
    assert.strictEqual(ctx.color_depth, 24);
    assert.strictEqual(ctx.cookie_enabled, true);
    assert.strictEqual(ctx.do_not_track, false);
    assert.strictEqual(ctx.cpu_cores, 8);
    assert.strictEqual(ctx.page_url, 'https://app.example.com/dashboard?page=1');
    assert.strictEqual(ctx.page_referrer, 'https://google.com');
    assert.strictEqual(ctx.page_title, 'My Dashboard');
  });

  // D5 FIX: Verify that default 'basic' consent does NOT collect fingerprinting data.
  it('collectContext omits fingerprinting fields at default basic consent level', async () => {
    const { SOCWardenBrowser } = await loadSDK();
    const sdk = new SOCWardenBrowser({
      mode: 'direct',
      apiKey: 'test-key',
      endpoint: 'https://ingest.example.com',
      // no consentLevel — defaults to 'basic'
    });
    const ctx = sdk.collectContext();

    // Basic context: page URL, language, timezone, viewport should be present
    assert.strictEqual(ctx.timezone, 'America/New_York');
    assert.strictEqual(ctx.language, 'en-US');
    assert.strictEqual(ctx.viewport, '1440x900');
    assert.strictEqual(ctx.page_url, 'https://app.example.com/dashboard?page=1');
    assert.strictEqual(ctx.do_not_track, false);

    // Fingerprinting fields MUST be absent at 'basic' consent level
    assert.strictEqual(ctx.platform, '', 'platform should be empty at basic consent');
    assert.strictEqual(ctx.screen, '', 'screen should be empty at basic consent');
    assert.strictEqual(ctx.color_depth, 0, 'color_depth should be 0 at basic consent');
    assert.strictEqual(ctx.cookie_enabled, false, 'cookie_enabled should be false at basic consent');
    assert.strictEqual(ctx.cpu_cores, undefined, 'cpu_cores should be undefined at basic consent');
    assert.strictEqual(ctx.gpu_renderer, undefined, 'gpu_renderer should be undefined at basic consent');
    assert.strictEqual(ctx.device_memory, undefined, 'device_memory should be undefined at basic consent');
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

  it('relay mode track() warns and returns without throwing', async () => {
    const { SOCWardenBrowser } = await loadSDK();
    const sdk = new SOCWardenBrowser({ mode: 'relay' });

    // track() should resolve silently (no throw) in relay mode
    await sdk.track('test.event', {});
    // If we get here, it didn't throw — which is the desired behavior
    assert.ok(true, 'track() did not throw in relay mode');
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

  // IP validation note: the browser SDK's track() accepts only `event` and
  // `metadata` — there is no user-supplied `ip` parameter. The payload never
  // contains a top-level `ip` field, so no sanitization is needed here.
  it('direct mode payload never contains a top-level ip field', async () => {
    const { SOCWardenBrowser } = await loadSDK();

    let capturedBody: any = null;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return { ok: true, status: 202 };
    };

    const sdk = new SOCWardenBrowser({
      mode: 'direct',
      apiKey: 'sk_test_abc',
      endpoint: 'https://ingest.example.com',
    });

    await sdk.track('auth.login.success', { role: 'admin' });

    assert.ok(capturedBody !== null, 'fetch should have been called');
    assert.ok(!('ip' in capturedBody), 'payload must not contain a top-level ip field');
  });
});
