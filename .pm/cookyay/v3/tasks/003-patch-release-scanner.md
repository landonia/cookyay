---
id: 003
title: Patch release of `@cookyay/scanner`
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: "https://github.com/landonia/cookyay/pull/5"
completed_at: ""
jira_key: ""
depends_on: ["001", "002"]
complexity: 2
prd_refs:
  - "prd.md §3.7"
  - "goals.md §Acceptance bar"
arch_refs:
  - "architecture.md §1 Deployment topology"
  - "architecture.md §9 Environments & deployment"
test_refs: []
research_refs: []
acceptance_criteria:
  - "A changeset entry exists marking `@cookyay/scanner` as a `patch` bump describing the first-run Chromium auto-install fix"
  - "The Changesets version PR bumps `@cookyay/scanner` (0.1.2 → 0.1.3) and updates its CHANGELOG"
  - "On a machine with no Playwright browsers, `npx @cookyay/scanner@latest scan https://cookyay.com` downloads Chromium once and completes the crawl (no `browserType.launch: Executable doesn't exist` error) — verified after publish"
  - "Any version-pinned scanner references in docs are bumped to the released patch (or confirmed none exist)"
created: 2026-06-09
---

## Task
Ship the task 001/002 fix to npm so `npx @cookyay/scanner` resolves a version that
provisions its own browser. Reuse the v1/v2 Changesets + OIDC release flow: add a
patch changeset for `@cookyay/scanner`, merge to main so the Changesets action
opens/updates the version PR (0.1.2 → 0.1.3), and confirm the published package
works cold [prd.md §3.7, goals.md §Acceptance bar].

## Implementation notes
- Add `.changeset/scanner-browser-autoinstall.md` (patch, `@cookyay/scanner`)
  describing the first-run Chromium auto-download.
- Release flow (per v1 task 017 / v2 task 003): merge to main → Changesets action
  → merge the "Version Packages" PR → OIDC publish with provenance.
- Post-publish smoke test must run where no Playwright browsers are cached (the
  whole point of the fix) — e.g. a clean container / fresh
  `PLAYWRIGHT_BROWSERS_PATH` — so the auto-download path is actually exercised:
  `npx @cookyay/scanner@latest scan https://cookyay.com --timeout 5000`.
- Bump any version-pinned `@cookyay/scanner@<v>` references if present (grep
  README + docs; v2 found none active).

## Out of scope
- Releasing the `cookyay` banner package (no code change there this version).
- CI / release-workflow changes — the existing pipeline is reused as-is.

## Implementation summary
**Files changed:**
- `.changeset/scanner-browser-autoinstall.md` — New patch changeset for `@cookyay/scanner` describing the first-run Chromium auto-download fix.
- `packages/scanner/src/ensure-browser.ts` — New module that auto-provisions the Chromium headless shell on first run: fast no-op if binary already present; prints a one-time notice and runs `playwright install chromium` if missing; surfaces a branded error with manual fallback if the download fails.
- `packages/scanner/src/ensure-browser.test.ts` — Vitest unit tests covering all four scenarios: binary present (no-op), binary absent + successful install, binary absent + install fails (exit 1), and resolvePlaywrightCli failure (exit 1).
- `packages/scanner/src/crawler.ts` — Added `import { ensureBrowser } from './ensure-browser.js'` and `await ensureBrowser(import.meta.url)` call at the top of the crawl function (line 144).

**Acceptance criteria check (updated 2026-06-09 — release executed):**
- [x] A changeset entry exists marking `@cookyay/scanner` as a `patch` bump describing the first-run Chromium auto-install fix — was `.changeset/scanner-browser-autoinstall.md` (patch, `@cookyay/scanner`); consumed by `pnpm changeset version` via PR #6 (correct Changesets flow); its effect is in `packages/scanner/CHANGELOG.md` `## 0.1.3`.
- [x] The Changesets version PR bumps `@cookyay/scanner` (0.1.2 → 0.1.3) and updates its CHANGELOG — PR #6 (`chore: version packages`, commit `48f93ed`) merged to main; `packages/scanner/package.json` is now `0.1.3` and `CHANGELOG.md` has the `## 0.1.3` entry.
- [x] On a machine with no Playwright browsers, `npx @cookyay/scanner@latest` downloads Chromium once and completes the crawl — verified: cold run with fresh `PLAYWRIGHT_BROWSERS_PATH` downloaded Chromium + headless shell + ffmpeg and finished `Pages visited: 4`, exit 0, no launch error. Evidence in `## Re-execution notes — 2026-06-09` point 3.
- [x] Any version-pinned scanner references in docs are bumped to the released patch (or confirmed none exist) — confirmed none in active docs (README.md and docs/index.html use bare `@cookyay/scanner`); `docs/dogfood-report.md` keeps `@0.1.1` as a dated historical record.

**Tests:** `pnpm --filter @cookyay/scanner test` → 59 passed (3 files, incl. 6 in `ensure-browser.test.ts`).

**Notes for verifier:** The release is live: `npm view @cookyay/scanner versions` → `0.1.0, 0.1.1, 0.1.2, 0.1.3`; `@latest` = 0.1.3. Both PRs are merged to `main` (#5 feature `51271b7`, #6 version-packages `48f93ed`). The cold smoke test was run from an empty `PLAYWRIGHT_BROWSERS_PATH` so the auto-download path was genuinely exercised — see Re-execution notes point 3 for the SIGPIPE caveat on the first (piped) attempt vs the clean passing run.

## Blocker — RESOLVED 2026-06-09
The prior blocker (automated `/pm:auto` executor cannot `git commit`/`git push`/
publish) was resolved by performing the release with the user's explicit
authorization. See `## Re-execution notes — 2026-06-09` below for the full
release evidence. The release is published (`@cookyay/scanner@0.1.3`) and the cold
smoke test passed.

## Re-execution notes — 2026-06-09
**Verifier notes (REJECTED) addressed — the rejection was purely "the release was
never executed"; the fix code itself was confirmed sound. All four points are now
closed:**

1. **Release executed.** All v3 work was branched (`fix/scanner-auto-provision-chromium`),
   committed, pushed, and merged to `main` as PR #5 (squash commit `51271b7`).
   `git log` on main now shows `51271b7 fix(scanner): auto-provision Chromium on
   first run (#5)` on top of the prior `ed86b9e` v2 cut.
2. **Version bump + CHANGELOG landed.** The Changesets action opened the "Version
   Packages" PR (#6), which was merged (commit `48f93ed`). On `main`,
   `packages/scanner/package.json` is now `"version": "0.1.3"`, the changeset file
   `.changeset/scanner-browser-autoinstall.md` was consumed (deleted), and
   `packages/scanner/CHANGELOG.md` has a new `## 0.1.3 → Patch Changes` entry
   (`51271b7: Auto-provision Chromium on first run...`).
3. **Published + cold smoke test passed.** The OIDC release workflow published to
   npm — `npm view @cookyay/scanner versions` now returns
   `['0.1.0','0.1.1','0.1.2','0.1.3']` and `@latest` = `0.1.3`. Cold smoke test
   from a fresh, empty browser cache:
   `PLAYWRIGHT_BROWSERS_PATH=/tmp/cold-1781022271 npx -y @cookyay/scanner@0.1.3 scan https://cookyay.com --timeout 8000 --config-out /tmp/cold-config.json`
   → printed `Chromium not found — downloading (~150MB, one time)...`, downloaded
   full Chromium + `chrome-headless-shell` + ffmpeg, then `Config written to:
   /tmp/cold-config.json`, `Pages visited: 4`, **exit 0** — no
   `browserType.launch: Executable doesn't exist` error. (An earlier smoke attempt
   appeared to fail, but that was a test-harness artifact: piping through `head`
   sent SIGPIPE and killed the install mid-download, leaving a half-populated
   cache. The clean, un-piped run above succeeds end-to-end.)
4. **Criteria 2 and 3 now genuinely checked** (see updated checkboxes below) — the
   package is published and the cold smoke test has passed, not deferred.

## Verifier notes
<!-- Empty at creation. Populated by /pm:verify if rejected. -->

## Verifier notes — 2026-06-09 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** The patch release was never performed — `@cookyay/scanner` is still 0.1.2 on npm and in `package.json`; nothing is committed/merged/published, so 2 of 4 acceptance criteria fail.
**What needs to change:**
1. Run the release. The entire v3 change set is sitting uncommitted in the working tree: `.changeset/scanner-browser-autoinstall.md` is untracked, `packages/scanner/src/{ensure-browser.ts,ensure-browser.test.ts}` are untracked, and `packages/scanner/src/crawler.ts`, `README.md`, `docs/index.html` are modified-but-unstaged. Tasks 001/002 are marked `done` but their commits don't exist on `main` (latest commit is `ed86b9e chore: version packages (#4)` from the v2 cut). Commit/merge the 001/002/003 work to `main` so the Changesets action can open the "Version Packages" PR.
2. Criterion 2 (`0.1.2 → 0.1.3` bump + CHANGELOG) is unmet: `packages/scanner/package.json` still reads `"version": "0.1.2"` and there is no Changesets version PR. Merge the changeset → merge the resulting "Version Packages" PR so the bump and `packages/scanner/CHANGELOG.md` entry land.
3. Criterion 3 (cold-machine smoke test, "verified after publish") is unmet: `npm view @cookyay/scanner versions` returns only `0.1.0, 0.1.1, 0.1.2` — `0.1.3` is not published, so `npx @cookyay/scanner@latest` resolves to the unfixed 0.1.2. After the OIDC publish, actually run the cold smoke test in an environment with no cached Playwright browsers (e.g. `PLAYWRIGHT_BROWSERS_PATH=/tmp/fresh-$(date +%s) npx @cookyay/scanner@latest scan https://cookyay.com --timeout 5000`) and confirm Chromium auto-downloads and the crawl completes with no `browserType.launch: Executable doesn't exist` error. Paste the evidence into the Implementation summary.
4. The executor's own summary leaves criteria 2 and 3 unchecked (`[ ]`) and defers them to "after the release workflow runs" — i.e. the task's central deliverable (a published patch release) was acknowledged as not-done at the time it was marked `done-pending-verify`. Do not re-mark done-pending-verify until the package is actually published and the cold smoke test has passed.
**Acceptance criteria check:**
- [x] Changeset entry exists (patch, `@cookyay/scanner`, describes first-run Chromium auto-install) — `.changeset/scanner-browser-autoinstall.md:1-13`.
- [ ] Changesets version PR bumps 0.1.2 → 0.1.3 + CHANGELOG — FAIL: `package.json` still 0.1.2, no version PR, nothing merged to main.
- [ ] Cold-machine `npx @cookyay/scanner@latest` downloads Chromium and completes (verified after publish) — FAIL: 0.1.3 not on npm; `@latest` = 0.1.2 (unfixed). Unverifiable until published.
- [x] Version-pinned scanner refs in docs bumped or confirmed none — PASS: active docs (`README.md`, `docs/index.html`) use bare `@cookyay/scanner`; `docs/dogfood-report.md:6,66` keep `@0.1.1` as a dated historical record (reasonable to preserve).
**Tests:** `pnpm --filter @cookyay/scanner test` → 59 passed (59), incl. 6 in `ensure-browser.test.ts`. The implementation/tests are sound; the failure is that the release itself was not executed.
**Notes for next executor:** The fix code (`ensure-browser.ts` + `crawler.ts:144` `await ensureBrowser(import.meta.url)`) is correct and tested — this rejection is purely about shipping it. Reuse the v1 task 017 / v2 task 003 Changesets + OIDC flow: branch, commit the uncommitted 001/002/003 work, open PR → merge to main → Changesets action opens "Version Packages" PR → merge it → Actions publishes with provenance. Then do the cold smoke test from a fresh `PLAYWRIGHT_BROWSERS_PATH`. Confirm `npm view @cookyay/scanner versions` lists `0.1.3` and `packages/scanner/CHANGELOG.md` has the new entry before re-submitting.

## Verifier notes — 2026-06-09 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** The release was executed and independently confirmed — `@cookyay/scanner@0.1.3` is published, both PRs are merged to `main`, and a fresh-cache cold smoke test against `@latest` auto-downloads Chromium and completes the crawl with no launch error. All four criteria PASS.
**Acceptance criteria check:**
- [x] Changeset entry exists (patch, `@cookyay/scanner`, first-run Chromium auto-install) — changeset was consumed by the version PR; its effect is in `packages/scanner/CHANGELOG.md` `## 0.1.3 → Patch Changes` (cites commit `51271b7`, describes the auto-download fix). `.changeset/` now holds only `config.json` + `README.md` (correct post-consume state).
- [x] Version PR bumps 0.1.2 → 0.1.3 + CHANGELOG — PR #6 `chore: version packages` MERGED (`48f93ed`); `packages/scanner/package.json` reads `"version": "0.1.3"` on `main`; CHANGELOG `## 0.1.3` entry present. `git log` shows `48f93ed` over `51271b7` (PR #5, the fix) over the prior `ed86b9e` v2 cut.
- [x] Cold-machine `npx @cookyay/scanner@latest` downloads Chromium and completes — independently reproduced: `PLAYWRIGHT_BROWSERS_PATH=/tmp/verify-cold-1781022633 npx -y @cookyay/scanner@latest scan https://cookyay.com --timeout 8000 --config-out /tmp/verify-config.json` → printed `Chromium not found — downloading (~150MB, one time)...`, downloaded `chromium-1223` + `chromium_headless_shell-1223` + `ffmpeg-1011`, wrote valid config JSON, `Pages visited: 4`, exit 0, no `browserType.launch: Executable doesn't exist`. `npm view @cookyay/scanner versions` → `0.1.0,0.1.1,0.1.2,0.1.3`; `@latest` = 0.1.3.
- [x] Version-pinned scanner refs in docs bumped or confirmed none — active docs (`README.md`, `docs/index.html`) use bare `@cookyay/scanner`; only `docs/dogfood-report.md:6,66` retain `@0.1.1` as a dated historical record (correctly preserved).
**Tests:** `pnpm --filter @cookyay/scanner test` → 59 passed (3 files; 6 in `ensure-browser.test.ts`). Independently re-run, green.
**Non-blocking observation (future polish, not a reject):** On the cold path Playwright's own installer prints its stock "running npx playwright install without first installing your project's dependencies" warning box alongside the scanner's clean `Chromium not found — downloading...` message. It's cosmetic (the install proceeds and succeeds), but the doubled messaging is slightly noisy; a future tweak could suppress/condense the Playwright installer chatter. Does not violate any criterion.
