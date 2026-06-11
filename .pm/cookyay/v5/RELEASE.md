---
version: v5
release_tag: v5
released: 2026-06-11
status: shipped
---

# v5 — Release notes

## What shipped
**Runtime auto-block in the banner.** Cookyay now intercepts and blocks known
third-party `<script>` and `<iframe>` loads at runtime — even when they are not
declared in the site's config — by matching them against a stripped client
subset of the v4 signature database. A site owner gets correct block-until-consent
behaviour for the ~50 curated services without hand-declaring (or scanning) every
third party first, closing the gap versus paid CMPs.

The feature is **opt-in** via a single `autoBlock` config boolean (default
`false`), so existing declarative-only installs are byte-for-byte unaffected and
the client signature DB tree-shakes to zero when it is off. Declared rules always
win over auto-detected ones. Interception uses a synchronous
`createElement`/`src`-setter proxy installed in the bootstrap (before any third
party parses); Google tags (GTM/GA4) are intentionally passed through to Consent
Mode v2 rather than DOM-blocked.

## Tasks completed
- 001 — Client signature DB codegen — emit stripped db-autoblock.generated.ts
- 002 — Client auto-block matcher — matchAutoBlock(url) → {serviceId, category}
- 003 — autoBlock config flag + validation + tree-shake-to-zero wiring
- 004 — Runtime interception proxy in bootstrap — synchronous createElement/setAttribute override
- 005 — Wire auto-detected elements into blocking.ts grant/inject queue
- 006 — Hermetic e2e auto-block fixture + spec
- 007 — Scanner↔banner parity test — matcher agrees with scanner verdict
- 008 — Bundle-budget gate — size-limit covers autoBlock-enabled bundle
- 009 — Docs — README + comparison page for runtime auto-block

## Deviations from original goals
None. v5 shipped exactly as scoped in `goals.md`: scripts + iframes only,
single-signal `medium` threshold, skip-Google, opt-in `autoBlock` flag with
tree-shake-to-zero, codegen-inlined client DB, declared-wins precedence, parity
test, bundle-budget gate, and docs.

## Evidence
- Commit `27e741e` — feat(cookyay): v5 runtime auto-block of third-party scripts
- Branch `feat/v4-auto-detection` (pushed to origin)
- Gates green at release: typecheck, build, lint, `pnpm size` (autoBlock-on ESM
  bundle 14.33 KB gzip, IIFE 12.05 KB, bootstrap 493 B — all under the 20 KB
  budget; autoBlock-off main 12 KB with DB tree-shaken out), 815 vitest +
  23 browser-mode + 77 Playwright e2e tests (incl. 11 auto-block lifecycle cases).

## Known limitations
Carrying into v6 planning:
- **`<img>` beacon pixels and `document.write` legacy injection are not
  auto-blocked** (deferred — higher page-breakage risk, narrower payoff). Meta
  Pixel's `facebook.com/tr` beacon is the canonical case.
- **Bootstrap-first install requirement.** Any `<script src>` placed in the HTML
  *before* the Cookyay bootstrap cannot be blocked — "Cookyay first in `<head>`"
  is a hard install requirement and an acceptance-test invariant.
- **Google tags pass through.** GTM/GA4 are intentionally not DOM-blocked; they
  rely on Consent Mode v2 denied-by-default degradation instead (DOM-blocking GTM
  would suppress all CM v2 `update` signals).

## Research artifacts
- [Research index](research/_index.md) — 4 persona reports

## Amendments during this version
None recorded in `prd.md` within the v5 window. (v5 architecture decisions of
2026-06-10 are captured in `v5/architecture.md §Amendments`, not the PRD.)
