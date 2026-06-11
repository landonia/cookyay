# Changelog

## v4.0.0 — 2026-06-10

Cookyay v4 delivers scanner-side auto-detection of known third-party scripts — the biggest remaining feature gap versus paid CMPs. The scanner now identifies which third-party services are present on a site, classifies them with a two-signal confidence model, and emits copy-paste-ready block declarations into the generated config, so site owners paste rather than hand-author. The release ships a contributable `data/services.yaml` signature database (~50 curated services, up from 20) with a codegen pipeline and CI validator, path-level matching for services sharing a host, host-deduped `suggestedBlocking[]` output with paste-ready script/iframe snippets, a generated `service-fingerprints.json` artifact, five false-positive signature fixes, hermetic detection-path test coverage with a second golden config and e2e spec, and updated docs covering the auto-detect workflow and reCAPTCHA functional-gating.

## v3.0.0 — 2026-06-09

Cookyay v3 makes the CLI scanner run end-to-end on a clean machine. After v2 fixed the `scan` subcommand, a cold `npx @cookyay/scanner scan <url>` still failed with `browserType.launch: Executable doesn't exist` because the `playwright` package was installed but its Chromium binary was never downloaded. The scanner now detects the missing browser before launching, prints a one-time `Chromium not found — downloading (~150MB, one time)...` notice, downloads it via the package-local Playwright CLI, and continues the scan — no separate `npx playwright install` step. Download failures surface a branded, actionable error instead of a raw Playwright stack. Published as `@cookyay/scanner@0.1.3` and verified by a cold smoke test from an empty browser cache (`Pages visited: 4`, exit 0).

## v2.0.0 — 2026-06-08

Cookyay v2 fixes the scanner CLI's documented invocation: `npx @cookyay/scanner scan <url>` — the command shown in the README — previously threw `Error: "scan" is not a valid URL`. The `scan` verb is now accepted as an optional subcommand, the bare `npx @cookyay/scanner <url>` form is unchanged, and docs are reconciled with `--config-out` examples, a corrected bin name (`cookyay-scanner` → `cookyay-scan`), and an optional-verb note. Published as `@cookyay/scanner@0.1.2`. Verified end-to-end against four live sites including theguardian.com (5 services classified with confidence annotations).

## v1.0.0 — 2026-06-07

Cookyay v1.0.0 ships the complete free, self-hosted cookie consent stack: a drop-in banner and script-blocking engine (< 20 KB min+gzip), Google Consent Mode v2 integration, GPC honoring with explicit post-GPC consent records, a CLI Playwright-based cookie scanner, accessibility CI, and full npm/CDN distribution via Changesets. All 21 planned tasks shipped with no scope deviations. Live in production at https://landonia.com/cookyay/ with a passing VoiceOver smoke test and scanner-verified dogfood report.
