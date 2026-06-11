# Cookyay

Free, self-hosted cookie consent — zero-dependency banner library.

[![npm version](https://img.shields.io/npm/v/cookyay)](https://www.npmjs.com/package/cookyay)
[![Bundle size](https://img.shields.io/badge/gzip-<20kB-brightgreen)](https://bundlephobia.com/package/cookyay)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

> **Not legal advice.** Cookyay helps implement consent UX patterns described by
> GDPR and CCPA. Whether your specific deployment is compliant is a legal question
> outside the scope of this library.

📖 **[Full documentation →](https://cookyay.com/)**

---

## Features

- **Zero runtime dependencies** — vanilla TypeScript, no framework required
- **< 20 KB min+gzip** — combined IIFE + inline bootstrap snippet
- **Declarative script/iframe blocking** — block analytics/marketing until consented
- **Runtime auto-block (`autoBlock: true`, v5)** — intercepts known third-party scripts/iframes at runtime from a bundled ~50-service signature database; no HTML changes needed
- **Google Consent Mode v2** — fires default + update signals automatically
- **GPC (Global Privacy Control)** — detected and honored with a visible toast
- **Consent withdrawal** — surfaces a "reload required" prompt
- **Strictest-everywhere posture** — opt-in for all visitors, no geo-detection
- **Self-hostable** — publish to npm or load from jsDelivr; no Cookyay infrastructure

---

## Install

```bash
npm install cookyay
# or
pnpm add cookyay
```

---

## CDN usage (jsDelivr)

When using SRI, pin to an **exact** version — the integrity hash is computed
from the file's bytes, so a floating tag (`@0.1`, `@latest`) would break the
moment a new release lands on that tag.

### IIFE script tag

```html
<!-- In <head>, AFTER the inline bootstrap snippet (see below) -->
<script
  src="https://cdn.jsdelivr.net/npm/cookyay@0.1.2/dist/index.iife.js"
  integrity="sha384-Q0WzaNKbd9Subp+xcy3lB6Km0asRWKdpAiiZJ9IZ1e8EjjAiTG/hUY/Efpj0LmkJ"
  crossorigin="anonymous"
  defer
></script>
```

Get the SRI hash for a specific version from the jsDelivr API:

```
https://data.jsdelivr.com/v1/packages/npm/cookyay@0.1.2/integrity
```

Or visit [jsdelivr.com/package/npm/cookyay](https://www.jsdelivr.com/package/npm/cookyay)
and select the file + version to copy the integrity hash.

### ESM via jsDelivr `/+esm`

jsDelivr does not provide a stable SRI hash for the `/+esm` transform endpoint
because it is generated on demand. Use the IIFE path with an explicit SRI hash
for production deployments where supply-chain integrity is required. The `/+esm`
path is convenient for prototyping.

```html
<script type="module">
  import Cookyay from 'https://cdn.jsdelivr.net/npm/cookyay@0.1/+esm'

  Cookyay.init({ policyVersion: '2025-01-01', categories: { /* ... */ } })
</script>
```

---

## Quick start

Cookyay uses a **two-part install**. The order is critical — getting it wrong is the
number-one breakage point.

> ⚠️ **Load-order breakage warning**
> The inline bootstrap snippet (Part 1) MUST be the very first `<script>` in `<head>`,
> before any Google Analytics, GTM, or other analytics snippets. If those scripts load
> first, Google Consent Mode v2 defaults are never registered — a silent GDPR violation
> that is invisible in the browser.

### Part 1 — Inline bootstrap snippet (synchronous, < 1 KB)

This snippet must run **before** any analytics/GTM script tags. It fires Google Consent
Mode v2 defaults (all denied), detects the GPC signal, and arms the script intercept so
blocked scripts stay inert until consent is given.

Copy the minified snippet verbatim. It is the compiled build of `dist/bootstrap.js` from
the `cookyay` package. If you need to inject it programmatically from a build tool, read
`dist/bootstrap.js` — not `INLINE_SNIPPET_JS`, which is a simpler all-denied-only snippet
that does **not** read the `cookyay_consent` cookie (returning visitors would re-see denied
Consent Mode signals until the deferred UI bundle loads).

```html
<head>
  <!-- PART 1: Cookyay bootstrap — MUST be first in <head> -->
  <script>"use strict";(()=>{function o(){return{ad_storage:"denied",analytics_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",functionality_storage:"denied",personalization_storage:"denied",security_storage:"denied",wait_for_update:500}}function i(a){let t=document.cookie.match(/(?:^|;\s*)cookyay_consent=([^;]+)/);if(t)try{let n=JSON.parse(decodeURIComponent(t[1]));if(n?.sv!==1||!n?.c||typeof n.c!="object")return;let e=n.c;e.n&&(a.functionality_storage="granted",a.security_storage="granted"),e.f&&(a.functionality_storage="granted",a.personalization_storage="granted"),e.a&&(a.analytics_storage="granted"),e.m&&(a.ad_storage="granted",a.ad_user_data="granted",a.ad_personalization="granted")}catch{}}function r(){window.__COOKYAY||(window.__COOKYAY={q:[],gpc:!1}),window.__COOKYAY.gpc=!!navigator.globalPrivacyControl,window.dataLayer||(window.dataLayer=[]),typeof window.gtag!="function"&&(window.gtag=function(){window.dataLayer.push(arguments)});let a=o();i(a),window.gtag("consent","default",a)}r();})();</script>

  <!-- Your analytics/GTM snippet goes HERE, after the bootstrap -->
  <!-- <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"></script> -->

  <!-- PART 2: Cookyay UI bundle — deferred, pin exact version + SRI -->
  <script
    src="https://cdn.jsdelivr.net/npm/cookyay@0.1.2/dist/index.iife.js"
    integrity="sha384-Q0WzaNKbd9Subp+xcy3lB6Km0asRWKdpAiiZJ9IZ1e8EjjAiTG/hUY/Efpj0LmkJ"
    crossorigin="anonymous"
    defer
  ></script>
</head>
```

> ⚠️ **Remove `<noscript>` fallback tags** — Many third-party snippets include
> `<noscript><img src="..."></noscript>` fallback tags. These bypass script blocking
> entirely and fire pixels even when JavaScript is off. Remove all such tags from
> your markup.

### Part 2 — Initialise Cookyay

```html
<script defer>
  document.addEventListener('DOMContentLoaded', function () {
    Cookyay.init({
      policyVersion: '2025-01-01',
      categories: {
        necessary: {},
        functional: {
          services: [{ name: 'Intercom', cookies: ['intercom-*'] }],
        },
        analytics: {
          services: [{ name: 'Google Analytics 4', cookies: ['_ga', '_gid'] }],
        },
        marketing: {
          services: [{ name: 'Meta Pixel', cookies: ['_fbp'] }],
        },
      },
    })
  })
</script>
```

### Declare scripts to block

Replace `type="text/javascript"` → `type="text/plain"` and add `data-category`. For iframes,
replace `src` with `data-src`.

```html
<!-- External script, blocked until analytics consent -->
<script
  type="text/plain"
  data-category="analytics"
  src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"
></script>

<!-- Blocked iframe — swap src for data-src -->
<iframe
  data-src="https://www.youtube-nocookie.com/embed/VIDEO_ID"
  data-category="marketing"
  width="560" height="315"
  title="YouTube embed"
  allowfullscreen
></iframe>
```

You now have a working consent banner + script blocking + Google Consent Mode v2 + GPC
detection. See the [full docs](https://cookyay.com/) for config reference,
string overrides, scanner usage, GTM integration, withdrawal/re-prompt, SSR reading, and
compliance limitations.

---

## ESM bundler usage

```ts
import { init, getConsent, onConsent } from 'cookyay'

init({
  policyVersion: '2025-01-01',
  categories: {
    necessary: {},
    analytics: {
      services: [{ name: 'Google Analytics 4', cookies: ['_ga'] }],
    },
  },
})

onConsent('analytics', (granted) => {
  if (granted) loadAnalytics()
})
```

---

## CLI scanner

```bash
npx @cookyay/scanner scan https://yoursite.com --config-out cookyay.config.json
```

Crawls your site with a headless Chromium browser and emits a ready-to-use
`cookyay.config.json` with cookies and third-party requests classified by category.
The `scan` subcommand is optional — `npx @cookyay/scanner https://yoursite.com`
works the same way. Run `npx @cookyay/scanner --help` for all options.

**First run:** No separate browser-install step required. On a machine that has never
run Playwright, the scanner automatically downloads the Chromium headless shell
(~150 MB, one time) before the crawl starts. Subsequent runs reuse the downloaded
binary. If the automatic download fails (offline, locked-down network, insufficient
disk space), the scanner prints a clear error and the manual fallback:
`npx playwright install chromium`.

---

## Runtime auto-block (v5)

v5 adds `autoBlock` — a single boolean config flag that lets the banner intercept
and hold known third-party scripts and iframes inert at runtime, *without* you
hand-declaring each one in your HTML.

```js
Cookyay.init({
  policyVersion: '2026-01-01',
  autoBlock: true,          // opt-in; default false
  categories: { /* ... */ },
})
```

### What it does

When `autoBlock: true`, the banner's `document.createElement`/`setAttribute`
proxy (installed in the synchronous bootstrap snippet) matches outgoing
`<script>` and `<iframe>` element insertions against a bundled signature database
of ~50 curated third-party services. Any match is held inert until the visitor
grants consent to the matching category, then re-executed using the same
grant/inject queue as declarative blocking.

Effective combinations:

- **`autoBlock: false` (default)** — declarative-only: the banner blocks exactly
  what you declare with `type="text/plain" data-category="..."`. Unchanged from
  v4. The signature database tree-shakes to zero in this mode (no bundle cost).
- **`autoBlock: true`** — declarative + runtime: declared rules are applied first
  (they always win); then any script/iframe not already declared is matched
  against the signature database and auto-blocked if a known service is
  recognised.

### The non-negotiable install requirement

> **The Cookyay bootstrap snippet MUST be the first `<script>` in `<head>`,
> before every third-party tag — GTM, GA4, or anything else.**

The bootstrap installs the `createElement`/`setAttribute` proxy synchronously.
Any `<script src>` placed in the HTML *before* the bootstrap has already been
fetched and parsed by the browser before the interceptor exists — it cannot be
blocked, silently or otherwise. This is an architectural limit of DOM-level
interception, not a bug.

If you load GTM or GA4 before the Cookyay bootstrap, `autoBlock` will have no
effect on those scripts. The only fix is load-order: Cookyay first.

This requirement already exists for Google Consent Mode v2 correctness (see
[Quickstart](https://cookyay.com/#quickstart)) — `autoBlock` adds a second,
equally hard reason to enforce it.

### Scope boundaries (v5)

`autoBlock` covers **scripts and iframes only**. These categories are explicitly
out of scope and deferred to a future version:

- **`<img>` beacon pixels** (e.g. `facebook.com/tr`) — Blocking these requires
  wrapping `HTMLImageElement.src`, which carries a higher false-positive risk for
  first-party images. Block the parent loader script instead (Meta Pixel's
  loader, for example, is in the signature database).
- **`document.write` ad injection** — Legacy ad networks (DoubleClick, old
  AdSense) use `document.write('<script src="...">')`. Intercepting
  `document.write` is possible but carries a real page-rendering breakage risk
  and is deferred.

### Google tags and Consent Mode v2

`autoBlock` does **not** DOM-block Google Tag Manager or GA4. Those services are
intentionally passed through so that Consent Mode v2 `update` signals can fire.

When Consent Mode v2 is active (the default with Cookyay's bootstrap), GTM and
GA4 already degrade gracefully under all-denied defaults — they load but collect
no data. DOM-blocking GTM would prevent the banner from sending `gtag('consent',
'update', 'granted')` signals at all, because GTM would never have loaded to
receive them.

Non-Google trackers in the signature database (Hotjar, Meta Pixel loader, Stripe,
Sentry, PostHog, Intercom, etc.) are still auto-blocked.

### Relation to the scanner's `suggestedBlocking[]`

The `@cookyay/scanner` CLI (v4+) scans your site and emits a
[`suggestedBlocking[]`](https://cookyay.com/#scanner-auto-detection) array of
copy-paste blocking snippets — one per detected third-party host.

`autoBlock` and the scanner use the same underlying signature database. The
scanner tells you what it found; `autoBlock` blocks it at runtime without the
HTML edits. They are complementary:

| Approach | HTML changes required | Works with GTM-injected tags | Notes |
|---|---|---|---|
| Declarative (v1+) | Yes — paste scanner snippets | No (GTM fires dynamically) | Most explicit; zero runtime overhead |
| `autoBlock: true` (v5) | No | Yes (intercepted at createElement) | Covers dynamic injection; Google tags excluded |

For best coverage on sites with GTM, use both: paste declarative rules from the
scanner for scripts in your static HTML, and enable `autoBlock: true` to catch
GTM-managed tags injected at runtime.

---

## SRI integrity for self-hosted files

If you copy artifacts from npm into your own CDN or repository, regenerate
SRI hashes whenever you update:

```bash
# Generate SRI hash for a local file
openssl dgst -sha384 -binary dist/index.iife.js | openssl base64 -A | sed 's/^/sha384-/'
```

---

## Compliance limitations

Cookyay stores the consent record **client-side only** (a `cookyay_consent` cookie +
localStorage). This is sufficient for the visitor's experience, but:

> **For full GDPR Art. 7 accountability, forward consent events to your own backend.**
> Client-side storage alone does not satisfy proof-of-consent obligations if you are
> audited.

Listen to the `cookyay:consent` event and POST the record to your backend:

```js
document.addEventListener('cookyay:consent', (e) => {
  // e.detail: { schemaVersion, policyVersion, timestamp, categories }
  const { schemaVersion, policyVersion, timestamp, categories } = e.detail
  fetch('/api/consent-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemaVersion, policyVersion, timestamp, categories }),
  }).catch(() => {})
})
```

A native webhook is planned for v2. The consent record schema is webhook-ready today
(timestamp, banner version, policy version, per-category choices, GPC flag).

See the [full compliance limitations section](https://cookyay.com/#compliance)
in the docs for what Cookyay does and does not cover.

---

## Release flow

Releases are managed via [Changesets](https://github.com/changesets/changesets).

Authentication uses **npm OIDC Trusted Publishing** — no long-lived npm tokens
are stored in CI. Before the first publish, configure Trusted Publisher on
npmjs.com for both packages:

1. Go to [npmjs.com](https://www.npmjs.com) → your package → **Settings** →
   **Trusted Publishers** → **Add a publisher**.
2. Fill in:
   - **Repository owner:** your GitHub username or org
   - **Repository name:** `cookyay`
   - **Workflow filename:** `release.yml`
   - **Environment:** *(leave blank)*
3. Repeat for `@cookyay/scanner`.

Then the standard Changesets workflow applies:

1. **Add a changeset** after your change:
   ```bash
   pnpm changeset
   ```
2. **Merge** — the Changesets GitHub Action opens a "Version Packages" PR.
3. **Merge the version PR** — the Action publishes to npm via OIDC Trusted
   Publishing (no long-lived npm tokens stored in CI).

First/preview releases use the `next` dist-tag:
```bash
pnpm changeset publish --tag next
```

---

## License

Apache-2.0 — see [LICENSE](LICENSE).
