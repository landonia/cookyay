---
version: v3
release_tag: v3.0.0
released: 2026-06-09
status: shipped
---

# v3 — Release notes

## What shipped

Cookyay v3 is a focused maintenance release that makes the CLI scanner run
end-to-end on a clean machine. v2 fixed the `scan` subcommand parsing, which
unblocked the crawl path and immediately exposed the next failure: `@cookyay/scanner`
depends on the `playwright` npm package, but a cold `npx @cookyay/scanner scan <url>`
never downloaded the Chromium binary — so the crawl reached `chromium.launch()` and
died with `browserType.launch: Executable doesn't exist at .../chrome-headless-shell`,
leaking Playwright's raw install message through the CLI's generic error wrapper.
The documented one-liner didn't work on any machine that had never run Playwright.

v3 makes the scanner self-sufficient: before launching, it checks for the required
Chromium binary and, if absent, prints a one-time notice
(`Chromium not found — downloading (~150MB, one time)...`), downloads the browser
via the package-local Playwright CLI, then continues the scan in the same
invocation — no separate `npx playwright install` step. If the download itself
fails, the scanner surfaces a branded, actionable error naming the manual fallback
(`npx playwright install chromium`) instead of a raw Playwright stack. Once the
browser is present, the check is a fast no-op. README and docs/index.html describe
the zero-extra-steps first run. Published as `@cookyay/scanner@0.1.3` via the
existing Changesets/OIDC CI flow.

Verified by a cold smoke test from a fresh, empty `PLAYWRIGHT_BROWSERS_PATH`:
`npx @cookyay/scanner@latest scan https://cookyay.com` auto-downloaded Chromium and
completed the crawl (`Pages visited: 4`, exit 0) with no launch error.

## Tasks completed

- 001 — Auto-provision Chromium on first run
- 002 — Reconcile scanner docs with first-run behavior
- 003 — Patch release of `@cookyay/scanner`

## Deviations from original goals

- **Browser download scope.** goals.md §What ships said the scanner "downloads
  only the Chromium headless shell." In practice the fix runs `playwright install
  chromium`, which fetches the full Chromium build *and* the `chrome-headless-shell`
  *and* ffmpeg. This is intentional and correct: `chromium.launch()` defaults to the
  headless shell, and the standard installer provisions both binaries together —
  splitting them out would be brittle. The goals wording was narrower than the
  actual (functionally correct) behavior.

## Evidence

- PR #5 — `fix(scanner): auto-provision Chromium on first run` (squash commit `51271b7`), merged to `main`
- PR #6 — `chore: version packages` (Changesets, commit `48f93ed`), merged to `main`
- npm — `@cookyay/scanner@0.1.3` published with provenance (`npm view @cookyay/scanner versions` → `0.1.0, 0.1.1, 0.1.2, 0.1.3`; `@latest` = 0.1.3)
- Cold smoke test — fresh `PLAYWRIGHT_BROWSERS_PATH`, `npx @cookyay/scanner@latest scan https://cookyay.com` → Chromium auto-downloaded, `Pages visited: 4`, exit 0
- PM bookkeeping — task 003 completion commit `655a55d`

## Known limitations

Carry-overs from v1/v2 (NOT addressed in v3, deferred to a future feature version):
- Optional consent webhook (bring-your-own storage) — TBD
- No-code snippet generator UI — TBD
- CMS plugins (WordPress first) — TBD
- Built-in banner translations (English-only) — TBD
- Auto-detection of known third-party scripts (blocking is declarative-only) — TBD

New in v3:
- **Noisy first-run output (cosmetic).** On the cold path, Playwright's own
  installer prints its stock "running npx playwright install without first
  installing your project's dependencies" warning box alongside the scanner's clean
  `Chromium not found — downloading...` message. The install proceeds and succeeds;
  the doubled messaging is just slightly noisy. A future tweak could suppress or
  condense the Playwright installer chatter.

## Research artifacts

None — v3 is a focused bugfix cut; no persona research was run (architecture
inherited from v2).

## Amendments during this version

None. The two PRD amendments (2026-06-06, 2026-06-07) predate v3 and were folded
in during the v1 window.
