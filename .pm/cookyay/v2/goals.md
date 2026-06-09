---
version: v2
status: shipped
created: 2026-06-08
preceded_by: v1
jira_epic: ""
---

# v2 — Goals

## What ships in v2
A working, idiomatic CLI scanner invocation. v1 shipped a scanner whose only
accepted form is `cookyay-scan <url>` (npx: `npx @cookyay/scanner <url>`), but
the README documents `npx @cookyay/scanner scan <url>` — a `scan` subcommand
that does not exist. When invoked that way, npx runs the single `cookyay-scan`
bin and passes `scan <url>` through; `parseArgs` treats the literal `scan` as
the URL and the run dies with `Error: "scan" is not a valid URL.` The
documented command is the broken command [prd.md §3.6].

v2 makes the scanner work the way it's documented and the way users naturally
type it:
- **CLI accepts a `scan` subcommand.** `npx @cookyay/scanner scan <url>` and the
  bare `npx @cookyay/scanner <url>` both work. The `scan` verb is recognized and
  stripped before URL parsing; any other leading non-flag token is still treated
  as the URL (back-compat preserved).
- **Docs match the binary.** README and any docs-site copy use one invocation
  form that actually runs.
- **Regression coverage.** A unit test asserts `scan <url>` parses to the same
  args as bare `<url>`, so this specific breakage can't silently return.

## What's deferred from prior version
Carry-overs from v1 RELEASE.md "Known limitations" — NOT in v2 scope:
- Optional consent webhook (bring-your-own storage) — TBD
- No-code snippet generator UI — TBD
- CMS plugins (WordPress first) — TBD
- Built-in banner translations (v1 is English-only) — TBD
- Auto-detection of known third-party scripts (v1 blocking is declarative-only) — TBD

## What's new in v2
Nothing beyond the scanner-invocation fix. v2 is a focused maintenance/bugfix
cut, not a feature milestone.

## What's deferred to later versions
All v1 known limitations above remain deferred to a future feature version (v3+).

## Acceptance bar
- `npx @cookyay/scanner scan https://cookyay.com` runs the crawl (no
  `"scan" is not a valid URL` error) — verified against a real site.
- `npx @cookyay/scanner https://cookyay.com` (bare form) still works unchanged.
- README and docs show only invocation forms that succeed.
- A unit test covers `scan <url>` ⇒ same parsed args as `<url>`; full scanner
  unit + e2e suites stay green.
- A patch release of `@cookyay/scanner` is published with the fix.

## Context from prior version
v1.0.0 shipped 2026-06-07 — the full CMP suite (banner, declarative script
blocking, Consent Mode v2, client-side record, CLI scanner, npm/CDN
distribution, comparison page), all 22 tasks done, deployed in production at
landonia.com/cookyay. The scanner's bin/npx path was a repeated trouble spot
during v1 (task 015 went through three rounds fixing an ESM entry-guard that
silently no-op'd symlinked/npx invocation). This v2 bug is the next layer of
the same surface: the bin now runs, but it doesn't accept the documented `scan`
subcommand, and the docs were never reconciled with the actual `cookyay-scan
<url>` shape. Lesson carried forward: the scanner's CLI contract needs a test
that exercises the exact invocation string the docs publish.
