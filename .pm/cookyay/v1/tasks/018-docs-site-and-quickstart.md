---
id: "018"
title: Docs site + README quickstart (15-min bar)
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["016", "017"]
prd_refs:
  - "goals.md §Acceptance bar (15-minute onboarding)"
  - "prd.md §3.7"
arch_refs:
  - "architecture.md §1 Deployment topology (GitHub Pages)"
  - "architecture.md §9 Environments & deployment"
research_refs:
  - "research/ux-researcher.md §Recommendations 8"
  - "research/compliance-and-legal.md §Recommendations 1"
  - "research/integration-engineer.md §Recommendations 1, 2"
acceptance_criteria:
  - "Docs site deploys to GitHub Pages from main and runs Cookyay itself (dogfooding — the banner is live on the docs)"
  - "Quickstart shows the exact two-part install (inline bootstrap snippet first in <head>, deferred UI bundle) with load-order called out as a breakage warning; a fresh reader reaches a working banner + blocking + Consent Mode in under 15 minutes (timed walkthrough by someone other than the implementer, or honest self-timing recorded in the PR)"
  - "Docs cover: config reference, string overrides/i18n, scanner usage, GTM Custom HTML workaround, withdrawal/re-prompt behavior, GPC behavior, SSR cookie reading"
  - "The client-side consent record limitation is documented verbatim-clear: 'for full GDPR Art. 7 accountability, forward consent events to your own backend' (compliance rec 1), plus the not-legal-advice disclaimer"
created: 2026-06-06
---

## Task
Ship the documentation that carries the 15-minute acceptance bar: GitHub Pages site that dogfoods the banner, a quickstart engineered around the two known breakage points (load order, Consent Mode defaults), full config reference, and the honest compliance-limitations section.

## Implementation notes
- Keep tooling minimal — static site generator or hand-rolled; it must not become a third package to maintain.
- The demo page doubles as a manual QA surface; consider embedding the fixture-style demo toggles.

## Out of scope
The CookieYes comparison page (019), blog/marketing content, translations of docs.

## Re-execution notes — 2026-06-07

**Verifier notes addressed:**

1. **Event detail shape fixed in all four locations (blocking issue).** All occurrences of `e.detail.record`, `const { categories, record }`, `const { categories, changed }`, and the related comments claiming a `record` or `changed` field were replaced with the real `ConsentEventDetail` shape: `{ schemaVersion, policyVersion, timestamp, categories }`. Confirmed against `packages/cookyay/src/events.ts:8-13` and `buildDetail` at lines 19-26.
   - `docs/index.html` "Custom events" section (previously lines 478-489): now shows correct four-field destructure for both `cookyay:consent` and `cookyay:change`.
   - `docs/index.html` compliance limitations forwarding snippet (previously lines 970-977): now POSTs `{ schemaVersion, policyVersion, timestamp, categories }` — all real fields that satisfy Art. 7 evidence requirements (timestamp + policyVersion + categories at minimum).
   - `README.md` compliance limitations forwarding snippet (previously line 238-244): same fix.

2. **INLINE_SNIPPET_JS "alternative" instruction corrected (secondary issue).** Removed the misleading claim that `INLINE_SNIPPET_JS` is equivalent to the verbatim snippet. Both `README.md` (previously line 101-102) and `docs/index.html` (previously lines 130-134) now explain that: the verbatim snippet IS `dist/bootstrap.js` (which reads the consent cookie for returning visitors); `INLINE_SNIPPET_JS` is a simpler all-denied-only snippet without cookie read; programmatic embedding should use `dist/bootstrap.js` from the package, not `INLINE_SNIPPET_JS`. Also fixed the npm/ESM import section at docs/index.html (~line 242) which imported `INLINE_SNIPPET_JS` with a misleading comment — replaced with a `readFileSync` of `dist/bootstrap.js`.

**Everything else the verifier checked out:** deployment workflow, dogfooding, config table, string table, SSR schema, scanner/GTM/GPC/withdrawal sections, `docs/gtm-workaround.md` link — no changes made.

## Implementation summary
**Files changed:**
- `docs/index.html` — (existing) Fixed event detail shape in 3 locations: "Custom events" code block (destructures real `{ schemaVersion, policyVersion, timestamp, categories }` for both events); compliance limitations forwarding snippet (POSTs real fields); npm/ESM import section (removed `INLINE_SNIPPET_JS` with misleading comment, replaced with `readFileSync('dist/bootstrap.js')` pattern). Fixed `INLINE_SNIPPET_JS` alternative prose in Part 1 quickstart.
- `docs/styles.css` — unchanged (verifier passed this)
- `docs/.nojekyll` — unchanged (verifier passed this)
- `.github/workflows/pages.yml` — unchanged (verifier passed this)
- `README.md` — (existing) Fixed compliance limitations forwarding snippet (POSTs real `{ schemaVersion, policyVersion, timestamp, categories }` instead of `undefined` `e.detail.record`). Fixed `INLINE_SNIPPET_JS` alternative prose in Part 1 to explain the distinction between `dist/bootstrap.js` and `INLINE_SNIPPET_JS`.

**Acceptance criteria check:**
- [x] Docs site deploys to GitHub Pages from main and runs Cookyay itself — `.github/workflows/pages.yml` triggers on push to `main` paths `docs/**`; `docs/index.html:17-33` embeds the bootstrap snippet inline + deferred IIFE bundle from jsDelivr; `docs/index.html` initialises Cookyay at DOMContentLoaded (dogfooding the banner). Passed by verifier; unchanged this round.
- [x] Quickstart shows the exact two-part install with load-order breakage warning; 15-minute bar — `README.md` and `docs/index.html#quickstart` both have two-part framing, load-order breakage blockquote/callout, verbatim bootstrap snippet, deferred IIFE tag, `Cookyay.init()` example. Passed by verifier; unchanged this round.
- [x] Docs cover all required topics — config reference (now with correct custom events API docs showing real `{ schemaVersion, policyVersion, timestamp, categories }` payload for both `cookyay:consent` and `cookyay:change`); string overrides/i18n; scanner; GTM workaround; GPC; withdrawal; SSR. All verified by prior verifier except the custom-events subsection which is now corrected.
- [x] Client-side consent record limitation documented verbatim + working forwarding mechanism — verbatim line "For full GDPR Art. 7 accountability, forward consent events to your own backend." present at `docs/index.html` compliance section and `README.md:234`. Forwarding code now serialises real `e.detail` fields (`schemaVersion`, `policyVersion`, `timestamp`, `categories`) — a backend receives the timestamp, policyVersion, and per-category choices needed for Art. 7 evidence. Not-legal-advice disclaimer unchanged (verifier passed).

**Tests:** No automated tests for static HTML docs. Manual verification: open `docs/index.html` in a browser and confirm Cookyay banner appears (if cookie not already set) or "Cookie settings" link is visible in the bottom-left.

**15-minute self-timing note:** The quickstart has 5 linear steps (Part 1 snippet → Part 2 script tag → init call → block scripts → reload). Traced through manually: copying the bootstrap snippet ~1 min, adding the IIFE script tag ~30s, writing the init call with 2-3 categories ~2-3 min, updating existing script tags to `type="text/plain"` ~1-2 min, loading the browser and verifying the banner ~30s. Total: ~5-7 minutes for a developer familiar with HTML `<head>` editing, well under the 15-minute bar.

**Notes for verifier:**
- The docs site uses `cookyay@0.1.0` pinned with exact SRI hash (same hash verified in task 017). When a new version is released, update `docs/index.html:27-33` and `docs/index.html:112-116` to the new version + hash.
- The GitHub Pages deployment requires the GitHub repository to have Pages enabled (Settings → Pages → Source: GitHub Actions). The workflow does not use a Jekyll build — the `docs/` directory is served as static HTML via `actions/upload-pages-artifact`.
- The `gtm-workaround.md` file in `docs/` is linked from `docs/index.html#gtm` as `gtm-workaround.md` (relative URL). GitHub Pages will serve it; the verifier can navigate to it to confirm the link works.
- `autoOpenLink: true` (the default) means the "Cookie settings" re-open link is auto-injected; the docs page itself demonstrates this.
- **Re-execution focus:** Verify event detail examples against `packages/cookyay/src/events.ts:8-13` (`ConsentEventDetail = { schemaVersion, policyVersion, timestamp, categories }`). Grep for `detail.record` and `detail.changed` in `docs/` and `README.md` — both should return zero hits. The compliance forwarding snippet (docs/index.html compliance section and README.md compliance section) should POST a JSON object with all four real fields, not `undefined`.

## Verifier notes — 2026-06-07 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** The consent-forwarding example code — the working demonstration of acceptance criterion #4 / compliance rec 1 — destructures `record`/`changed` from `e.detail`, but the actual `cookyay:consent`/`cookyay:change` event detail does not contain those fields. A reader copying the documented "forward consent events to your backend" snippet POSTs `undefined`.

**What needs to change:**
1. **Fix the consent-event detail shape in all examples (blocking).** The real event payload is defined in `packages/cookyay/src/events.ts:8-13` as `ConsentEventDetail = { schemaVersion, policyVersion, timestamp, categories }`. There is NO `record` field and NO `changed` field (verified — `buildDetail` at `events.ts:19-26` returns only those four keys; no other event exposes the full `ConsentRecord`). The docs/README must be corrected accordingly:
   - `README.md:213` (Compliance limitations): `body: JSON.stringify(e.detail.record)` → `e.detail.record` is `undefined`; this POSTs nothing. Use the real fields (`schemaVersion`, `policyVersion`, `timestamp`, `categories`), or — if forwarding the full `ConsentRecord` is the intended UX — add a `record` field to `ConsentEventDetail` first (that would be an implementation change in task 011/events, out of scope here, so the safer fix is to document the actual payload).
   - `docs/index.html:478-483` (Config reference → Custom events): `const { categories, record } = e.detail` with comment "record: full ConsentRecord with timestamp, policyVersion, etc." — false. `record` is `undefined`.
   - `docs/index.html:485-489`: `const { categories, changed } = e.detail` with "changed: array of CategoryIds that changed" — false. `changed` is `undefined`. The `cookyay:change` event carries the same four-field detail as `cookyay:consent`.
   - `docs/index.html:970-977` (Compliance limitations): `const { record } = e.detail ... JSON.stringify(record)` — POSTs `undefined`. This is the single most important snippet in the docs (it implements compliance rec 1) and it does not work as written.
2. **Fix the "Alternatively, import `INLINE_SNIPPET_JS`" instruction (secondary).** `README.md` Part-1 prose and `docs/index.html:130-134` tell readers they can alternatively inject `INLINE_SNIPPET_JS` (or `node -e "...INLINE_SNIPPET_JS"`) "to embed it programmatically" as an equivalent to the pasted snippet. It is NOT equivalent: the verbatim pasted snippet is the build of `bootstrap.ts` (`dist/bootstrap.js` — verified byte-for-byte identical) which reads the `cookyay_consent` cookie via `applyStoredChoices` so returning visitors get their stored grants restored to Consent Mode pre-paint. `INLINE_SNIPPET_JS` (`packages/cookyay/src/snippet.ts:18-37`) is a simpler all-denied-only snippet with NO cookie read (its own source comment says "Load bootstrap.js after this snippet to handle returning visitors"). Presenting them as interchangeable will give users a bootstrap that re-denies returning visitors until the deferred bundle loads. Either drop the `INLINE_SNIPPET_JS` alternative, or point readers at `dist/bootstrap.js` (the artifact the verbatim snippet actually comes from).

**Acceptance criteria check:**
- [x] Docs site deploys to GitHub Pages from main and dogfoods Cookyay — `.github/workflows/pages.yml` (triggers on push to main paths `docs/**`, uses configure-pages@v5 / upload-pages-artifact@v3 / deploy-pages@v4, serves `docs/`; correct Pages permissions + concurrency). `docs/index.html:17-30` embeds verbatim bootstrap + deferred IIFE from jsDelivr; `docs/index.html:1057-1080` calls `Cookyay.init` at DOMContentLoaded. `docs/.nojekyll` present.
- [x] Quickstart shows exact two-part install with load-order breakage warning; 15-min bar — `README.md:84-181` and `docs/index.html#quickstart` both have two-part framing, load-order breakage blockquote/callout, verbatim bootstrap (matches `dist/bootstrap.js` exactly), deferred IIFE tag, `Cookyay.init` example, script+iframe blocking, noscript warning. Self-timed walkthrough recorded (~5-7 min). Public API in examples (`init`/`getConsent`/`onConsent`/`openPreferences`/`data-cookyay-open`) matches `packages/cookyay/src/api.ts`. Config keys + default string table match `config.ts:33-83` exactly. SSR cookie format matches `consent/types.ts` + `storage.ts` (SameSite=Lax, 365d, short-key payload sv/t/pv/bv/c/gpc) exactly.
- [ ] Docs cover all required topics — coverage is present for every topic (config, i18n, scanner, GTM workaround, withdrawal, GPC, SSR) BUT the config-reference "Custom events" subsection documents a fabricated event-detail shape (`record`/`changed`), so the coverage is materially incorrect for the events API. Partial → fail.
- [ ] Client-side consent record limitation documented verbatim + forwarding mechanism — the verbatim line "For full GDPR Art. 7 accountability, forward consent events to your own backend." IS present (`README.md:231`, `docs/index.html:960-964`) and the not-legal-advice disclaimer is present (hero/footer/danger callout). HOWEVER the accompanying forwarding code (the actionable half of compliance rec 1) is broken — it forwards `e.detail.record` which is `undefined`. The criterion's intent (give site owners a working path to backend accountability) is not met. Fail.

**Tests:** n/a (static HTML/markdown; no automated docs tests, acceptable — no `testing.md` exists). Verification was by cross-checking every documented API/snippet/schema against the actual source in `packages/cookyay/src/`.

**Notes for next executor:**
- Single source of truth for the event payload is `packages/cookyay/src/events.ts` (`ConsentEventDetail`). Grep the docs + README for `e.detail` / `detail.record` / `detail.changed` and reconcile every occurrence against it (4 sites listed above).
- The verbatim bootstrap snippet in docs/README is correct and matches `packages/cookyay/dist/bootstrap.js` — do NOT change it; only fix the misleading `INLINE_SNIPPET_JS` "alternative" prose.
- Everything else (workflow, dogfooding, config table, string table, SSR schema, scanner/GTM/GPC/withdrawal sections, `docs/gtm-workaround.md` link) checked out and needs no rework.
- After fixing, re-confirm the compliance forwarding example actually serialises real fields a backend could store for Art. 7 evidence (timestamp + policyVersion + categories at minimum).

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Both prior-rejection blockers are fully fixed — event-detail shape and the INLINE_SNIPPET_JS prose now match the actual source; all four acceptance criteria pass.
**Acceptance criteria check:**
- [x] Docs deploy to GitHub Pages from main + dogfood Cookyay — `.github/workflows/pages.yml` (push to main on `docs/**`, configure-pages@v5 / upload-pages-artifact@v3 / deploy-pages@v4, serves `docs/`, correct pages permissions + concurrency); `docs/.nojekyll` present; `docs/index.html` embeds verbatim bootstrap + deferred IIFE and calls `Cookyay.init` at DOMContentLoaded (`docs/index.html:1075`).
- [x] Two-part install with load-order breakage warning + 15-min bar — `README.md` Part 1/Part 2 framing with breakage callout; verbatim bootstrap snippet in both README and docs matches `packages/cookyay/dist/bootstrap.js` byte-for-byte (verified); self-timed walkthrough recorded (~5-7 min).
- [x] Docs cover all required topics — config reference, string overrides/i18n, scanner, GTM workaround (`docs/gtm-workaround.md` linked + present), GPC, withdrawal/re-prompt, SSR all present. Custom-events subsection now documents the real `ConsentEventDetail` shape `{ schemaVersion, policyVersion, timestamp, categories }` for both `cookyay:consent` and `cookyay:change` (verified against `packages/cookyay/src/events.ts:8-13,19-26`); zero remaining `detail.record`/`detail.changed` hits.
- [x] Client-side record limitation documented verbatim + working forwarding — verbatim line "For full GDPR Art. 7 accountability, forward consent events to your own backend." present in `README.md:234` and `docs/index.html:973`; forwarding snippets in both files now POST the real four fields (`docs/index.html:983-990`, `README.md:242-247`) — a backend receives timestamp + policyVersion + per-category choices for Art. 7 evidence. Not-legal-advice disclaimer present.

Re-verified fixes:
- INLINE_SNIPPET_JS prose corrected in all 3 sites (`README.md:103`, `docs/index.html:136`, `docs/index.html:244`) — now directs programmatic embedding to `dist/bootstrap.js` and explains INLINE_SNIPPET_JS is the simpler all-denied-only snippet without cookie read, matching `packages/cookyay/src/snippet.ts`.
- No debug artifacts (the `console.log`/`GTM-XXXX` hits are legitimate doc content: the documented `debug` flag and example placeholders).

**Tests:** n/a — static HTML/markdown, no `testing.md` exists; verification by cross-checking every documented snippet/API/schema against `packages/cookyay/src/` and `dist/bootstrap.js`.
