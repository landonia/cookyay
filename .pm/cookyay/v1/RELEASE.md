---
version: v1
release_tag: v1.0.0
released: 2026-06-07
status: shipped
---

# v1 — Release notes

## What shipped

Cookyay v1.0.0 is a free, self-hosted cookie consent manager covering every goal
in the v1 PRD: a drop-in banner + script blocking engine, Google Consent Mode v2
integration, a CLI cookie scanner, and an npm/CDN distribution — all under 20 KB
min+gzip. A new site can go from zero to a compliant, accessible banner with
script blocking and Consent Mode v2 in under 15 minutes. The build is live in
production at https://landonia.com/cookyay/ and the full suite — 21 tasks — shipped
with no deviations from the original scope.

## Tasks completed

- 001 — Scaffold pnpm monorepo + tooling
- 002 — CI foundation + size-limit gate
- 003 — Consent state core (record, cookie, localStorage)
- 004 — Sync bootstrap script (<1KB)
- 005 — Declarative blocking + re-execution engine
- 006 — Config schema + public JS API
- 007 — Banner UI (first layer, non-modal default)
- 008 — Preferences modal (focus trap, switches)
- 009 — GPC honoring + confirmation toast
- 010 — Google Consent Mode v2 integration
- 011 — Withdrawal + re-prompt flows
- 012 — Hermetic fixture site + service fingerprints
- 013 — Playwright E2E suite (blocking + flows)
- 014 — Accessibility CI (axe + keyboard + equal-prominence)
- 015 — Scanner: Playwright crawler core
- 016 — Scanner: classification + config emit
- 017 — npm packaging + Changesets release flow
- 018 — Docs site + README quickstart (15-min bar)
- 019 — Comparison page (§3.8)
- 020 — Production dogfood + manual real-site scan
- 021 — Persist explicit post-GPC consent choices (GPC-acknowledged records)

## Deviations from original goals

None — shipped exactly as scoped.

## Evidence

- Production deployment: https://landonia.com/cookyay/ (GitHub Pages, custom domain, loads `cookyay@0.1.1` via jsDelivr)
- Dogfood report (scanner run + VoiceOver results): `docs/dogfood-report.md`
- Scanner artifacts: `docs/dogfood-scanner-config.json`, `docs/dogfood-scanner-raw.json`

## Known limitations

Deferred to future versions per original planning:

- Optional consent webhook (bring-your-own storage)
- No-code snippet generator UI
- CMS plugins (WordPress first)
- Built-in banner translations (v1 is English-only)

## Research artifacts

- [Research index](research/_index.md) — 7 persona reports (accessibility specialist,
  compliance & legal, domain expert CMP, integration engineer, performance engineer,
  test strategist, UX researcher)

## Amendments during this version

None.
