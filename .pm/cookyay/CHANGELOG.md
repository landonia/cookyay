# Changelog

## v2.0.0 — 2026-06-08

Cookyay v2 fixes the scanner CLI's documented invocation: `npx @cookyay/scanner scan <url>` — the command shown in the README — previously threw `Error: "scan" is not a valid URL`. The `scan` verb is now accepted as an optional subcommand, the bare `npx @cookyay/scanner <url>` form is unchanged, and docs are reconciled with `--config-out` examples, a corrected bin name (`cookyay-scanner` → `cookyay-scan`), and an optional-verb note. Published as `@cookyay/scanner@0.1.2`. Verified end-to-end against four live sites including theguardian.com (5 services classified with confidence annotations).

## v1.0.0 — 2026-06-07

Cookyay v1.0.0 ships the complete free, self-hosted cookie consent stack: a drop-in banner and script-blocking engine (< 20 KB min+gzip), Google Consent Mode v2 integration, GPC honoring with explicit post-GPC consent records, a CLI Playwright-based cookie scanner, accessibility CI, and full npm/CDN distribution via Changesets. All 21 planned tasks shipped with no scope deviations. Live in production at https://landonia.com/cookyay/ with a passing VoiceOver smoke test and scanner-verified dogfood report.
