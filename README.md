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
