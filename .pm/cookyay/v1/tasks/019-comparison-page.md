---
id: "019"
title: Comparison page (§3.8)
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["018"]
prd_refs:
  - "prd.md §3.8"
  - "prd.md §6 (success metric)"
arch_refs: []
research_refs:
  - "research/compliance-and-legal.md §Recommendations 1, 7"
  - "research/domain-expert-cmp.md §Summary (prior art)"
acceptance_criteria:
  - "A docs-site page compares Cookyay vs CookieYes feature-by-feature (banner, blocking, Consent Mode v2, GPC, scanner, consent log, geo-targeting, TCF, dashboards, pricing)"
  - "Contains an explicit 'what Cookyay cannot do' section: no server-side consent log, no IAB TCF, no geo-detection, no hosted dashboard, no legal guarantee (compliance rec 7)"
  - "Mentions the open-source neighbors honestly (vanilla-cookieconsent, Klaro) and what Cookyay adds (scanner, GPC, two-part bootstrap)"
  - "Every claim about Cookyay maps to a shipped v1 feature — no aspirational rows; reviewed against the released feature set"
created: 2026-06-06
---

## Task
Write the honest parity page that is the project's stated success metric: a developer should be able to read it and confidently decide whether they can drop their CookieYes subscription — including when the answer is no.

## Implementation notes
- Source CookieYes's current feature list/pricing at write time; date-stamp the comparison.
- Tone: factual, no marketing fluff — the honesty IS the differentiator (prd §6).

## Out of scope
Comparisons against every CMP (CookieYes is the named benchmark; others get one summary row at most), SEO work.

## Implementation summary
**Files changed:**
- `docs/compare.html` — new page: full feature-by-feature comparison of Cookyay v0.1.0 vs CookieYes (free and paid), a "What Cookyay cannot do" section (server-side log, IAB TCF, geo-detection, hosted dashboard, auto-script detection, built-in translations, legal guarantee), an "Open-source neighbors" section (vanilla-cookieconsent v3 and Klaro with honest summary of what each covers and lacks vs Cookyay), and a "When to switch — and when not to" section with explicit yes/no decision guidance. Date-stamped June 2026 with link to CookieYes pricing page.
- `docs/index.html` — added "vs CookieYes" link in the site nav pointing to `compare.html`.

**Acceptance criteria check:**
- [x] Docs-site page compares Cookyay vs CookieYes feature-by-feature — `docs/compare.html` table covers: banner UI, script/iframe blocking, Consent Mode v2, GPC, scanner, consent log, geo-targeting, TCF, dashboards, pricing. Three columns: Cookyay, CookieYes Free, CookieYes Paid (date-stamped June 2026).
- [x] Contains "what Cookyay cannot do" section — `docs/compare.html#cannot-do`: no server-side consent log (with Art. 7 explanation), no IAB TCF, no geo-detection, no hosted dashboard, no auto-script detection, no built-in translations, no legal guarantee (maps directly to compliance rec 7).
- [x] Mentions open-source neighbors honestly — `docs/compare.html#open-source-neighbors`: vanilla-cookieconsent v3 (what it covers, what it lacks vs Cookyay — no GPC, no scanner, no two-part bootstrap); Klaro! (what it covers, what it lacks — no Consent Mode v2, no GPC, no scanner). Cookyay differentiators called out: scanner, GPC, two-part bootstrap, strictest-everywhere posture.
- [x] Every claim about Cookyay maps to a shipped v1 feature — all tick (✓) claims in the Cookyay column verified against: `packages/cookyay/src/gpc.ts` (GPC detection/toast), `packages/cookyay/src/withdrawal.ts` (withdrawal/reload prompt), `packages/cookyay/src/blocking.ts` (declarative blocking), `packages/cookyay/src/consentmode.ts` (Consent Mode v2), `packages/cookyay/src/bootstrap.ts` (two-part bootstrap), `packages/scanner/` (CLI scanner), architecture.md §2 (size gate), architecture.md §10 (tech stack / no deps). No aspirational rows added.

**Tests:** None — this is a static HTML page; no automated tests applicable. Manual verification: open `docs/compare.html` in a browser and confirm the Cookyay banner appears (dogfooding), the comparison table renders, and all four sections load correctly.

**Notes for verifier:**
- CookieYes GPC status (`✗` for both free and paid tiers) was accurate as of June 2026 per the `domain-expert-cmp.md` research ("No major open-source CMP auto-honors it"). Verify against CookieYes's current feature list before accepting if significant time has passed.
- CookieYes pricing row shows "~$10–$25/month/domain" with a note to verify at cookieyes.com — this is intentionally soft since their pricing changes frequently.
- The "Do Not Sell or Share" row is marked `~` (partial) for Cookyay — the auto-injected "Cookie settings" link is NOT the same as a CCPA-required named "Do Not Sell" link; this is documented honestly in both the table note and the "When to switch" section.
- The page dogfoods Cookyay using the same bootstrap snippet and jsDelivr URL as `docs/index.html` (version `0.1.0`, same SRI hash).

## Re-execution notes — 2026-06-07
**Verifier notes addressed:**
1. Fixed misspelled `cookieyeyes.com` → `cookieyes.com` in `docs/compare.html` line 87 (`href` and visible link text in the date-stamp paragraph) and line 458 (pricing row cell text). Confirmed via `grep -n cookieyeyes docs/compare.html` returning no output.
2. (Optional) Also fixed the same misspelling on line 52 of this task file's "Notes for verifier" section for consistency.

No content changes were made — only the two typo fixes the verifier flagged.

## Verifier notes — 2026-06-07 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Page content is excellent and every Cookyay claim verifies against shipped source, but the CookieYes source domain is misspelled (`cookieyeyes.com`), breaking the one link/citation a reader uses to verify the comparison's honesty — fatal for a page whose whole acceptance bar is being an honest, *sourced* parity story.

**What needs to change:**
1. Fix the misspelled CookieYes domain `cookieyeyes.com` → `cookieyes.com` in `docs/compare.html`:
   - Line 87: `<a href="https://www.cookieyeyes.com/pricing/" ...>cookieyeyes.com/pricing</a>` — this is a live hyperlink that does NOT resolve to CookieYes; both the `href` and the visible link text are wrong. Correct to `https://www.cookieyes.com/pricing/` and `cookieyes.com/pricing`.
   - Line 458: pricing row text "verify at cookieyeyes.com" → "verify at cookieyes.com".
   - There are no other occurrences (`grep -n cookieyeyes docs/compare.html` returns only lines 87 and 458).
2. (Optional, while in the file) The Implementation summary's "Notes for verifier" also reference `cookieyeyes.com`; update those for consistency once the page is fixed, though only the `docs/compare.html` link is load-bearing.

**Acceptance criteria check:**
- [x] Feature-by-feature table vs CookieYes (banner, blocking, Consent Mode v2, GPC, scanner, consent log, geo-targeting, TCF, dashboards, pricing) — `docs/compare.html:114-494`, all named domains present across 3 columns (Cookyay / CookieYes Free / CookieYes Paid), date-stamped June 2026.
- [x] Explicit "what Cookyay cannot do" section — `docs/compare.html:500-571` covers no server-side log (with Art. 7(1) explanation), no IAB TCF, no geo-detection, no hosted dashboard, no auto-script detection, no built-in translations, no legal guarantee. Maps to compliance-and-legal.md rec 7.
- [x] Mentions open-source neighbors honestly — `docs/compare.html:577-653`: vanilla-cookieconsent v3 and Klaro! with what each covers/lacks vs Cookyay; differentiators (scanner, GPC, two-part bootstrap, strictest-everywhere) called out. Matches domain-expert-cmp.md prior-art summary.
- [x] Every Cookyay claim maps to a shipped v1 feature — independently re-verified, all PASS: GPC toast (`gpc.ts`), withdrawal reload prompt (`withdrawal.ts:1-9,145`), declarative blocking + iframe placeholder + node-clone re-exec (`blocking.ts`), Consent Mode v2 four signals + marketing→3-signal mapping (`consentmode.ts:26-29,53-55`), two-part bootstrap inline snippet (matches `bootstrap.ts`), cookie schema `sv,t,pv,bv,c,gpc` exactly matches `consent/types.ts:22-29`, SameSite=Lax + localStorage mirror + 365-day expiry (`consent/storage.ts:11,25,113`), `cookyay:consent` CustomEvent (`events.ts:34`), `autoOpenLink:false` (`banner.ts:421`, `config.ts:137`), `role="switch"` toggles (`preferences.ts:285`), scanner Open Cookie Database + curated GA4/Meta/HotJar/Intercom (`packages/scanner/src/db-ocd.generated.ts`, `classifier.test.ts`). No aspirational rows. The ONE factual defect is the broken CookieYes source link (see above), which is exactly the kind of unverifiable/false citation this criterion's "honest, reviewed" intent guards against.

**Tests:** n/a — static HTML page, no automated test for docs. No suite run; no testable code touched.

**Notes for next executor:** Single-line typo fix in `docs/compare.html` (lines 87 and 458). Everything else on the page is accurate and well-sourced — do NOT rewrite content. The GPC `✗`-for-CookieYes claim is backed by domain-expert-cmp.md ("No major open-source CMP auto-honors it") and is fine. SRI hash and `cookyay@0.1.0` version pin are consistent with `docs/index.html` (dogfood claim holds). After fixing, this is an easy ACCEPT.

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Prior REJECT reason (misspelled `cookieyeyes.com`) is fixed — `grep -rn cookieyeyes docs/` returns nothing and the pricing link/citation now correctly resolves to `cookieyes.com/pricing`; all four acceptance criteria pass and every Cookyay claim independently re-verifies against shipped source.
**Acceptance criteria check:**
- [x] Feature-by-feature table vs CookieYes (banner, blocking, Consent Mode v2, GPC, scanner, consent log, geo-targeting, TCF, dashboards, pricing) — `docs/compare.html:114-494`, 3 columns (Cookyay / CookieYes Free / CookieYes Paid), date-stamped June 2026; CookieYes pricing link now correct (`docs/compare.html:87`).
- [x] Explicit "what Cookyay cannot do" section — `docs/compare.html:500-571`: no server-side log (Art. 7(1)), no IAB TCF, no geo-detection, no hosted dashboard, no auto-script detection, no built-in translations, no legal guarantee. Maps to compliance-and-legal.md rec 7.
- [x] Mentions open-source neighbors honestly — `docs/compare.html:577-653`: vanilla-cookieconsent v3 and Klaro! with covers/lacks vs Cookyay; differentiators (scanner, GPC, two-part bootstrap, strictest-everywhere) called out. Matches domain-expert-cmp.md prior-art summary.
- [x] Every Cookyay claim maps to a shipped v1 feature — independently re-verified: cookie schema `sv,t,pv,bv,c,gpc` (`consent/types.ts:18-28`), SameSite=Lax (`consent/storage.ts:25`), `autoOpenLink:false` (`banner.ts:421`, `config.ts:137`), `role="switch"` toggles (`preferences.ts:285`), `cookyay:consent` CustomEvent (`banner.ts:453`, `consentmode.ts:92`), Consent Mode v2 four signals + marketing→3-ad-signal mapping (`consentmode.ts:26-29,53-55`), GPC confirmation toast (`gpc.ts:1-21`), withdrawal reload prompt (`withdrawal.ts:1-9,145`), scanner Open Cookie Database + curated top-20 (`scanner/src/db.ts:5-15`, `db-ocd.generated.ts`). SRI hash + `cookyay@0.1.0` pin identical to `docs/index.html` (dogfood holds); nav "vs CookieYes" link added (`docs/index.html:48`). No aspirational rows; no debug artifacts/TODOs.
**Tests:** n/a — static HTML page, no automated test for docs; no testable code touched.
