# @socwarden/browser

Lightweight browser SDK for SOCWarden client-side context collection. Under 3KB minified.

## Installation

```bash
npm install @socwarden/browser
```

Or include via CDN (UMD):

```html
<script src="https://cdn.jsdelivr.net/npm/@socwarden/browser/dist/socwarden.min.js"></script>
```

## Modes

### Relay Mode (recommended)

Collects client context and attaches it as a `X-SOCWarden-Context` header on your app's own requests. Your server-side SDK (e.g. `@socwarden/laravel`) merges this into events automatically.

```js
import { SOCWardenBrowser } from '@socwarden/browser';

const sw = new SOCWardenBrowser({ mode: 'relay' });
sw.installRelay();
// All subsequent fetch() and XMLHttpRequest calls include the context header.
```

### Direct Mode

Sends events directly to the SOCWarden ingestor. Useful for SPAs without a backend.

```js
import { SOCWardenBrowser } from '@socwarden/browser';

const sw = new SOCWardenBrowser({
  mode: 'direct',
  apiKey: 'sw_live_xxxxxxxxxxxxxxxxxxxx',
  endpoint: 'https://ingest.socwarden.io',
});

await sw.track('auth.login.success', { user_id: '42' });
```

## Collected Context

| Field | Source |
|-------|--------|
| `timezone` | `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| `language` | `navigator.language` |
| `platform` | `navigator.platform` |
| `screen` | `screen.width` x `screen.height` |
| `viewport` | `window.innerWidth` x `window.innerHeight` |
| `color_depth` | `screen.colorDepth` |
| `cookie_enabled` | `navigator.cookieEnabled` |
| `do_not_track` | `navigator.doNotTrack === '1'` |
| `connection_type` | `navigator.connection?.effectiveType` |
| `downlink` | `navigator.connection?.downlink` |

## Custom Header Name

```js
const sw = new SOCWardenBrowser({
  mode: 'relay',
  headerName: 'X-My-Custom-Header',
});
```

## License

MIT
