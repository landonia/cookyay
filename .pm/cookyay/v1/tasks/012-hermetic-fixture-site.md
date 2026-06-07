---
id: "012"
title: Hermetic fixture site + service fingerprints
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001"]
prd_refs:
  - "goals.md §Acceptance bar"
  - "prd.md §3.6"
arch_refs:
  - "architecture.md §10 Tech stack (fixtures/)"
research_refs:
  - "research/test-strategist.md §Recommendations 2, 3, 5"
acceptance_criteria:
  - "fixtures/ contains a static multi-page site with synthetic third-party stubs: a fake GA4-style script (sets cookies + fires beacons), a fake pixel, a blocked YouTube-style iframe embed, and a noscript fallback tag"
  - "A shared service-fingerprint JSON (synthetic cookie names + request URL patterns for ~20 common services) lives in one place and is importable by both scanner tests and E2E tests"
  - "Site serves locally with one command (pnpm fixture:serve); no real external network requests anywhere in it"
  - "Fixture pages exercise every blocking case: static script (inline + src), static iframe, undeclared-category script"
created: 2026-06-06
---

## Task
Build the hermetic fixture site that anchors the whole test strategy: the living acceptance test for script blocking (test-strategist rec 2 — "write the fixture page first"), the scanner's integration target, and the shared fingerprint library that keeps test layers from diverging on what "GA4 detected" means.

## Implementation notes
- Pure static files + a tiny static server script; the synthetic trackers mimic fingerprints (cookie names like `_ga`, request paths) without any real vendor code.
- This is also a contributor's entry point — README it briefly.

## Out of scope
The Playwright test suites themselves (013/014), scanner code (015/016), public demo site (018).

## Implementation summary

**Files changed:**
- `fixtures/service-fingerprints.json` — shared JSON with synthetic cookie names + request URL patterns for 20 services (GA4, Meta Pixel, YouTube, LinkedIn, Hotjar, Intercom, HubSpot, Zendesk, Crisp, Drift, Segment, Amplitude, Mixpanel, X Pixel, Clarity, Cloudflare Insights, Vimeo, TikTok, UA, GTM). Importable via `JSON.parse(fs.readFileSync(...))` in both Node scanner tests and Playwright E2E tests.
- `fixtures/stubs/ga4.js` — synthetic GA4 script: sets `_ga` + `_ga_FIXTURE` cookies, fires `navigator.sendBeacon('/fixtures/stubs/collect', ...)`, sets `window.__ga4Ran = true`. No real vendor code.
- `fixtures/stubs/pixel.js` — synthetic Meta Pixel: sets `_fbp` cookie, fires beacon, sets `window.__pixelRan = true`.
- `fixtures/stubs/ytplayer.html` — YouTube-style iframe stub: plain HTML with `window.__ytPlayerLoaded = true`.
- `fixtures/index.html` — entry page; loads cookyay ESM build, links to all sub-pages.
- `fixtures/blocking/inline-script.html` — inline `type="text/plain" data-category="analytics"` case; sets `window.__analyticsInlineRan` on grant.
- `fixtures/blocking/src-script.html` — blocked `src` script cases: GA4 stub (analytics) + Pixel stub (marketing); uses `window.__ga4Ran` / `window.__pixelRan` as execution signals.
- `fixtures/blocking/iframe.html` — blocked `data-src` iframe (YouTube-style, marketing category).
- `fixtures/blocking/undeclared.html` — script with `data-category="advertising"` (unknown); stays blocked, emits console.warn, never sets `window.__undeclaredRan`.
- `fixtures/blocking/all.html` — all five blocking cases on a single page; primary Playwright E2E target.
- `fixtures/noscript.html` — page without any Cookyay scripts; has `<noscript>` notice + inert scripts (type="text/plain") that stay blocked by browser natively.
- `fixtures/styles.css` — minimal local stylesheet; no external fonts or CDN assets.
- `fixtures/serve.mjs` — zero-dependency Node ≥20 static server. Serves from workspace root so `/packages/cookyay/dist/**` and `/fixtures/**` share one origin. Replies `204` to `POST /fixtures/stubs/collect` (beacon sink). No `node_modules` required.
- `fixtures/README.md` — contributor entry point: quick-start, page table, Playwright config snippet.
- `package.json` — added `"fixture:serve": "node fixtures/serve.mjs"` to workspace scripts.

**Acceptance criteria check:**
- [x] `fixtures/` contains a static multi-page site with synthetic third-party stubs: a fake GA4-style script (sets cookies + fires beacons), a fake pixel, a blocked YouTube-style iframe embed, and a noscript fallback tag — satisfied by `fixtures/stubs/ga4.js`, `fixtures/stubs/pixel.js`, `fixtures/blocking/iframe.html` (data-src → ytplayer.html), `fixtures/noscript.html`
- [x] A shared service-fingerprint JSON (synthetic cookie names + request URL patterns for ~20 common services) lives in one place and is importable by both scanner tests and E2E tests — satisfied by `fixtures/service-fingerprints.json` (20 services, verified importable via `JSON.parse(fs.readFileSync(...))`)
- [x] Site serves locally with one command (`pnpm fixture:serve`); no real external network requests anywhere in it — satisfied by `package.json` `fixture:serve` script + `fixtures/serve.mjs` + stubs that only POST to `/fixtures/stubs/collect` (local sink). Server verified working: 200 for HTML/JS/JSON, 204 for POST beacon, 404 for missing files.
- [x] Fixture pages exercise every blocking case: static script (inline + src), static iframe, undeclared-category script — satisfied by `blocking/inline-script.html`, `blocking/src-script.html`, `blocking/iframe.html`, `blocking/undeclared.html`, and `blocking/all.html` (all five in one page)

**Tests:** `pnpm fixture:serve` — manual: navigate to `http://127.0.0.1:4000/fixtures/blocking/all.html`. Automated E2E tests targeting these pages come in task 013.

**Notes for verifier:**
- The IIFE build (`/packages/cookyay/dist/index.iife.js`) and bootstrap (`/packages/cookyay/dist/bootstrap.js`) must be built before serving (`pnpm build` from workspace root). `fixture:serve` does not auto-build.
- `beacon.sendBeacon('/fixtures/stubs/collect', ...)` is fire-and-forget; even if the serve script's 204 reply arrives after the test assertion, the stubs still set their `window.__xxxRan = true` flags synchronously before the beacon call.
- `blocking/all.html` uses `setTimeout(() => ..., 150)` for the status-box updates after grant, matching the `setTimeout(fn, 0)` re-injection in the blocking engine. E2E tests should wait for the status element text or the `window.__xxxRan` flag rather than using fixed waits.
- `service-fingerprints.json` uses glob patterns (e.g. `_ga_*`) for cookie names — the scanner classification engine will need to handle wildcard matching.

## Verifier notes — 2026-06-07 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All four acceptance criteria pass with browser-verified evidence; fixture is fully hermetic (zero external requests observed under Playwright request interception) and exposed a real library gap as a bonus (see note below).

**Acceptance criteria check:**
- [x] Multi-page site with synthetic stubs (GA4-style script setting cookies + firing beacons, fake pixel, blocked YouTube-style iframe, noscript fallback) — verified in headless Chromium: `fixtures/stubs/ga4.js` set `_ga`/`_ga_FIXTURE` and fired beacon to local sink; `pixel.js` set `_fbp`; `blocking/iframe.html` iframe held `data-src` with `data-cookyay-state="blocked"` pre-consent and promoted to `src` post-consent; `<noscript>` present in `noscript.html` + all blocking pages.
- [x] Shared service-fingerprint JSON importable by both test layers — `fixtures/service-fingerprints.json`: exactly 20 services, all entries structurally valid (id/name/category/cookies/requestPatterns), parsed successfully from Node.
- [x] One-command serve, no external network — `pnpm fixture:serve` works (verified on alternate port); Playwright request log recorded **zero** non-localhost requests across full accept-all flow including stub execution.
- [x] Every blocking case exercised — browser-verified on `blocking/all.html`: before consent all run-flags undefined; after Accept-all `__analyticsInlineRan`/`__ga4Ran`/`__pixelRan` all true, iframe src promoted; undeclared `data-category="advertising"` script never ran and emitted the structured `[Cookyay] … unknown category` warning (verified on both `all.html` and `undeclared.html`).

**Tests:** 283/283 unit tests pass (`pnpm test`); manual browser verification via Playwright script (server on :4002).

**Cross-checks:** Scope clean (no Playwright suites, no scanner code, no demo site). Architecture §10 compliant (fixtures/ in monorepo layout, zero new dependencies, Node ≥20 serve script). Research recs 2/3/5 followed (fixture-first, hermetic, shared fingerprint library).

**Minor (non-blocking):** `service-fingerprints.json` has a `$schema` key pointing at the JSON-Schema draft URL, but the file is data, not a schema — some editors will try to validate it as a schema. Suggest renaming to `_comment` or dropping it when task 016 consumes the file.

**Library gap surfaced by this fixture (out of 012's scope, NOT counted against it):** on a return visit with valid stored consent, `mountBanner()` returns early (banner.ts:432-433) and **no code path calls `grant()` for stored-consent categories** — bootstrap only sets Consent Mode signals. Result: blocked scripts/iframes never execute for returning visitors. Verified in-browser: after reload with `cookyay_consent` present, banner correctly stays hidden but `window.__ga4Ran` stays undefined. This is a defect in the grant/return-visit path (tasks 005/007, both `done`). Task 013's E2E suite MUST include a reload-persistence test and will fail until this is fixed.

**Update 2026-06-07:** fixed same day — see `## Post-acceptance fix — 2026-06-07` in task 006. `_replayStoredGrants()` added to `api.ts` init path; verified in-browser against this fixture (accept → reload → scripts re-execute; reject → reload → stays blocked). Task 013 should still include the reload-persistence E2E test as a regression guard.
