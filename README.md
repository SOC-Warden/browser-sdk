# @socwarden/browser

Lightweight browser SDK for SOCWarden client-side context collection. Under 3KB minified.

## Installation

```bash
npm install @socwarden/browser
```

Or include via CDN (UMD):

```html
<!--
  SECURITY: Always pin the version and add an integrity (SRI) hash.
  Generate the hash with: npx ssri-cli <path-to-file> --algorithms sha384
  Replace x.y.z with the exact version you have audited.
-->
<script
  src="https://cdn.jsdelivr.net/npm/@socwarden/browser@x.y.z/dist/index.mjs"
  integrity="sha384-REPLACE_WITH_ACTUAL_HASH"
  crossorigin="anonymous">
</script>
```

## Modes

### Relay Mode (recommended)

Collects client context and attaches it as a `X-SOCWarden-Context` header on your app's own requests. Your server-side SDK (e.g. `@socwarden/laravel`) merges this into events automatically.

By default the header is **only injected on same-origin requests** to prevent
context data leaking to third-party CDNs or APIs. The origin is detected
automatically from `location.origin`. Pass `relayOrigin: '*'` to opt in to
cross-origin injection (not recommended).

```js
import { SOCWardenBrowser } from '@socwarden/browser';

const sw = new SOCWardenBrowser({ mode: 'relay' });
sw.installRelay();
// All subsequent fetch() and XMLHttpRequest calls to the SAME origin include
// the context header. Cross-origin requests are untouched.
```

### Direct Mode

Sends events directly to the SOCWarden ingestor. Useful for SPAs without a backend.

```js
import { SOCWardenBrowser } from '@socwarden/browser';

const sw = new SOCWardenBrowser({
  mode: 'direct',
  apiKey: 'sw_live_xxxxxxxxxxxxxxxxxxxx',
  endpoint: 'https://ingestor.socwarden.com',
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
