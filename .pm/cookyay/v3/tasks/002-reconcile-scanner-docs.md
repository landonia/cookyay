---
id: 002
title: Reconcile scanner docs with first-run behavior
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001"]
complexity: 2
prd_refs:
  - "prd.md §3.6"
  - "goals.md §Acceptance bar"
arch_refs:
  - "architecture.md §9 Environments & deployment"
test_refs: []
research_refs: []
acceptance_criteria:
  - "README scanner section describes the actual first-run behavior: the first scan auto-downloads Chromium once, no separate install step required"
  - "docs/index.html scanner section matches the README (auto-download on first run; ~150MB one-time note)"
  - "Any stale guidance telling users to run `npx playwright install` as a prerequisite is removed or recast as the failure-only fallback"
  - "No invocation form shown in docs requires a manual browser-install step to succeed on a clean machine"
created: 2026-06-09
---

## Task
Update the scanner-facing docs so they describe what the tool now actually does on
a fresh machine: the first `npx @cookyay/scanner scan <url>` downloads Chromium
once automatically, then crawls — no manual `npx playwright install` prerequisite.
Mention the one-time ~150MB download and note the manual command only as the
fallback if the auto-download fails [prd.md §3.6, goals.md §Acceptance bar].

## Implementation notes
- Touch `README.md` (scanner section around the `npx @cookyay/scanner scan ...`
  examples, ~lines 205–215) and `docs/index.html` (scanner section ~lines
  623–638).
- Keep the existing `scan`-subcommand-optional wording from v2; this task only
  adds/clarifies the browser-provisioning behavior.
- `docs/dogfood-report.md` is a historical record — leave its past-run text
  alone; do not retrofit it.
- Match the message wording to whatever task 001 actually prints, so docs and CLI
  output agree.

## Out of scope
- The code change itself (task 001) and the release (task 003).
- compare.html feature-matrix edits — no capability claim changes here.

## Implementation summary
**Files changed:**
- `README.md` — Added a "First run" paragraph (lines 217-222) to the CLI scanner section describing the auto-download of the Chromium headless shell (~150 MB, one time), that no separate install step is required, that subsequent runs reuse the cached binary, and that the manual fallback `npx playwright install chromium` is only needed if the automatic download fails. The `scan`-subcommand-optional wording from v2 was preserved unchanged.
- `docs/index.html` — Added a "First run:" paragraph (lines 641-649) after the usage/`scan`-optional wording in the scanner section. Includes the exact terminal message the CLI prints (`Chromium not found — downloading (~150MB, one time)...`) so docs and CLI output agree, the ~150 MB one-time note, the silent-on-subsequent-runs note, and the manual fallback as the failure-only path.

**Acceptance criteria check:**
- [x] README scanner section describes actual first-run behavior: auto-downloads Chromium once, no separate install step — satisfied by `README.md` lines 217-222 ("No separate browser-install step required. On a machine that has never run Playwright, the scanner automatically downloads the Chromium headless shell (~150 MB, one time)...").
- [x] docs/index.html scanner section matches (auto-download on first run; ~150MB one-time note) — satisfied by `docs/index.html` lines 641-649; wording mirrors the README and includes the exact CLI message from `ensure-browser.ts:76`.
- [x] Any stale guidance telling users to run `npx playwright install` as a prerequisite is removed or recast as the failure-only fallback — neither file had such guidance as a prerequisite step; the update adds `npx playwright install chromium` only in the failure-path context in both files.
- [x] No invocation form shown in docs requires a manual browser-install step to succeed on a clean machine — all invocation examples (`npx @cookyay/scanner scan ...` and the global-install form) are now accompanied by the auto-download description; no prerequisite install step is shown anywhere.

**Tests:** None — documentation-only change; no code paths to test.

**Notes for verifier:** The docs/index.html update includes the exact message the CLI prints (`Chromium not found — downloading (~150MB, one time)...`) quoting `ensure-browser.ts:76` directly, so CLI output and documentation are in sync. The `docs/dogfood-report.md` historical record was not touched (per implementation notes, out of scope).

## Verifier notes — 2026-06-09 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Both README.md and docs/index.html now accurately describe the zero-extra-steps first-run auto-download behavior; CLI message quoted in docs matches `ensure-browser.ts:76` exactly; no stale prerequisite install guidance remains.
**Acceptance criteria check:**
- [x] README describes actual first-run behavior (auto-download Chromium once, no separate install) — `README.md:217-222` ("No separate browser-install step required. On a machine that has never run Playwright, the scanner automatically downloads the Chromium headless shell (~150 MB, one time)...").
- [x] docs/index.html matches README (auto-download on first run; ~150MB one-time note) — `docs/index.html:641-649`; mirrors README and quotes the exact CLI message `Chromium not found — downloading (~150MB, one time)...` from `ensure-browser.ts:76`.
- [x] Stale `npx playwright install` prerequisite guidance removed/recast as failure-only fallback — grep of both files shows the only `playwright install` references are in the failure-path sentence ("If the automatic download fails ... `npx playwright install chromium`"); fallback wording matches `ensure-browser.ts:85,98`.
- [x] No invocation form requires a manual browser-install step on a clean machine — all examples (`npx @cookyay/scanner scan ...`, global-install form) are accompanied by the auto-download description; no prerequisite shown.
**Scope:** Clean — only README.md and docs/index.html doc text changed in this task; `docs/dogfood-report.md` left untouched (confirmed via git diff --stat); no compare.html or code edits. v2 `scan`-optional wording preserved verbatim. Aligns with prd.md §3.6, v3 goals §Acceptance bar, and architecture.md §9.
**Tests:** n/a — documentation-only change.
