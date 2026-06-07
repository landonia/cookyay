# Cookyay

Free, self-hosted cookie consent — zero-dependency banner library.

[![npm version](https://img.shields.io/npm/v/cookyay)](https://www.npmjs.com/package/cookyay)
[![Bundle size](https://img.shields.io/badge/gzip-<20kB-brightgreen)](https://bundlephobia.com/package/cookyay)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

> **Not legal advice.** Cookyay helps implement consent UX patterns described by
> GDPR and CCPA. Whether your specific deployment is compliant is a legal question
> outside the scope of this library.

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

Pin to a minor version — never use `@latest`, which can receive breaking changes
between major versions.

### IIFE script tag

```html
<!-- In <head>, AFTER the inline bootstrap snippet (see below) -->
<script
  src="https://cdn.jsdelivr.net/npm/cookyay@0.1/dist/index.iife.js"
  integrity="sha384-REPLACE_WITH_SRI_FROM_JSDELIVR"
  crossorigin="anonymous"
  defer
></script>
```

Get the SRI hash for a specific version from the jsDelivr API:

```
https://data.jsdelivr.com/v1/packages/npm/cookyay@0.1.0/integrity
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

### 1. Add the inline bootstrap snippet to `<head>` (synchronous, < 1 KB)

This snippet must run **before** any analytics/GTM script tags. It fires
Google Consent Mode v2 defaults and arms the script intercept.

```html
<head>
  <!-- 1. Cookyay bootstrap — must be first -->
  <script>
    <!-- paste contents of dist/bootstrap.js here, or load it inline via your build tool -->
  </script>

  <!-- 2. Your analytics/GTM script tags go HERE, after the bootstrap -->
  <!-- GTM/gtag.js is loaded from Google's own CDN; SRI is not applicable to
       dynamically-versioned Google-hosted scripts. Block them via data-category
       instead (see "Declare scripts to block" below). -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"></script>

  <!-- 3. The Cookyay UI bundle (deferred) — pin to minor, always include SRI -->
  <script
    src="https://cdn.jsdelivr.net/npm/cookyay@0.1/dist/index.iife.js"
    integrity="sha384-REPLACE_WITH_SRI_FROM_JSDELIVR"
    crossorigin="anonymous"
    defer
  ></script>
</head>
```

### 2. Initialise Cookyay

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

### 3. Declare scripts to block

```html
<!-- Blocked until analytics consent is given -->
<script
  type="text/plain"
  data-category="analytics"
  src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"
></script>
```

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
npx @cookyay/scanner scan https://yoursite.com
```

Crawls your site with a headless Chromium browser and emits a ready-to-use
`cookyay.config.json` with cookies and third-party requests classified by category.

---

## SRI integrity for self-hosted files

If you copy artifacts from npm into your own CDN or repository, regenerate
SRI hashes whenever you update:

```bash
# Generate SRI hash for a local file
openssl dgst -sha384 -binary dist/index.iife.js | openssl base64 -A | sed 's/^/sha384-/'
```

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
