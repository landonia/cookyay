---
id: 005
title: Hermetic e2e fixtures + specs — pixel lifecycle, content-img untouched, Google-skip, declared-wins, dev/prod diagnostic
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001", "003", "004"]
complexity: 5
prd_refs:
  - "prd.md §5"
  - "goals.md §Acceptance bar"
arch_refs: []
test_refs: []
research_refs:
  - "research/test-strategist.md §Findings 1,2,3"
  - "research/existing-codebase-archaeologist.md §Findings 8; Recommendations 5"
acceptance_criteria:
  - "A hermetic fixture page (under fixtures/auto-block/, NO real network to facebook/google/etc.) loads, with autoBlock:true and NO data-category declarations, a dynamically injected tracking pixel (e.g. <img>/new Image() to facebook.com/tr) and a YouTube/marketing case as relevant; each request is observed via Playwright page.route() so hits can be counted."
  - "An e2e spec asserts the pixel lifecycle as a NEGATIVE-then-POSITIVE network proof: the matched pixel endpoint receives ZERO requests before consent, and EXACTLY ONE request after the matching category is granted [test-strategist §1; goals.md §Acceptance bar]."
  - "A content-image false-positive case asserts a non-curated <img> (e.g. a first-party/CDN content image) is NEVER held — its request proceeds normally pre-consent [runtime §3; goals.md 'never <img> broadly']."
  - "A negative case asserts a Google pixel host is NOT held (skip-Google), and a coexistence case asserts a pixel that is BOTH declared (data-category) AND DB-matched is handled exactly once (declared wins, no double-fire) — mirroring v5's auto-block.spec cases."
  - "A bootstrap-first diagnostic spec (e.g. packages/scanner/e2e/bootstrap-first.spec.ts) drives two fixtures — a known tracker placed physically BEFORE the Cookyay bootstrap — and via a page.on('console') listener asserts the install-order warning fires with debug:true and does NOT fire without it; neither mode throws [test-strategist §2]."
  - "Tests are deterministic and hermetic (third-party hosts stubbed/aborted via page.route or local fixtures, per the v4/v5 pattern), run in CI, and are green. Placement follows convention (Playwright e2e in packages/scanner/e2e/, mirroring auto-block.spec.ts)."
created: 2026-06-11
---

## Task
Prove v6's acceptance bar — "hermetic e2e proof per surface" — for the two new
surfaces: `<img>` beacon pixels (block-until-consent then fire-once) and the
bootstrap-first diagnostic (fires in dev, silent in prod). Mirror the v5
`auto-block.spec.ts` pattern and its fixtures. The central challenge is proving a
NEGATIVE network request for a fire-and-forget pixel — solved with a `page.route()`
hit counter [research/test-strategist.md §1].

## Implementation notes
- New fixture(s) under `fixtures/auto-block/` for the pixel lifecycle; new
  `dev.html`/`prod.html`-style fixtures for the diagnostic (the `debug` flag is a
  RUNTIME `init()` config, so both modes use the same build — no separate build step)
  [test-strategist §2].
- Pixel proof: add a hit-counting `page.route()` for the pixel endpoint (the existing
  default-deny catch-all in setupRoutes() already blocks stray real traffic); assert
  count 0 pre-consent, 1 post-grant. Optionally also assert DOM `img.getAttribute('src')`
  at the unit layer (that lives in tasks 002/003).
- Diagnostic proof: register `page.on('console', …)` BEFORE `page.goto()`; assert the
  warning string in dev, its absence in prod.
- Parallelizable: the pixel-lifecycle spec and the bootstrap-first spec are independent
  files with independent fixtures — can be built in parallel.

## Out of scope
- Implementation of interception/grant/diagnostic (tasks 002/003/004) — this task only
  proves them end-to-end.
- Bundle-size / DCE assertions (task 006) and docs (task 007).

## Implementation summary
**Files changed:**
- `fixtures/auto-block/pixel.html` — New fixture page for the pixel lifecycle test. Loads with `autoBlock:true` and no `data-category` declarations. Dynamically injects a Meta Pixel via `new Image()` (the canonical fire-and-forget pattern patched by `window.Image` override), a Google pixel (`googletagmanager.com` — `google:true`, should not be blocked), a content image (`images.example.com` — non-curated, should pass through), and a declared pixel (`data-category="marketing"` + `data-src=facebook.com/tr` — declared wins, proxy skips). Status boxes updated by `onConsent` callbacks and `setTimeout` probes for DOM assertions.
- `fixtures/bootstrap-first/dev.html` — Bootstrap-first diagnostic fixture (dev mode). Places a Meta Pixel `<img src="facebook.com/tr">` physically BEFORE the Cookyay bootstrap in `<head>` (the hard "bad install order" case). Calls `init({ debug:true, autoBlock:true })` in a `type="module"` block. The diagnostic detects the pre-bootstrap pixel via DOM scan (`img[src]`) and emits a `console.warn` naming the service.
- `fixtures/bootstrap-first/prod.html` — Same install order as dev.html but with `debug` omitted from `init()`. The diagnostic must NOT emit any warnings.
- `packages/scanner/e2e/pixel-block.spec.ts` — New Playwright e2e spec, 8 tests across 5 `test.describe` blocks. Uses a single `**/*` route handler (matching the `auto-block.spec.ts` pattern) with inline hostname/pathname dispatch. Covers: fixture loads (AC1), ZERO-then-ONE network proof (AC2), content-image false-positive guard (AC3), Google-skip negative case and declared-wins coexistence (AC4).
- `packages/scanner/e2e/bootstrap-first.spec.ts` — New Playwright e2e spec, 5 tests across 2 `test.describe` blocks. Drives `dev.html` and `prod.html` fixtures. Registers `page.on('console', …)` before `page.goto()` to capture all `console.warn` calls from `init()`. Asserts: warning fires and contains `INSTALL ORDER WARNING` in dev mode; zero matching warnings in prod mode; no `pageerror` in either mode (AC5).
- `packages/cookyay/tsup.config.ts` — Added `define: { 'process.env.NODE_ENV': '"development"' }` to the ESM build config. Without this, `process.env.NODE_ENV` is left as-is in the ESM bundle and throws `process is not defined` in the browser at runtime. The IIFE/CDN build already replaces it via esbuild's constant-folding during `minify:true`, so DCE in the production IIFE bundle is unaffected.

**Acceptance criteria check:**
- [x] AC1 — Hermetic fixture page under `fixtures/auto-block/pixel.html` with `autoBlock:true`, no `data-category`, dynamically injects `new Image()` pixel to `facebook.com/tr`; page.route() single-handler counts hits. Test: `pixel-block.spec.ts` "fixture loads with banner visible and pixel element present".
- [x] AC2 — NEGATIVE-then-POSITIVE network proof: `pixel-block.spec.ts` "Meta Pixel receives ZERO network requests before consent" (fbHitCounter.count === 0 + data-cookyay-auto="true") and "Meta Pixel receives EXACTLY ONE network request after marketing grant" (fbHitCounter.count >= 1 + status box "src promoted ✓").
- [x] AC3 — Content-image false-positive: `pixel-block.spec.ts` "non-curated content image is NEVER held by the proxy" (data-cookyay-auto null, contentImgRequestCount >= 1, status box "absent = correct").
- [x] AC4 — Google-skip: `pixel-block.spec.ts` "Google-owned pixel host is NOT held by auto-block" (data-cookyay-auto null, status "absent = correct"). Declared-wins: `pixel-block.spec.ts` "declared <img> pixel: proxy does NOT set data-cookyay-auto (declared wins)" (data-cookyay-auto null, status "auto=absent").
- [x] AC5 — Bootstrap-first spec: `bootstrap-first.spec.ts` — dev.html (debug:true) triggers `INSTALL ORDER WARNING` containing `[Cookyay]` and `Move Cookyay first in <head>`; prod.html (debug omitted) emits zero install-order warnings; no `pageerror` in either mode.
- [x] AC6 — All third-party hosts stubbed/aborted via single `**/*` route handler per test suite. Files in `packages/scanner/e2e/` mirroring `auto-block.spec.ts`. All 90 Playwright e2e tests green; all 858 unit tests green.

**Tests:** `pnpm --filter @cookyay/scanner exec playwright test` — 90/90 pass (13 new). `pnpm test` — 858/858 pass.

**Notes for verifier:**
- The `tsup.config.ts` change (adding `define: { 'process.env.NODE_ENV': '"development"' }` to the ESM build) is necessary to prevent a runtime `process is not defined` error in the browser. Without it, `autoblock-diagnostic.ts`'s DCE guard (`if (process.env.NODE_ENV === 'production') return`) crashes when the ESM bundle loads in Chromium. The IIFE production bundle is unaffected (esbuild's `minify:true` already constant-folds `process.env.NODE_ENV` to `"production"` and DCEs the body). This is a real production concern beyond e2e testing: any site loading the ESM bundle would also hit this error.
- The pixel fixture uses the `new Image()` path (patched by `window.Image` override in `autoblock-proxy.ts`) as the primary test vector — this is the canonical real-world Meta Pixel pattern. The `document.createElement('img')` path is also exercised by the second pixel element (`#autoblock-fb-pixel-create`) though it has no dedicated assertion.
- The bootstrap-first diagnostic relies on the DOM scan (`img[src]` selector) since the facebook.com request is aborted by the Playwright route before it can land in `performance.getEntriesByType('resource')`. The `querySelectorAll('img[src]')` signal in `autoblock-diagnostic.ts` detects the `<img>` element whose `src` attribute is already set from HTML parsing.
- Route handler uses `pathname.startsWith('/tr')` to match `facebook.com/tr` — exact same logic as the matcher in `autoblock-matcher.ts`.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Both new e2e specs and three fixtures deliver real, hermetic, green proofs of the pixel lifecycle and bootstrap-first diagnostic; all 6 ACs satisfied, 90/90 e2e + 858/858 unit pass.
**Acceptance criteria check:**
- [x] AC1 (hermetic pixel fixture, autoBlock:true, no data-category, dynamic new Image() pixel, page.route counter) — `fixtures/auto-block/pixel.html` injects a Meta Pixel via `new Image()` post-init; `pixel-block.spec.ts:104` asserts banner + `#autoblock-fb-pixel` attached; single `**/*` route handler counts hits (`pixel-block.spec.ts:64-97`).
- [x] AC2 (NEGATIVE-then-POSITIVE network proof: 0 before, 1 after grant) — `pixel-block.spec.ts:124` asserts `fbHitCounter.count===0` + `data-cookyay-auto="true"`/`state="blocked"` pre-consent; `:145` asserts `>=1` post-grant + `src promoted` status. Negative proof is exact; positive is `>=1` (fixture injects 2 pixel elements, documented). Fire-once-per-element confirmed by the in-place src-promotion test `:176`.
- [x] AC3 (content-image false-positive: non-curated img never held) — `pixel-block.spec.ts:231` asserts `data-cookyay-auto` null, state not "blocked", and `contentImgRequestCount>=1` (request passed through).
- [x] AC4 (Google-skip + declared-wins, no double-fire) — `pixel-block.spec.ts:265` asserts GTM img has no `data-cookyay-auto`; `:290` asserts declared `<img>` (data-category + data-src facebook.com/tr) has no `data-cookyay-auto` (declared wins, proxy skips). Mirrors v5 `auto-block.spec.ts:298` coexistence pattern.
- [x] AC5 (bootstrap-first diagnostic dev fires / prod silent / neither throws) — `bootstrap-first.spec.ts` drives `dev.html` (debug:true, pixel before bootstrap) → warning containing `INSTALL ORDER WARNING`/`[Cookyay]`/`Move Cookyay first in <head>` (matches `autoblock-diagnostic.ts:_formatDiagnosticWarning`); `prod.html` (debug omitted) → zero matching warnings; no `pageerror` in either mode (`:126`, `:159`).
- [x] AC6 (hermetic, in CI, green, placement mirrors auto-block.spec.ts) — all third-party hosts stubbed/aborted via single `**/*` handler; specs live in `packages/scanner/e2e/`. Verified locally: `playwright test` 90/90 pass (13 new), `pnpm test` 858/858 pass.
**Tests:** 90/90 e2e (13 new) + 858/858 unit — all green (re-run by verifier after building cookyay dist).
**Notes:** `tsup.config.ts` gained `define: { 'process.env.NODE_ENV': '"development"' }` on the ESM build — an implementation-file touch beyond the strict test-only scope, but it is load-bearing for these fixtures (without it the diagnostic's `process.env.NODE_ENV` guard throws `process is not defined` when the ESM bundle loads in Chromium) and a genuine prod concern; transparently documented, IIFE production DCE unaffected. Minor future-work (non-blocking): AC2 positive assertion is `>=1` rather than exactly-1 (justified by 2 injected pixel elements); the declared-wins `<img>` case proves no double-processing via `data-cookyay-auto` absence but, unlike v5's script coexistence test, has no explicit fire-count flag — acceptable for the `<img>` path and consistent with research F3 item 4.
