---
id: 007
title: Docs — README honest-limits (transport + unload-drop) and parity page
status: done # pending | in-progress | done-pending-verify | done | rejected
assignee: ""             # set by /pm:claim — "<name> <email>"
branch: ""               # set by /pm:claim — pm/<slug>/<NNN>-<task-slug>
claimed_at: ""           # set by /pm:claim — YYYY-MM-DD
pr_url: ""               # set by /pm:complete — GitHub PR URL
completed_at: ""         # set by /pm:complete — YYYY-MM-DD
jira_key: ""             # set by /pm:jira-link or /pm:jira-create — e.g. "PROJ-123"
depends_on: ["003", "004"]   # list of task ids as strings
complexity: 2            # Fibonacci points: 1 | 2 | 3 | 5 | 8 | 13
prd_refs:
  - "prd.md §3.8 Honest parity story"
  - "prd.md §3.2 Prior script blocking"
  - "goals.md §What ships in v7"
  - "goals.md §What's deferred to later versions"
arch_refs:
  - "architecture.md §3 Sync vs async work (bootstrap-first limit)"
test_refs: []
research_refs:
  - "research/runtime-interception-domain-expert.md §Findings 4, §Recommendations 6 (document unload-drop)"
  - "research/_index.md §Update Q2 (async escape window), Q3 (unload drop documented in README limits)"
acceptance_criteria:
  - "README honest-limits section documents transport-layer auto-block: `fetch` and `navigator.sendBeacon` to curated tracking endpoints are held until consent, and explicitly that pre-consent `sendBeacon` calls fired at page unload (`pagehide`/`visibilitychange`) are DROPPED, not deferred — the legally-correct no-consent-no-send outcome."
  - "The intrinsic bootstrap-first / Phase-2 async escape window is documented honestly: a few-ms pre-chunk-load window where an async tracking call can escape, consistent with the existing v5–v6 bootstrap-first limit."
  - "The §3.8 comparison/parity page is updated to reflect that Cookyay now covers transport-layer (fetch/sendBeacon) blocking, and states the deliberate non-goals carried in v7: `XMLHttpRequest` and `document.write` interception remain deferred, auto-block stays opt-in."
  - "Docs match shipped behaviour from tasks 003/004 (no aspirational claims); CHANGELOG / changeset entry for the v7 cut is added per the repo's Changesets flow."
  - "`pnpm typecheck && build && lint && test && size` remain green (docs-only change must not break gates); any docs/site build step passes."
created: 2026-06-12
---

## Task
Keep the honest-parity story (prd.md §3.8) accurate for v7. The README limits section and
the comparison page must state plainly what the transport interception does and does not
cover — in particular the user-resolved drop-on-unload posture for `sendBeacon`
[research/_index.md §Update Q3] and the intrinsic Phase-2 async escape window
[research/_index.md §Update Q2]. This mirrors the v6 honest-limits documentation task.

## Implementation notes
- Anchor: the banner package README and the docs/comparison page (follow the v6 task-007
  precedent for where honest-limits content lives); add a Changesets entry for the v7
  release cut.
- Be specific and non-aspirational: "held until consent" for normal-lifecycle calls;
  "dropped, not deferred" for unload beacons; "no sessionStorage persistence in v7".
- Note the still-deferred surfaces (`XMLHttpRequest`, `document.write`) and that auto-block
  remains opt-in — no default flip in v7 (goals.md §What's deferred).

## Out of scope
- Any implementation/behaviour change — docs only; behaviour is fixed by tasks 003/004.
- Writing RELEASE.md / closing the version — that is `/pm:release`, not this task.
- Bundle-size numbers in docs — owned by tasks 001/006.

## Implementation summary

**Files changed:**
- `README.md` — Updated Features bullet (v6→v7 transport layer); rewrote "What it does" section to cover `fetch`/`sendBeacon` hybrid stub+queue behavior, unload-drop posture, and Phase-2 async escape window; rewrote "Honest limits" section to remove the v6 `fetch`/`sendBeacon` gap item and replace with correct v7 scoped limits (curated-endpoint-only, unload-drop, Phase-2 window, XHR/document.write deferred, auto-block opt-in); updated comparison table row from v6 to v7.
- `docs/index.html` — Updated TOC link to mention v7 transport coverage; updated config reference `autoBlock` row to reflect v7 transport; updated "What auto-block does" paragraph to include v7 transport; added new `h3` section "v7 — fetch and navigator.sendBeacon transport coverage" with full coverage/stub/queue/unload-drop/escape-window/skip-Google prose; replaced old "Honest limits of DOM-level interception" `h3` with "Honest limits of auto-block interception" that drops the v6 fetch/sendBeacon gap item and adds curated-endpoint-only, XHR deferred, opt-in notes; updated comparison table row `autoBlock: true (v6)` → `(v7)` with accurate notes.
- `docs/compare.html` — Updated version labels from v6→v7 in table header and intro paragraph; updated auto-detection feature row description to include v7 transport coverage and honest limits; rewrote the note-row to reflect v7's transport coverage and document unload-drop/Phase-2 escape window/XHR-deferred/opt-in; updated "cannot-do" `autoBlock` item to replace the v6 fetch/sendBeacon gap with v7's stated deliberate limits; updated open-source neighbors differentiator paragraph to mention transport coverage and honest limits; updated "when to switch" `autoBlock` bullet to reference v7 and note unload-drop.
- `.changeset/v7-transport-interception.md` — New Changesets entry (`cookyay: minor`) documenting transport-layer auto-block, hybrid stub+queue for `fetch`, synchronous `true` return for `sendBeacon`, unload-drop behavior, Phase-2 escape window, skip-Google, XHR/document.write deferred, opt-in stays.

**Acceptance criteria check:**
- [x] README honest-limits section documents transport-layer auto-block (`fetch`/`sendBeacon` to curated tracking endpoints held until consent) and explicitly states pre-consent `sendBeacon` at page unload (`pagehide`/`visibilitychange`) is **dropped, not deferred** — `README.md` "Unload-drop behavior" paragraph and "Pre-consent unload beacons are dropped, not deferred (v7)" bullet in Honest limits.
- [x] Bootstrap-first / Phase-2 async escape window documented honestly: "a few-ms pre-chunk-load window where an async tracking call can escape" — `README.md` "Phase-2 async escape window" paragraph and "Phase-2 async escape window (v7)" bullet in Honest limits.
- [x] `§3.8` comparison/parity page updated to reflect v7 transport-layer coverage; deliberate non-goals stated (XHR deferred, `document.write` deferred, auto-block stays opt-in) — `docs/compare.html` feature table row, note-row, "cannot-do" item, neighbors paragraph, and "when to switch" bullet.
- [x] Docs match shipped behaviour from tasks 003/004 (no aspirational claims — coverage is curated-endpoint-only, hybrid stub+replay, unload-drop); Changesets entry for v7 added at `.changeset/v7-transport-interception.md`.
- [x] `pnpm typecheck && build && lint && test && size` all green (970 tests pass, all size budgets met); `format:check` passes (prettier run).

**Tests:** No test files changed — documentation-only task.

**Notes for verifier:** The key content to verify in each file:
1. `README.md`: "Unload-drop behavior (v7, documented honestly)" paragraph explicitly says "dropped, not deferred"; "Phase-2 async escape window" paragraph; XHR and document.write labelled deferred; auto-block opt-in unchanged.
2. `docs/index.html`: New `h3` section "v7 — fetch and navigator.sendBeacon transport coverage" near line 1140; "Honest limits of auto-block interception" (renamed from "DOM-level") now correctly removes the v6 fetch/sendBeacon gap entry and lists the v7 scoped limits.
3. `docs/compare.html`: Note-row under auto-detection explicitly says `sendBeacon` at unload is "dropped" with "no sessionStorage persistence, no future replay"; "cannot-do" item correctly removes fetch/sendBeacon as an unconditional gap and replaces with the v7 deliberate limits.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Docs across README, index.html, and compare.html accurately and honestly document v7 transport-layer auto-block (fetch/sendBeacon, 204 stub, hold/replay), the unload-drop posture, and the Phase-2 async escape window; all claims cross-checked against shipped 003/004 behaviour and all gates green.
**Acceptance criteria check:**
- [x] README honest-limits documents transport auto-block + unload-drop ("dropped, not deferred", no consent = no send) — `README.md` "What it does", "Unload-drop behavior (v7)" para, and "Pre-consent unload beacons are dropped, not deferred (v7)" bullet in Honest limits.
- [x] Phase-2 async escape window documented honestly, consistent with v5/v6 bootstrap-first limit — `README.md` "Phase-2 async escape window" para + Honest-limits bullet; matches `research/_index.md §Update Q2`.
- [x] §3.8 comparison page reflects transport coverage; deliberate non-goals (XHR + document.write deferred, auto-block opt-in) stated — `docs/compare.html` feature row, note-row, cannot-do item, neighbors paragraph, when-to-switch bullet; `docs/index.html` config-reference row, "What auto-block does", new v7 transport h3, renamed "Honest limits of auto-block interception".
- [x] Docs match shipped 003/004 behaviour (204 stub, clone-at-intercept + replay via `_origFetch`, `sendBeacon` returns `true` + queues, `pagehide`/`visibilitychange` unload-drop, lazy-chunk classify, skip-Google via `matchAutoBlock`); v7 changeset `.changeset/v7-transport-interception.md` (`cookyay: minor`) added per Changesets flow (consistent with v6 precedent — project-internal `CHANGELOG.md` is not this task's responsibility).
- [x] Gates green: `typecheck`, `build`, `lint`, `format:check` all pass; size budgets met (ESM-OFF 12.92 kB < 13.1 kB, autoBlock-ON 16.92 kB < 20 kB); 970/970 tests pass.
**Tests:** 970/970 pass (docs-only task — no test files changed). typecheck/build/lint/format:check/size all green.
