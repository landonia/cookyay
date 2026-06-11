---
id: 009
title: Docs — README + comparison page for runtime auto-block
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["005"]
complexity: 3
prd_refs:
  - "goals.md §What ships in v5"
  - "prd.md §3.8"
  - "prd.md §3.1"
arch_refs: []
test_refs: []
research_refs:
  - "research/runtime-interception-domain-expert.md §Recommendations"
  - "research/_index.md §Update — Author decisions"
acceptance_criteria:
  - "The cookyay package README documents the autoBlock config flag (opt-in boolean, default false), what it does (blocks known third-party scripts/iframes until consent without hand-declaring them), and how it relates to the existing declarative blocking (declared rules win)."
  - "Docs state the hard install requirement plainly: the Cookyay bootstrap MUST be the first script in <head> (before GTM/GA) or scripts loaded earlier cannot be blocked — the honest limit from research."
  - "Docs state v5's scope limits: scripts + iframes only; <img> beacon pixels and document.write legacy injection are NOT auto-blocked (deferred); and that Google tags are intentionally passed through to Consent Mode v2 (not DOM-blocked)."
  - "The §3.8 comparison page is updated to reflect that Cookyay now offers runtime auto-block (closing the gap vs paid CMPs), with the same honest caveats; links/anchors remain valid."
created: 2026-06-10
---

## Task
v5 only delivers value if site owners know how to turn it on and understand its
honest limits [prd.md §3.8 honest-parity story, goals.md §What ships in v5].
Document the `autoBlock` flag, the non-negotiable "Cookyay first in `<head>`"
requirement, and the deliberate scope boundaries (scripts+iframes only; Google
passed through to Consent Mode v2; pixels/document.write deferred) so the parity
page stays honest [research/runtime-interception-domain-expert.md §Recommendations,
research/_index.md §Update].

## Implementation notes
- Update `packages/cookyay/README.md` (created/expanded in v4 for the scanner side —
  here add the banner-side auto-block section) and the `docs/compare.html` comparison
  page.
- Mirror the tone of the existing docs: clear, caveated, no overpromising.
- Cross-link to the scanner's `suggestedBlocking[]` output (v4) so users see the
  scan-time and run-time stories together.

## Out of scope
- Any behavior change — docs only.
- Marketing copy beyond the honest comparison.

## Implementation summary
**Files changed:**
- `README.md` — Added `autoBlock: true` entry to Features list; added `## Runtime auto-block (v5)` section (after CLI scanner) covering: the config flag (opt-in boolean, default false), what it does, the hard install requirement with a blockquote callout, scope limits (scripts+iframes only; `<img>` pixels and `document.write` deferred; Google tags excluded via Consent Mode v2), and a comparison table showing declarative vs runtime approaches and cross-linking to scanner `suggestedBlocking[]`.
- `docs/index.html` — Added `autoBlock` nav link; added ToC entry; added `autoBlock` row to config reference table; added hint after quickstart checklist; updated scanner section "v4 boundary" callout to reflect v5 reality; added new `## Runtime auto-block` section (`#autoblock`) between scanner and GTM sections, including hard-install warning callout, what-it-does, scope boundaries, Google-tags explanation, declarative-vs-runtime comparison table, and debug-mode note.
- `docs/compare.html` — Updated table header from "v4" to "v5"; updated "Auto-detection" row from `~` (partial/deferred) to `✓` with honest caveats (scripts/iframes only; Google tags excluded); updated note-row to describe v5 runtime interception, shared database, and links to `#autoblock` docs; updated "What Cookyay cannot do" section: replaced "No runtime auto-block (v5 item)" item with "Runtime auto-block covers scripts and iframes only" item and a separate "Auto-block requires Cookyay first in `<head>`" item; updated "When to switch" section: added runtime auto-block as a reason to switch, updated the CMS/HTML-edit caveat to name the actual limit (load-order, not capability); updated open-source-neighbors differentiators paragraph to mention `autoBlock: true` (v5).

**Acceptance criteria check:**
- [x] README documents the `autoBlock` config flag (opt-in boolean, default false), what it does (blocks known third-party scripts/iframes until consent without hand-declaring them), and how it relates to declarative blocking (declared rules win) — satisfied by `README.md` `## Runtime auto-block (v5)` section (lines ~227–325) and the updated Features list.
- [x] Docs state the hard install requirement: bootstrap MUST be the first script in `<head>` or scripts loaded earlier cannot be blocked — satisfied by `README.md` blockquote callout under "The non-negotiable install requirement" and the `callout-warn` in `docs/index.html #autoblock`.
- [x] Docs state v5 scope limits: scripts+iframes only; `<img>` beacon pixels and `document.write` not auto-blocked (deferred); Google tags intentionally passed through to Consent Mode v2 (not DOM-blocked) — satisfied by `README.md` `### Scope boundaries` and `### Google tags and Consent Mode v2`; mirrored in `docs/index.html #autoblock` and `docs/compare.html` "What Cookyay cannot do" section.
- [x] §3.8 comparison page updated to reflect runtime auto-block (closing the gap vs paid CMPs), with honest caveats; links/anchors remain valid — satisfied by `docs/compare.html`: auto-detection row flipped to `✓`, note-row updated, "cannot do" section updated, "when to switch" updated, differentiators paragraph updated; new `index.html#autoblock` anchor added and cross-linked from compare.html.

**Tests:** No tests required (docs-only task; `## Out of scope` explicitly excludes behavior changes).

**Notes for verifier:** The `compare.html` "What Cookyay cannot do" section now has two separate items where there was one: (1) scope limits (pixels/document.write/Google-tags) and (2) the load-order limit. Both are honest and caveated per project tone. The `index.html #autoblock` section cross-links back to `#scanner-auto-detection` and forward from the scanner section's updated callout. The `compare.html` note-row also links to `index.html#autoblock` — verify that anchor exists (it does, added in this task).

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Docs-only task; all four acceptance criteria met across README.md, docs/index.html (new #autoblock section), and docs/compare.html, with all anchors resolving and every load-bearing technical claim matching the v5 implementation.
**Acceptance criteria check:**
- [x] README documents `autoBlock` flag (opt-in boolean, default false; blocks known third-party scripts/iframes until consent without hand-declaring; declared rules win) — `README.md` Features bullet + `## Runtime auto-block (v5)` section incl. "Effective combinations" (declared rules applied first / always win). Default false confirmed against `packages/cookyay/src/config.ts:161,221-224`.
- [x] Hard install requirement stated plainly (bootstrap MUST be first `<script>` in `<head>` or earlier scripts can't be blocked) — README blockquote "The non-negotiable install requirement" + `docs/index.html` `callout-warn` in `#autoblock`.
- [x] v5 scope limits stated (scripts+iframes only; `<img>` pixels + `document.write` deferred; Google tags passed through to Consent Mode v2, not DOM-blocked) — README `### Scope boundaries` + `### Google tags and Consent Mode v2`; mirrored in `docs/index.html #autoblock` and `docs/compare.html` "cannot do" section.
- [x] §3.8 comparison page updated with honest caveats; links/anchors valid — `docs/compare.html`: auto-detection row `~`→`✓`, note-row, "What Cookyay cannot do" (split into scope-limit + load-order items), "When to switch", and differentiators paragraph all updated; new `index.html#autoblock` anchor exists and is cross-linked; all in-page and cross-page anchors verified to resolve.
**Cross-checks:** Scope-compliant (docs-only, no behavior change). Research-compliant: debug log example matches `autoblock-proxy.ts:162` format; CM v2 skip matches runtime-interception research rec #4 and `_index.md` author decisions. Declared-wins skip claim matches `autoblock-proxy.ts:147` (`data-cookyay-state` already set → skipped). No stale "deferred to v5" / "v5 item" text remains in docs. No dead code or debug artifacts.
**Tests:** n/a (docs-only; `## Out of scope` excludes behavior changes).
