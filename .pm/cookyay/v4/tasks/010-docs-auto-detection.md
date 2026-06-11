---
id: 010
title: Docs — README + comparison page for auto-detect + reCAPTCHA gating note
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["007"]
complexity: 2
prd_refs:
  - "prd.md §3.8"
  - "goals.md §What ships in v4"
  - "prd.md §3.3"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 2)"
test_refs: []
research_refs:
  - "research/domain-expert-trackers.md §Update — 2026-06-10 (Q2)"
acceptance_criteria:
  - "The scanner README documents the auto-detection workflow: run the scanner → review suggestedBlocking[] → paste the snippets into the site HTML, including a worked example of an emitted snippet."
  - "The §3.8 comparison page reflects that Cookyay now auto-detects ~50 known third parties (scanner-side), and is honest that runtime auto-block is not done (deferred)."
  - "A clearly-worded note explains the reCAPTCHA-as-functional trade-off: forms protected by reCAPTCHA are gated until the visitor consents to functional cookies [prd.md §3.3], and how an owner can reclassify if they accept the risk."
  - "Docs build/links check passes (no broken anchors); confidence levels (high/medium/low) are explained so owners can triage suggestedBlocking entries."
created: 2026-06-10
---

## Task
Document the new auto-detection workflow so a developer can actually use it, and
keep the honest-parity story current [prd.md §3.8]. Cover the scan → review →
paste loop, explain confidence levels, and surface the reCAPTCHA form-gating
trade-off the SME flagged [research/domain-expert-trackers.md Q2].

## Implementation notes
- Update the scanner package README and the docs/ comparison page. Show a real
  emitted `suggestedBlocking` entry and the snippet a user pastes.
- Be explicit about the v4 boundary: detection + suggested markup is scanner-side;
  the banner still blocks only what's in the page's declared markup (no runtime
  auto-block) — this is the deferred v5 item, state it plainly.
- Keep the "not legal advice" stance; the reCAPTCHA note is guidance, not a ruling.

## Out of scope
- Any code/behavior change — docs only. Marketing copy beyond the comparison page.

## Implementation summary
**Files changed:**
- `packages/scanner/README.md` — Created new scanner package README (did not exist before). Documents the full auto-detection workflow (scan → review `suggestedBlocking[]` → paste snippets), a worked example of an emitted `suggestedBlocking` entry including the verbatim snippet, a confidence-level table (high/medium/low with meanings and examples), the reCAPTCHA-as-functional trade-off with reclassification guidance, and the full output format field table.
- `docs/index.html` — Rewrote the CLI scanner section (#scanner) to: describe auto-detection of ~50 known services, add three new anchored subsections (`#scanner-auto-detection`, `#scanner-confidence`, `#scanner-recaptcha`), include an output example showing `suggestedBlocking[]`, add the confidence-level table, add the reCAPTCHA form-gating callout with reclassification guidance, and replace the old single-paragraph confidence description. Updated the TOC entry to link to all three subsections.
- `docs/compare.html` — Updated the feature table: version heading from "v0.1.0" to "v4", cookie database row to say "~50 known services", auto-detection row from `✗` to `~` with honest note that scanner detects ~50 third parties / emits snippets but runtime auto-block is deferred to v5, expanded note row with link to `index.html#scanner-auto-detection`. Updated "cannot do" section: replaced "No automatic script detection" with "No runtime auto-block (v5 item)" that accurately describes the v4 state. Updated "when to switch" section to mention the scanner auto-detection and the HTML-editing requirement. Updated open-source neighbors summary paragraph to mention auto-detection of ~50 third parties.

**Acceptance criteria check:**
- [x] The scanner README documents the auto-detection workflow: run the scanner → review `suggestedBlocking[]` → paste the snippets into the site HTML, including a worked example of an emitted snippet — satisfied by `packages/scanner/README.md` §Auto-detection workflow (Steps 1–3), including a full JSON example at lines 63–105 and a paste example at lines 118–135.
- [x] The §3.8 comparison page reflects that Cookyay now auto-detects ~50 known third parties (scanner-side), and is honest that runtime auto-block is not done (deferred) — satisfied by `docs/compare.html`: auto-detection row now shows `~` with text "Scanner auto-detects ~50 known third parties and emits copy-paste blocking snippets; runtime auto-block deferred to v5" and expanded note row; "cannot do" section updated to "No runtime auto-block (v5 item)".
- [x] A clearly-worded note explains the reCAPTCHA-as-functional trade-off: forms protected by reCAPTCHA are gated until the visitor consents to functional cookies, and how an owner can reclassify if they accept the risk — satisfied by `packages/scanner/README.md` §reCAPTCHA and form-gating trade-off (lines 166–201) and `docs/index.html` §scanner-recaptcha (lines 764–793), both including the reclassification guidance callout.
- [x] Docs build/links check passes (no broken anchors); confidence levels (high/medium/low) are explained so owners can triage suggestedBlocking entries — `#scanner-auto-detection`, `#scanner-confidence`, `#scanner-recaptcha` anchors verified to exist in `docs/index.html`; `index.html#scanner-auto-detection` link in `docs/compare.html` verified. Confidence table in both README (lines 149–164) and `docs/index.html` (lines 724–757).

**Tests:** Docs-only task; no test suite applicable. Verified anchor consistency with grep.

**Notes for verifier:** The `docs/index.html` scanner section previously described confidence levels with one sentence ("high = exact cookie name matched…") using slightly different semantics than the v4 confidence model (which is "two independent signals agree = high", not "exact cookie name = high"). The updated table reflects the v4 semantics from `architecture.md §Amendments 2026-06-10 change 1`. The old phrasing was technically inaccurate under v4; the new table is accurate.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Docs-only task fully delivered — README + index.html + compare.html document the scan→review→paste workflow, confidence model, and reCAPTCHA trade-off; all documented claims verified against the actual emitter/classifier source, and all internal + cross-file anchors resolve.
**Acceptance criteria check:**
- [x] README documents auto-detection workflow with worked snippet example — `packages/scanner/README.md:37-145` (Steps 1-3, full JSON example, script + iframe paste examples). Snippet format (`<script type="text/plain" data-category="..." src="...">` / `<iframe data-src="..." data-category="...">`) matches `config-emitter.ts:229-250` exactly.
- [x] §3.8 comparison page reflects ~50 auto-detected third parties, honest about deferred runtime auto-block — `docs/compare.html:233-247` (auto-detection row now `~` with explicit "runtime auto-block deferred to v5"), `:552-564` ("No runtime auto-block (v5 item)"), version heading updated to v4 (`:118,128`).
- [x] reCAPTCHA-as-functional trade-off note with reclassification guidance — `packages/scanner/README.md:166-201` and `docs/index.html:764-792`; both state forms are gated until functional consent and document the reclassify-as-necessary escape with a "not legal advice" caveat. Aligns with research Q2 resolution and prd.md §3.3.
- [x] Docs links check passes; confidence levels explained — validated all internal `href="#..."` anchors in both HTML files resolve to existing ids; cross-file `index.html#scanner-*`, `#compliance`, `#config-reference`, `#quickstart`, `#script-blocking` all exist in index.html. Confidence table (high/medium/low) present in `README.md:154-158` and `docs/index.html:731-756`; semantics match the v4 "two signals agree = high" model in `classifier.ts:6-12`.
**Tests:** n/a — docs-only; no testable code changed. Documented claims independently re-verified against source.
