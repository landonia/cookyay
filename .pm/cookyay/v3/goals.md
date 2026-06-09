---
version: v3
status: planning
created: 2026-06-09
preceded_by: v2
jira_epic: ""
---

# v3 — Goals

## What ships in v3
A scanner that runs end-to-end on a clean machine. v2 fixed the `scan`
subcommand parsing, which unblocked the crawl path — and immediately exposed the
next failure: `@cookyay/scanner` depends on the `playwright` npm package, but a
fresh `npx @cookyay/scanner scan <url>` install never downloads the Chromium
browser binary. The crawl reaches `chromium.launch()` and dies with
`browserType.launch: Executable doesn't exist at .../chrome-headless-shell`,
leaking Playwright's raw "run `npx playwright install`" message through the CLI's
generic error wrapper. The documented one-liner still doesn't work on a machine
that has never run Playwright [prd.md §3.6].

v3 makes the scanner self-sufficient — it provisions its own browser on first
run:
- **Auto-install Chromium on first run.** Before the crawl, the scanner checks
  whether the required Chromium binary is present. If it isn't, it prints a clear
  one-time message (`Chromium not found — downloading (~150MB, one time)...`),
  downloads only the Chromium headless shell, then continues the scan in the same
  invocation. No separate `npx playwright install` step required.
- **Graceful messaging, not a raw stack.** If the download itself fails (offline,
  disk full, locked-down CI), the scanner surfaces a branded, actionable error
  with the manual fallback command rather than the leaked Playwright internals.
- **Idempotent and quiet on subsequent runs.** Once Chromium is present, the
  check is a fast no-op and the auto-install path produces no extra output.
- **Regression coverage.** A test asserts the missing-binary path triggers the
  install routine (and the present-binary path skips it), so this breakage can't
  silently return.
- **Docs match reality.** README and docs-site copy describe the
  zero-extra-steps first-run behavior; any stale "you must run
  `npx playwright install`" guidance is corrected.

## What's deferred from prior version
Carry-overs from v1/v2 RELEASE.md "Known limitations" — NOT in v3 scope:
- Optional consent webhook (bring-your-own storage) — TBD
- No-code snippet generator UI — TBD
- CMS plugins (WordPress first) — TBD
- Built-in banner translations (English-only) — TBD
- Auto-detection of known third-party scripts (blocking is declarative-only) — TBD

## What's new in v3
Nothing beyond the scanner browser-binary bootstrap. Like v2, v3 is a focused
maintenance/bugfix cut, not a feature milestone.

## What's deferred to later versions
All known limitations above remain deferred to a future feature version (v4+).

## Acceptance bar
- On a machine with no Playwright browsers installed,
  `npx @cookyay/scanner scan https://cookyay.com` downloads Chromium once and
  completes the crawl in the same command — no `browserType.launch: Executable
  doesn't exist` error, no manual `npx playwright install` step.
- A second run reuses the downloaded browser with no re-download and no extra
  output beyond the normal scan summary.
- If the download cannot proceed, the user sees a clear branded error naming the
  manual fallback (`npx playwright install chromium`), not a raw Playwright stack.
- A regression test covers the missing-binary → auto-install decision.
- README and docs describe the actual first-run behavior; no stale install steps.

## Context from prior version
v2 (`@cookyay/scanner@0.1.2`, shipped 2026-06-08) fixed the `scan` subcommand so
the documented invocation parses correctly, verified against four live sites from
a machine that already had Playwright browsers cached. That cache masked the
browser-provisioning gap: real users running the one-liner cold hit the missing
Chromium binary the moment the crawl starts. v3 closes that gap so the scanner is
genuinely drop-in on a fresh machine. No architecture change is expected — this
is contained to the scanner package's crawl bootstrap.
