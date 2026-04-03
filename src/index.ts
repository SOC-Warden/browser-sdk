/**
 * SOCWarden Browser SDK
 *
 * Lightweight client-side context collection (<3KB minified).
 * Two modes:
 *   - relay:  Collects context and injects it as X-SOCWarden-Context header
 *             on the app's own fetch/XHR requests. Server-side SDK merges it.
 *   - direct: Sends events straight to the SOCWarden ingestor (for SPAs).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SOCWardenBrowserConfig {
  /** Operating mode. */
  mode: 'relay' | 'direct';
  /** API key — required for direct mode. */
  apiKey?: string;
  /** Ingestor endpoint URL — required for direct mode. */
  endpoint?: string;
  /** Header name used in relay mode. Default: X-SOCWarden-Context */
  headerName?: string;
  /**
   * D5 FIX (GDPR): Controls how much device data is collected.
   *
   * - 'none'  — collect nothing (SDK is effectively disabled for context).
   * - 'basic' — collect only page URL, referrer, browser language, viewport size.
   *             No fingerprinting data. **Default.**
   * - 'full'  — collect all data including WebGL GPU renderer, hardware
   *             concurrency, device memory, and screen resolution.
   *             Only use with explicit user consent.
   */
  consentLevel?: 'none' | 'basic' | 'full';
}

export interface ClientContext {
  timezone: string;
  language: string;
  languages: string[];
  touch: boolean;
  platform: string;
  screen: string;
  viewport: string;
  color_depth: number;
  cookie_enabled: boolean;
  do_not_track: boolean;
  connection_type: string | undefined;
  downlink: number | undefined;
  gpu_renderer: string | undefined;
  device_memory: number | undefined;
  cpu_cores: number | undefined;
  page_url: string;
  page_referrer: string;
  page_title: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGpuRenderer(): string | undefined {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl && gl instanceof WebGLRenderingContext) {
      const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugExt) {
        return gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) as string;
      }
    }
  } catch {
    // WebGL not available — return undefined
  }
  return undefined;
}

// D3 FIX: Event type validation regex — matches the ingestor's required format.
const EVENT_TYPE_REGEX = /^[a-z][a-z0-9]{0,29}(\.[a-z][a-z0-9_]{0,29}){1,3}$/;

function stripSensitiveParams(url: string): string {
  try {
    const u = new URL(url);
    const sensitive = ['token', 'key', 'password', 'secret', 'code', 'api_key', 'apikey', 'access_token', 'refresh_token'];
    for (const param of sensitive) {
      if (u.searchParams.has(param)) {
        u.searchParams.set(param, '[REDACTED]');
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * D5 FIX (GDPR): Collect context data according to the consent level.
 *
 * 'basic' (default): page URL, referrer, language, viewport — no fingerprinting.
 * 'full': all fields including WebGL renderer, hardware concurrency, device memory.
 */
function collectContext(consentLevel: 'none' | 'basic' | 'full' = 'basic'): ClientContext {
  // 'none' — return empty context (no data collection).
  if (consentLevel === 'none') {
    return {
      timezone: '',
      language: '',
      languages: [],
      touch: false,
      platform: '',
      screen: '',
      viewport: '',
      color_depth: 0,
      cookie_enabled: false,
      do_not_track: false,
      connection_type: undefined,
      downlink: undefined,
      gpu_renderer: undefined,
      device_memory: undefined,
      cpu_cores: undefined,
      page_url: '',
      page_referrer: '',
      page_title: '',
    };
  }

  // 'basic': collect non-fingerprinting data only.
  const basic: ClientContext = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    languages: Array.from(navigator.languages || [navigator.language]),
    touch: false,
    platform: '',
    screen: '',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    color_depth: 0,
    cookie_enabled: false,
    do_not_track: navigator.doNotTrack === '1',
    connection_type: undefined,
    downlink: undefined,
    // D5 FIX: fingerprinting fields omitted at 'basic' consent level.
    gpu_renderer: undefined,
    device_memory: undefined,
    cpu_cores: undefined,
    page_url: stripSensitiveParams(location.href),
    page_referrer: document.referrer,
    page_title: document.title,
  };

  if (consentLevel !== 'full') {
    return basic;
  }

  // 'full': collect all fields including fingerprinting data (requires consent).
  return {
    ...basic,
    touch: navigator.maxTouchPoints > 0,
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
    color_depth: screen.colorDepth,
    cookie_enabled: navigator.cookieEnabled,
    connection_type: (navigator as any).connection?.effectiveType,
    downlink: (navigator as any).connection?.downlink,
    gpu_renderer: getGpuRenderer(),
    device_memory: (navigator as any).deviceMemory,
    cpu_cores: navigator.hardwareConcurrency,
  };
}

function encodeContext(ctx: ClientContext): string {
  return btoa(JSON.stringify(ctx));
}

// ---------------------------------------------------------------------------
// SDK class
// ---------------------------------------------------------------------------

export class SOCWardenBrowser {
  private readonly config: SOCWardenBrowserConfig;
  private readonly headerName: string;
  private ctx: ClientContext;
  private encoded: string;
  private _backedOff = false;
  private _backoffTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SOCWardenBrowserConfig) {
    if (config.mode === 'direct') {
      if (!config.apiKey) throw new Error('SOCWarden: apiKey is required in direct mode');
      if (!config.endpoint) throw new Error('SOCWarden: endpoint is required in direct mode');

      // D2 FIX: Enforce HTTPS to prevent API key transmission in cleartext.
      if (config.endpoint && !config.endpoint.startsWith('https://')) {
        // In browsers there is no "NODE_ENV production" equivalent; always warn.
        // Throw in non-localhost contexts where cleartext is dangerous.
        const isLocalhost = config.endpoint.startsWith('http://localhost') ||
          config.endpoint.startsWith('http://127.0.0.1');
        if (!isLocalhost) {
          throw new Error('SOCWarden: endpoint must use HTTPS. API keys must not be transmitted in cleartext.');
        }
        console.warn('[SOCWarden] WARNING: Endpoint is using HTTP. API keys will be transmitted in cleartext.');
      }
    }

    this.config = config;
    this.headerName = config.headerName ?? 'X-SOCWarden-Context';
    // D5 FIX: Default consentLevel is 'basic' — no fingerprinting without consent.
    this.ctx = collectContext(config.consentLevel ?? 'basic');
    this.encoded = encodeContext(this.ctx);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Return the current client context snapshot (respects configured consentLevel). */
  collectContext(): ClientContext {
    // D5 FIX: Respect configured consentLevel when refreshing context.
    this.ctx = collectContext(this.config.consentLevel ?? 'basic');
    this.encoded = encodeContext(this.ctx);
    return this.ctx;
  }

  /**
   * Relay mode — monkey-patch `fetch` and `XMLHttpRequest` so that every
   * outgoing request automatically carries the context header.
   */
  installRelay(): void {
    const headerName = this.headerName;
    const getEncoded = () => this.encoded;

    // --- Patch fetch ---
    const originalFetch = window.fetch;
    window.fetch = function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      init = init ?? {};
      const headers = new Headers(init.headers);
      if (!headers.has(headerName)) {
        headers.set(headerName, getEncoded());
      }
      init.headers = headers;
      return originalFetch.call(window, input, init);
    };

    // --- Patch XMLHttpRequest ---
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: any[]) {
      (this as any).__socwardenPatched = false;
      return originalOpen.apply(this, args as any);
    };

    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: any[]) {
      if (!(this as any).__socwardenPatched) {
        try {
          this.setRequestHeader(headerName, getEncoded());
        } catch (_) {
          // header already set or state invalid — skip silently
        }
        (this as any).__socwardenPatched = true;
      }
      return originalSend.apply(this, args as any);
    };
  }

  /**
   * Direct mode — POST an event to the SOCWarden ingestor.
   * Never throws — errors are silently logged via console.warn.
   *
   * @param event  Event type, e.g. "auth.login.success"
   * @param metadata  Arbitrary key-value metadata to attach
   */
  async track(event: string, metadata?: Record<string, any>): Promise<void> {
    if (this.config.mode !== 'direct') {
      console.warn('SOCWarden: track() is only available in direct mode');
      return;
    }

    // D3 FIX: Validate event type format before sending.
    if (!EVENT_TYPE_REGEX.test(event)) {
      console.warn(`[SOCWarden] Invalid event type format, dropping event: "${event}". ` +
        'Event types must match ^[a-z][a-z0-9]{0,29}(\\.[a-z][a-z0-9_]{0,29}){1,3}$');
      return;
    }

    if (this._backedOff) {
      console.warn('SOCWarden: rate-limited, skipping event');
      return;
    }

    try {
      const endpoint = this.config.endpoint!.replace(/\/+$/, '');

      const body = {
        event: event,
        source: 'browser',
        metadata: metadata ?? {},
        context: this.ctx,
        timestamp: new Date().toISOString(),
      };

      const res = await fetch(`${endpoint}/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        keepalive: true,
      });

      if (res.status === 429) {
        this._backedOff = true;
        const retryAfter = res.headers?.get?.('Retry-After');
        let delaySec = 60;
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed) && parsed > 0) {
            delaySec = Math.min(parsed, 300);
          }
        }
        this._backoffTimer = setTimeout(() => {
          this._backedOff = false;
          this._backoffTimer = null;
        }, delaySec * 1000);
        console.warn(`SOCWarden: rate-limited, backing off for ${delaySec}s`);
        return;
      }

      if (!res.ok && res.status !== 202) {
        console.warn(`SOCWarden: ingestor responded with ${res.status}`);
        return;
      }
    } catch (err) {
      console.warn('SOCWarden: failed to send event', err);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Default export for UMD convenience
// ---------------------------------------------------------------------------

export default SOCWardenBrowser;
