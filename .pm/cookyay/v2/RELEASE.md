---
version: v2
release_tag: v2.0.0
released: 2026-06-08
status: shipped
---

# v2 — Release notes

## What shipped

Cookyay v2 is a focused maintenance release that fixes the scanner CLI's
documented invocation. The README shipped in v1 with `npx @cookyay/scanner scan
<url>` as its canonical example, but no `scan` subcommand existed — npx runs the
single `cookyay-scan` bin and forwards `scan <url>` as argv, so `parseArgs` took
the literal `scan` token as the URL and `new URL("scan")` threw `Error: "scan"
is not a valid URL`. The documented command was the broken command.

v2 makes the scanner work as documented: `parseArgs` now strips an optional
leading `scan` verb, so `npx @cookyay/scanner scan <url>` and the bare
`npx @cookyay/scanner <url>` form work identically. Docs (README.md and
docs/index.html) are reconciled — both examples now carry `--config-out`, the
`scan` verb is noted as optional with a pointer to `--help`, and a reference to a
non-existent `cookyay-scanner` bin in docs/index.html is corrected to the real
`cookyay-scan`. Three regression tests guard against the breakage recurring.
Published as `@cookyay/scanner@0.1.2` via the Changesets/OIDC CI flow.

Verified end-to-end against four live sites: cookyay.com, landonia.com,
amazon.com (315-request page), and theguardian.com (5 services classified across
3 categories with confidence annotations).

## Tasks completed

- 001 — Accept `scan` subcommand in scanner CLI
- 002 — Reconcile scanner docs with the working CLI
- 003 — Patch release of `@cookyay/scanner`

## Deviations from original goals

None — shipped exactly as scoped.

## Evidence

- Fix commit: https://github.com/landonia/cookyay/commit/56f305b (PR #3)
- Version packages commit: https://github.com/landonia/cookyay/commit/ed86b9e (PR #4)
- npm: https://www.npmjs.com/package/@cookyay/scanner/v/0.1.2
- Live smoke-test: `npx @cookyay/scanner@0.1.2 scan https://cookyay.com` → exit 0, config emitted

## Known limitations

Carrying into future versions:

- **Classifier coverage gap** — the built-in DB covers the top-20 common
  third-party service hosts (GA4, Meta Pixel, GTM, DoubleClick, etc.) but does
  not classify first-party tracker stacks (e.g. Amazon's
  `fls-na.amazon.com`/`unagi.amazon.com` telemetry, `amazon-adsystem.com`). The
  OCD entries for "Amazon" key on cookie names (`ad-id`, `ad-privacy`) that
  Amazon's own homepage doesn't set. Requires community contributions and/or
  expanded host matching to cover.
- **No automated docs accuracy test** — scanner invocation examples in README.md
  and docs/index.html have no CI coverage; a wrong command in docs won't fail any
  check. A snapshot/grep test comparing docs against the `--help` text would
  prevent the v2 bug from silently returning.
- **Node.js 20 Actions deprecation** — CI workflows use actions/checkout@v4,
  setup-node@v4, and pnpm/action-setup@v4 on Node 20, which GitHub is forcing to
  Node 24 from September 2026. Action versions should be bumped before that date.

## Research artifacts

No research personas run for v2 (scope was fully understood from a live bug
report and root-cause analysis).

## Amendments during this version

No PRD amendments were added during v2.
