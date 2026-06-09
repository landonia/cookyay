---
id: 002
title: Reconcile scanner docs with the working CLI
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001"]
complexity: 1
prd_refs:
  - "prd.md §3.6"
  - "goals.md §Acceptance bar"
arch_refs: []
test_refs: []
research_refs: []
acceptance_criteria:
  - "README scanner example shows an invocation form that actually runs end-to-end"
  - "The example produces the `cookyay.config.json` the surrounding text describes (i.e. includes `--config-out`)"
  - "Docs note that the `scan` verb is optional and point to `--help` for full options"
  - "No remaining docs reference a broken/non-existent invocation form"
created: 2026-06-08
---

## Task
README.md:209 told users to run `npx @cookyay/scanner scan https://yoursite.com`
— the exact command that failed before task 001 — and the example didn't even
include `--config-out`, so it never emitted the `cookyay.config.json` the
surrounding prose promised. Update the docs so the published command both runs
and does what the text says.

## Implementation notes
- `README.md` "## CLI scanner" section: add `--config-out cookyay.config.json`
  to the example; note the `scan` verb is optional (bare `npx @cookyay/scanner
  <url>` works) and point to `npx @cookyay/scanner --help`.
- Grep for other docs/HTML referencing the scanner invocation
  (`grep -rn 'scanner scan\|cookyay-scan'`) — currently only README has the
  user-facing command; keep them consistent if more appear.

## Out of scope
- Rewriting the scanner usage/help text in `index.ts` beyond what task 001
  touches.
- Docs-site restructuring unrelated to the scanner command.

## Verifier notes — 2026-06-08 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** README is fixed, but `docs/index.html` (the docs-site scanner section) still ships both defects this task exists to remove — an example that promises a config file it doesn't write, and a non-existent global bin name.

**What needs to change:**
1. `docs/index.html:630` — `npx @cookyay/scanner scan https://yoursite.com` has the comment "# Scan a site and write cookyay.config.json" but no `--config-out`, so it never writes the file. This is the exact defect AC2/AC4 call out. Add `--config-out cookyay.config.json` (mirror README.md:209), e.g. `npx @cookyay/scanner scan https://yoursite.com --config-out cookyay.config.json`.
2. `docs/index.html:634` — `cookyay-scanner scan https://yoursite.com` references a bin that does not exist. The published bin is `cookyay-scan` (see `packages/scanner/package.json:17` and the `--help` text `index.ts:7`). Fix to `cookyay-scan scan https://yoursite.com --config-out cookyay.config.json` (with `--config-out` per item 1). This is a broken/non-existent invocation form — AC4 fails until it's gone.
3. The docs-site scanner section never tells users the `scan` verb is optional or points to `--help` (AC3). Add a one-line note mirroring README.md:214-215, e.g. that the bare `npx @cookyay/scanner <url>` form works too and `npx @cookyay/scanner --help` lists all options.
4. The task's own Implementation notes required `grep -rn 'scanner scan\|cookyay-scan'` and "keep them consistent if more appear" — `docs/index.html` appeared and was not reconciled. goals.md "What ships in v2" is explicit: "README **and any docs-site copy** use one invocation form that actually runs." Reconciling `docs/index.html`'s scanner command is in scope; it is not the "docs-site restructuring" the Out-of-scope clause excludes.

**Acceptance criteria check:**
- [x] README scanner example shows an invocation form that actually runs end-to-end — README.md:209 now uses `scan <url> --config-out ...`, valid after task 001.
- [ ] Example produces the `cookyay.config.json` the prose describes (includes `--config-out`) — true for README.md:209, but `docs/index.html:630` promises the file in its comment yet omits `--config-out`, so it does not.
- [ ] Docs note `scan` is optional and point to `--help` — done in README.md:214-215; absent from `docs/index.html`.
- [ ] No remaining docs reference a broken/non-existent invocation form — FAILS: `docs/index.html:634` invokes `cookyay-scanner` (no such bin; actual is `cookyay-scan`), and `docs/index.html:630` is the no-`--config-out` form.

**Tests:** n/a for this docs task (the scanner unit suite belongs to task 001, already accepted). No automated check covers docs accuracy.

**Notes for next executor:** Only `docs/index.html` lines ~628-634 need editing; the README work is correct and should not be touched. Match README.md:209/214-215 wording. Re-run `grep -rn 'scanner scan\|cookyay-scan\|cookyay-scanner' README.md docs/` afterward and confirm every hit uses the real `cookyay-scan` bin / `@cookyay/scanner` package name with `--config-out` where a config file is promised. Do not commit or push.

## Re-execution notes — 2026-06-08
**Addressed all three verifier gaps in `docs/index.html`:**
1. `docs/index.html:630` — Added `--config-out cookyay.config.json` to the `npx @cookyay/scanner scan` example (AC2/AC4).
2. `docs/index.html:634` — Replaced non-existent `cookyay-scanner` bin with the real `cookyay-scan` bin, plus added `--config-out` (AC4).
3. Added a `<p>` note after the code block mirroring README.md:214-215 stating `scan` is optional and pointing to `--help` (AC3).

Post-fix grep confirms no remaining references to `cookyay-scanner` or missing `--config-out` in either README.md or docs/index.html.

## Implementation summary
**Files changed:**
- `docs/index.html` — Fixed scanner usage section (lines 628-639): added `--config-out cookyay.config.json` to both `npx` and global-install examples; corrected bin name from `cookyay-scanner` (non-existent) to `cookyay-scan`; added paragraph noting the `scan` subcommand is optional and pointing to `--help`.

**Acceptance criteria check:**
- [x] README scanner example shows an invocation form that actually runs end-to-end — README.md:209 (unchanged, correct from prior execution).
- [x] The example produces the `cookyay.config.json` the surrounding text describes (includes `--config-out`) — docs/index.html:630 and README.md:209 both include `--config-out cookyay.config.json`.
- [x] Docs note that the `scan` verb is optional and point to `--help` for full options — README.md:214-215 and docs/index.html:636-639.
- [x] No remaining docs reference a broken/non-existent invocation form — grep confirms `cookyay-scanner` is gone; every command uses `cookyay-scan` or `@cookyay/scanner` with `--config-out` where a config file is promised.

**Tests:** n/a (docs-only change; no automated check covers docs accuracy per prior verifier).

**Notes for verifier:** Only `docs/index.html` was changed. Run `grep -rn 'scanner scan\|cookyay-scan\|cookyay-scanner\|config-out' README.md docs/` to confirm every hit is correct. README.md was not touched.

## Verifier notes — 2026-06-08 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All three prior-rejection gaps in `docs/index.html` are fixed: both examples now carry `--config-out cookyay.config.json`, the non-existent `cookyay-scanner` bin is replaced by the real `cookyay-scan` (matches `packages/scanner/package.json:17`), and an optional-`scan`/`--help` note mirrors README.md:214-215. Grep confirms no broken invocation forms remain.
**Acceptance criteria check:**
- [x] README scanner example runs end-to-end — README.md:209 uses `scan <url> --config-out ...`; `scan` is stripped at `index.ts:48` and `--url` parses, valid after task 001.
- [x] Example produces the `cookyay.config.json` the prose describes (includes `--config-out`) — docs/index.html:630,634 and README.md:209 all include `--config-out cookyay.config.json`; `--config-out` is a real flag (`index.ts:71`, writes file at `:138`).
- [x] Docs note `scan` is optional and point to `--help` — docs/index.html:636-639 mirrors README.md:214-215.
- [x] No remaining docs reference a broken/non-existent invocation form — `grep -rn 'scanner scan|cookyay-scan|cookyay-scanner|config-out' README.md docs/` shows `cookyay-scanner` gone; every command uses `cookyay-scan` (the published bin) or `@cookyay/scanner` with `--config-out`. compare.html hits are prose-only package mentions; dogfood-report.md uses the valid bare form.
**Tests:** n/a (docs-only change; scanner unit suite belongs to task 001, already accepted). Scope held — only the `docs/index.html` scanner section was touched, no docs-site restructuring.
