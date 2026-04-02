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

function collectContext(): ClientContext {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    languages: Array.from(navigator.languages || [navigator.language]),
    touch: navigator.maxTouchPoints > 0,
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    color_depth: screen.colorDepth,
    cookie_enabled: navigator.cookieEnabled,
    do_not_track: navigator.doNotTrack === '1',
    connection_type: (navigator as any).connection?.effectiveType,
    downlink: (navigator as any).connection?.downlink,
    gpu_renderer: getGpuRenderer(),
    device_memory: (navigator as any).deviceMemory,
    cpu_cores: navigator.hardwareConcurrency,
    page_url: stripSensitiveParams(location.href),
    page_referrer: document.referrer,
    page_title: document.title,
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
    }

    this.config = config;
    this.headerName = config.headerName ?? 'X-SOCWarden-Context';
    this.ctx = collectContext();
    this.encoded = encodeContext(this.ctx);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Return the current client context snapshot. */
  collectContext(): ClientContext {
    this.ctx = collectContext();
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
