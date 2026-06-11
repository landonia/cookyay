# Research index — cookyay v5

Generated: 2026-06-10

## Personas run
- [existing-codebase-archaeologist](existing-codebase-archaeologist.md) — v4 DB + host-matchers are browser-portable; reuse `blocking.ts` queue, but it lacks a `MutationObserver` so the dynamic-intercept strategy is the key decision.
- [performance-engineer](performance-engineer.md) — Bundle budget is a non-issue: full 50-service DB stripped to host→category compresses to ~750–950B gz; inline it via codegen, don't lazy-load (a CDN fetch arrives too late to block).
- [runtime-interception-domain-expert](runtime-interception-domain-expert.md) — Race-free interception needs a synchronous `document.createElement`/`setAttribute` override in the bootstrap; parser-inserted scripts before the snippet can't be stopped. Consent Mode v2 double-handling is the biggest hazard.
- [test-strategist](test-strategist.md) — Three net-new assets: a jsdom unit matcher test, a Playwright auto-block fixture+spec (reuse `page.route()` abort pattern), and a scanner↔banner parity test. Bundle-budget `size-limit` gate already exists.

## Convergent conclusions (all personas agree)
1. **Delivery: inline a stripped client DB via codegen, not a lazy-loaded asset.** Performance, archaeologist, and interception experts independently conclude the ~50-service host/path slice compresses to ~1–3KB gz and fits the <20KB budget with ~10KB headroom — and that a lazily-fetched DB (100–300ms) arrives too late to block scripts that execute within milliseconds. Mechanism: a second output from the existing `build-services-db.mjs` codegen emitting a client-safe module (id/category/requestHosts/requestPaths only — drop cookies/localStorage). **This effectively resolves the goals.md "DB delivery — TBD in research" question: inline subset wins.**
2. **Interception mechanism: synchronous `document.createElement`/`appendChild` (+ `setAttribute` for `src`) proxy installed in the <1KB bootstrap.** A `MutationObserver` fires too late to stop a parser-inserted script's network fetch. The honest limit: any `<script src>` placed in HTML *before* the bootstrap cannot be blocked — so install-ordering (Cookyay first in `<head>`) becomes a hard requirement and an acceptance-test invariant.
3. **Reuse the existing `blocking.ts` grant/inject queue** for auto-detected elements, adding only an `autoDetected: true`/`data-cookyay-state` flag for observability and to honor "declared rules win."

## Cross-cutting open questions

### A. Interception strategy & limits
- **MutationObserver vs. createElement/appendChild proxy** (archaeologist Q1, interception report) — the proxy is the only race-free option for the initial-HTML case, but is more invasive and may interact with GTM. *Largely answered by research → proxy; confirm acceptance of GTM-ordering requirement.*
- **`document.write`-based legacy ad injection** — in scope for v5 or explicitly deferred? (interception Q2)
- **Pixel/beacon (`<img>` `facebook.com/tr`) interception** — wrap `HTMLImageElement.src` (higher breakage risk) or defer? (interception Q4)
- **First-party / self-hosted script paths** (e.g. site serves GA4 at `/js/ga.js`) — DB can't match; document the gap or add a config escape hatch? (interception Q5)

### B. Consent Mode v2 interaction (highest product-risk)
- **CM v2 pass-through policy** — should auto-block *skip* Google tags (let CM v2 degrade them gracefully) or DOM-block GTM/GA4 (which prevents all CM v2 `update` signals from firing)? [prd.md §3.4] (interception Q1) — **needs a product decision before planning.**

### C. Config surface & precedence
- **`autoBlock` granularity** — single boolean or per-category (`autoBlock: { analytics: true, marketing: false }`)? (archaeologist Q3)
- **Declared + auto-block coexistence** — skip elements already attributed (`data-cookyay-state === 'blocked'`) vs. actively de-register from the auto-block queue? (archaeologist Q4)
- **Tree-shake the DB when `autoBlock: false`** (zero cost for opt-out installs, slightly more complex build) vs. always-present (~750B gz for everyone)? (performance Q2)
- **Pre-IIFE bootstrap host-set** — spend ~250B gz so an inlined-GTM-above-Cookyay site is still covered, or make "Cookyay first" an install requirement? (performance Q1)

### D. Matching semantics & confidence
- **Runtime confidence threshold** — at runtime the banner sees only host/script-src (no cookies yet), so v4's two-signal `high` is unreachable; is single-signal host match (`medium`) the block threshold? (test-strategist Q2, interception Q3)
- **Shared-CDN false positives** — require a `scriptUrlGlob` for services whose host is a shared CDN, or rely on the `minimumConfidence` gate? (interception Q3)
- **`requestPaths` + subdomains** — exact-host match (`www.google.com`) or accept subdomains? (performance Q3)
- **OCD cookie-name entries** — include in client DB (useless for script blocking, but could feed a future "cookies already written" warning) or strictly the 50 curated services? (archaeologist Q2)

### E. Test placement
- **Auto-block integration test location** — Playwright in `packages/scanner/e2e/` vs. Vitest browser-mode in `packages/cookyay` (matching `blocking.browser.test.ts`)? Align before writing. (test-strategist Q3)

## Recommended next step
Research converged strongly on the two biggest architectural unknowns (DB delivery → inline; interception → synchronous proxy), so the path to planning is short. Two items genuinely change scope and warrant a decision first:
- **Consent Mode v2 pass-through policy (Question B)** — product-level, affects whether Google services are auto-blocked at all.
- **`autoBlock` config granularity + confidence threshold (C, D)** — shape the config schema and matcher tasks.

Answer those (then `/pm:amend cookyay` if they change PRD scope), or proceed directly to `/pm:plan cookyay` and let the remaining questions be resolved at task-execution time. Optionally run `/pm:architect cookyay` (amend mode) to lock the interception + delivery decisions into `v5/architecture.md` before planning.

## Update — 2026-06-10 — Author decisions

The scope-affecting open questions were answered by the author:

- **(B) Consent Mode v2 policy → Skip Google tags.** Runtime auto-block does NOT touch GTM/GA4; the existing Consent Mode v2 integration [prd.md §3.4] degrades Google services (denied-by-default) instead. This removes the CM v2 double-handling hazard the interception report flagged. Non-Google trackers are still auto-blocked. Auto-block needs a Google-host skip-list derived from the curated DB.
- **(C) `autoBlock` config → single boolean, opt-in (default `false`).** No per-category object. The client DB tree-shakes to zero for opt-out installs (resolves performance Q2 in favour of tree-shaking).
- **(D) Confidence threshold → block on a single host/path match (`medium`).** v4's two-signal `high` is unreachable at load time (no cookies yet). Shared-CDN hosts must carry a `scriptUrlGlob` to avoid false-positives (resolves interception Q3 / performance Q3 toward URL-glob disambiguation).
- **Pixels/legacy → scripts + iframes only.** `<img>`-beacon pixels (`facebook.com/tr`) and `document.write` legacy ad injection are DEFERRED to a later version (resolves interception Q2 + Q4). v5 wraps script/iframe insertion only.

**Settled by research (not re-asked):** DB delivery = inline stripped client subset via codegen; interception = synchronous `createElement`/`setAttribute` proxy in the bootstrap, with "Cookyay first in `<head>`" as an install requirement and acceptance invariant.

**Still open for execution-time (non-blocking):** declared-vs-auto coexistence implementation detail (skip already-attributed elements vs. de-register); pre-IIFE bootstrap host-set (~250B) vs. install-ordering requirement; OCD cookie-name entries in client DB (likely no); first-party self-hosted script-path gap (document it); auto-block test placement (Vitest browser-mode in `packages/cookyay` vs. Playwright in `scanner/e2e`).

These decisions refine the v5 cut (folded into `goals.md`) rather than changing PRD scope — no `/pm:amend` needed. Next: `/pm:plan cookyay`.
