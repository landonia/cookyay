---
id: 007
title: Docs — README pixel coverage, honest limits (fetch/sendBeacon gap), compare page
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["003", "004"]
complexity: 3
prd_refs:
  - "prd.md §3.8"
  - "prd.md §3.1"
  - "goals.md §What ships in v6"
arch_refs: []
test_refs: []
research_refs:
  - "research/runtime-interception-domain-expert.md §Findings 1; Gotchas 2; Out of scope"
  - "research/_index.md §Update — Author decisions (C, D)"
acceptance_criteria:
  - "The cookyay package README documents that autoBlock now also blocks known third-party tracking PIXELS (<img> beacons, incl. the new Image() pattern) until consent, scoped to curated endpoints only — and that this remains opt-in (autoBlock, default false) with declared rules winning."
  - "Docs state the honest limits plainly: fetch()/navigator.sendBeacon() beacons (used by modern Meta Pixel Advanced Matching, TikTok) are NOT intercepted by DOM-level auto-block and are a known gap [research/_index.md §Update C]; srcset and innerHTML-injected/parser-committed <img src> are likewise not caught; document.write remains deferred."
  - "Docs reiterate the bootstrap-first install requirement and describe the new debug-mode install-order diagnostic (set debug:true to get a console warning when a tracker loaded before Cookyay) [decision D]."
  - "The §3.8 comparison page is updated to reflect pixel auto-block coverage (closing more of the gap vs paid CMPs) with the same honest caveats; links/anchors remain valid."
created: 2026-06-11
---

## Task
Document v6's new pixel coverage and — crucially for the §3.8 honest-parity story —
its honest limits. The `fetch`/`sendBeacon` gap is a real boundary of DOM-level
interception and must be stated plainly rather than glossed [research/runtime-interception-domain-expert.md §1, Gotcha 2].

## Implementation notes
- Update `packages/cookyay/README.md` (autoBlock section), `docs/index.html`, and
  `docs/compare.html`.
- Frame pixel coverage as additive to v5's script/iframe auto-block; keep the opt-in
  and declared-wins framing consistent with v5 docs.
- Honest-limits list should read as an extension of v5's known-limitations prose.

## Out of scope
- Any implementation (tasks 001–004) or test work (005/006).
- A formal RELEASE.md — that's written by /pm:release at version close, not here.

## Re-execution notes — 2026-06-11
Two targeted fixes addressing both verifier rejection points. No other docs changed.

**Gap 1 addressed:** `docs/index.html` "v6 — `<img>` beacon pixel coverage" list corrected:
- Snapchat Pixel: `sc-static.net/scevent.gif` → `tr.snapchat.com/p` (matches `db-autoblock.generated.ts` `requestPaths` for `snapchat-pixel`)
- Reddit Pixel: `alb.reddit.com/snoo.gif` → `alb.reddit.com/rp.gif` (matches `requestPaths` for `reddit-pixel`)
- All other four endpoints re-verified against the DB and confirmed unchanged.

**Gap 2 addressed:** Both README.md and docs/index.html now show the exact message emitted by `autoblock-diagnostic.ts` `_formatDiagnosticWarning()` (line 44-45). Removed the spurious "to the first `<script>`" suffix and the extra "Auto-block cannot retroactively suppress already-fetched resources." sentence that appeared in the prior README example but are not printed by the code. docs/index.html install-order callout now shows an inline `<code>` example with the literal message format for consistency.

## Implementation summary
**Files changed (this re-execution — targeted fixes only):**
- `docs/index.html` — Corrected two pixel endpoint citations in the "v6 — `<img>` beacon pixel coverage" list to match `db-autoblock.generated.ts`: Snapchat `sc-static.net/scevent.gif` → `tr.snapchat.com/p`; Reddit `alb.reddit.com/snoo.gif` → `alb.reddit.com/rp.gif`. Updated the install-order callout to show an inline code example of the exact shipped warning message format.
- `README.md` — Replaced the three-line diagnostic example block with the single-line literal message from `autoblock-diagnostic.ts` `_formatDiagnosticWarning()`: removed the spurious "to the first `<script>`" suffix and the fabricated "Auto-block cannot retroactively suppress already-fetched resources." sentence.

**Files unchanged (correct from prior execution):**
- `docs/compare.html` — AC4 was confirmed PASS by verifier; not touched.
- `README.md` autoBlock feature description, honest limits prose — AC1/AC2 were confirmed PASS; not touched.

**Acceptance criteria check:**
- [x] AC1 — README documents `<img>` pixel coverage, opt-in (`autoBlock`, default false), curated host+path scoping, declared rules winning — `README.md` lines 22, 243–268. `docs/index.html` covered-pixel list now uses correct endpoints from the DB (Snapchat `tr.snapchat.com/p`, Reddit `alb.reddit.com/rp.gif`, others confirmed correct).
- [x] AC2 — Honest limits stated plainly at all layers: fetch()/sendBeacon() labelled "known gap", srcset not caught, innerHTML-injected not caught, document.write deferred — `README.md` lines 293–314; `docs/index.html` "Honest limits of DOM-level interception" subsection; `docs/compare.html` note-row + cannot-do item.
- [x] AC3 — Bootstrap-first requirement documented and debug-mode install-order diagnostic described with example matching the literal shipped string `[Cookyay] INSTALL ORDER WARNING: "<service>" (<url>) loaded before Cookyay bootstrap. Move Cookyay first in <head>.` — `README.md` lines 269–287; `docs/index.html` install-order callout (lines ~904–907).
- [x] AC4 — §3.8 comparison page updated with pixel coverage, honest caveats, valid anchors — `docs/compare.html` (unchanged from prior execution, confirmed PASS by verifier).

**Tests:** No test files — documentation-only task.

**Notes for verifier:** Only the two targeted fixes from the rejection were made. Gap 1: verify `docs/index.html` covered-pixels `<ul>` now shows `tr.snapchat.com/p` and `alb.reddit.com/rp.gif` matching `db-autoblock.generated.ts`. Gap 2: verify `README.md` diagnostic code block (lines ~282–284) is a single line matching `autoblock-diagnostic.ts:44-45`; and `docs/index.html` install-order callout now shows an inline example of the literal message without the removed extra phrases.

## Verifier notes — 2026-06-11 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Docs are otherwise excellent, but `docs/index.html` lists two "Covered pixels" endpoints that do not match the shipped signature DB — a factual inaccuracy in the very honest-coverage story this task exists to deliver.

**What needs to change:**
1. `docs/index.html` (the "v6 — `<img>` beacon pixel coverage" list, ~lines 940–943) cites pixel endpoints that are NOT what the shipped DB blocks. Fix to match `packages/cookyay/src/db-autoblock.generated.ts` `requestPaths`:
   - **Snapchat Pixel** — doc says `sc-static.net/scevent.gif`; the DB ships `tr.snapchat.com/p` (host `sc-static.net` with that path is not in `requestPaths` at all, so it is NOT covered). Change the doc to `tr.snapchat.com/p`.
   - **Reddit Pixel** — doc says `alb.reddit.com/snoo.gif`; the DB ships `alb.reddit.com/rp.gif`. Change the doc to `alb.reddit.com/rp.gif`.
   - Re-verify every other listed endpoint against the generated DB while you are in there. Confirmed correct as of this review: Meta `facebook.com/tr`, LinkedIn `px.ads.linkedin.com/collect`, Pinterest `ct.pinterest.com/v3/`, TikTok `analytics.tiktok.com/i18n/pixel/`.
2. The documented install-order diagnostic message (in BOTH `README.md` ~lines 277–281 and `docs/index.html` install-order callout) does not match the message the code actually emits. Shipped text (`packages/cookyay/src/autoblock-diagnostic.ts:44-45`): `[Cookyay] INSTALL ORDER WARNING: "<service>" (<url>) loaded before Cookyay bootstrap. Move Cookyay first in <head>.` The docs add `to the first <script>` and an extra trailing sentence ("Auto-block cannot retroactively suppress already-fetched resources.") that the code does not print. Either (a) align the doc example to the literal shipped string, or (b) reconcile with task 004's executor on which is canonical and make code+docs agree. The summary's claim that the example is "the exact console message format from research" is true of research, but research is not what ships — the doc must mirror runtime output.

**Acceptance criteria check:**
- [ ] AC1 (README documents `<img>` pixel coverage, opt-in, curated host+path, declared-wins) — README PASS. FAILS at `docs/index.html`: two of the six enumerated "covered" endpoints (Snapchat, Reddit) are wrong / not actually in the DB. The "scoped to curated host+path only" framing is correct prose, but the concrete examples misrepresent what is blocked.
- [x] AC2 (honest limits: fetch/sendBeacon known gap, srcset, innerHTML/parser-committed, document.write deferred) — PASS. Stated plainly and accurately at all three layers; fetch/sendBeacon explicitly labelled a "known gap" (README "Honest limits" subsection, `docs/index.html` "Honest limits of DOM-level interception", `docs/compare.html` note-row + cannot-do item).
- [~] AC3 (bootstrap-first requirement + debug-mode install-order diagnostic) — PARTIAL. The requirement and the debug diagnostic are described and the `debug:true`/zero-prod-cost framing is correct, but the quoted console message diverges from the shipped string (see gap 2).
- [x] AC4 (§3.8 compare page updated; honest caveats; links/anchors valid) — PASS. `docs/compare.html` table header v5→v6, auto-detection row, note-row "Known gap", cannot-do gaps enumeration, when-to-switch + neighbors paragraphs all updated. Anchors verified: `#feature-table`, `#cannot-do`, `#open-source-neighbors`, `#when-to-switch` all have matching ids; `index.html#autoblock` target exists (`docs/index.html:880`).

**Tests:** n/a — documentation-only task (no test command; testing.md absent for v6).

**Notes for next executor:** Only `docs/index.html` (the covered-pixels `<ul>`) needs the two endpoint corrections for gap 1; do NOT touch the implementation/DB. For gap 2, the source of truth is `packages/cookyay/src/autoblock-diagnostic.ts` `installOrderWarning()` (line 44) — copy its literal emitted string into both `README.md` and `docs/index.html`, or escalate the wording mismatch to whoever owns task 004. The rest of the docs work (README rewrite, compare.html, honest-limits prose, anchors) is correct and should be left as-is.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Both prior rejection gaps fixed: docs pixel endpoints now match the shipped DB and the install-order diagnostic string matches the code verbatim; all four ACs pass.
**Acceptance criteria check:**
- [x] AC1 — README documents `<img>` pixel coverage, opt-in (`autoBlock` default false), curated host+path scoping, declared-wins (`README.md:22,243-264`). `docs/index.html:939-944` covered-pixel list now matches `db-autoblock.generated.ts` exactly: Meta `facebook.com/tr`, LinkedIn `px.ads.linkedin.com/collect`, Pinterest `ct.pinterest.com/v3/`, Snapchat `tr.snapchat.com/p` (corrected), TikTok `analytics.tiktok.com/i18n/pixel/`, Reddit `alb.reddit.com/rp.gif` (corrected). All six re-verified against the DB.
- [x] AC2 — Honest limits stated plainly at all three layers: fetch()/sendBeacon() labelled "known gap", srcset not caught, innerHTML-injected not caught, document.write deferred (`README.md:289-312`; `docs/index.html` "Honest limits" subsection; `docs/compare.html:247-250,565-589`).
- [x] AC3 — Bootstrap-first requirement + debug-mode (`debug:true`, zero prod cost) diagnostic documented; quoted message now matches `autoblock-diagnostic.ts:42-46` `_formatDiagnosticWarning()` verbatim in both `README.md:283` and `docs/index.html:907` (spurious "to the first `<script>`" suffix and fabricated trailing sentence removed).
- [x] AC4 — §3.8 compare page updated with pixel coverage + honest caveats; anchors `#feature-table`, `#cannot-do`, `#open-source-neighbors`, `#when-to-switch` all resolve; `index.html#autoblock` target exists (`docs/index.html:880`).
**Tests:** n/a — documentation-only task (no test command; testing.md absent for v6).
