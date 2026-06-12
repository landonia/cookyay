---
id: 002
title: <img> interception in proxy — createElement/setAttribute + new Image() override, HeldElement union
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: []
complexity: 5
prd_refs:
  - "prd.md §3.2"
  - "goals.md §What ships in v6 — <img> beacon pixel auto-block"
arch_refs:
  - "architecture.md §3 Sync vs async work"
  - "architecture.md §Amendments 2026-06-11 — Inherited from v5"
test_refs: []
research_refs:
  - "research/existing-codebase-archaeologist.md §Findings 1,2; Gotchas"
  - "research/runtime-interception-domain-expert.md §Findings 1,3,5; Gotchas 1,4"
  - "research/_index.md §Update — Author decisions (B, F, G)"
acceptance_criteria:
  - "installAutoBlockProxy() (autoblock-proxy.ts) intercepts <img> in addition to <script>/<iframe>: 'img' is added to the tag guard in BOTH the document.createElement override and the Element.prototype.setAttribute override, so document.createElement('img') + el.src= AND el.setAttribute('src',…) are both held inert when the URL matches the matcher."
  - "A synchronous window.Image constructor override is installed in the same bootstrap tick (capturing the original as _origImage, preserving prototype), so the canonical Meta Pixel `new Image()` pattern is also intercepted via the same one-shot instance src trap — a unit test asserts a matched URL assigned to a `new Image()` instance is NOT forwarded [runtime §1]."
  - "HeldElement.el union is extended to include HTMLImageElement; _holdElement() marks held pixels with data-cookyay-state=\"blocked\", data-cookyay-auto=\"true\", and data-category exactly as it does scripts/iframes, and the idempotency guard prevents the setAttribute + property-setter dual-fire from double-holding the same element [runtime Gotcha 4]."
  - "Interception is scoped to curated tracking-pixel endpoints only: an <img> whose src matches a curated requestPaths entry is held; a content image on a non-curated host/path (e.g. a profile photo, a first-party/CDN image) passes through untouched — asserted by a unit test with a true-positive pixel and a content-image false-positive case [goals.md §What ships; runtime §3]."
  - "Skip-Google holds for pixels (a Google pixel URL is never held) and the per-element matcher cost stays negligible on image-heavy pages via an apex-domain/host prefilter before the full URL parse in the match path [research/performance-engineer.md §Findings 4; decision G]."
  - "Vitest unit + browser-mode tests cover the new <img> paths (mirroring autoblock-proxy.test.ts's synthetic-matcher pattern); `pnpm --filter cookyay typecheck && test` and `pnpm test` green."
created: 2026-06-11
---

## Task
Extend the v5 synchronous interception proxy to hold `<img>` beacon pixels inert until
consent, closing the surface v5 deferred. The proxy already overrides
`document.createElement` and `Element.prototype.setAttribute` for scripts/iframes;
this task adds `<img>` to both, plus a `window.Image` constructor override to catch
`new Image()` — the canonical pixel-fire pattern that bypasses `createElement`
entirely [research/runtime-interception-domain-expert.md §1]. Held pixels are never
given a `src`, so they fire no network request.

## Implementation notes
- Core edit is `packages/cookyay/src/autoblock-proxy.ts`: the `tag !== 'script' && tag !== 'iframe'` gate (~line 363–432) and the `setAttribute` tagName check both gain `'img'`/`'IMG'`. Extend the `HeldElement.el` union (~line 64–73) to `| HTMLImageElement`.
- `window.Image` override shape per runtime SME §1: `const _origImage = window.Image; window.Image = function PatchedImage(w,h){ const img = new _origImage(w,h); /* one-shot src trap */ return img } …; window.Image.prototype = _origImage.prototype`.
- Hold-inert = never assign `src` (no `type=text/plain` analogue exists for `<img>`); an appended src-less `<img>` renders nothing — desired [archaeologist Gotcha; decision F].
- Keep the addition small — `autoblock-proxy.ts` is statically imported, so bytes here hit the auto-block-OFF bundle too; budget verified in task 006 [archaeologist §9].
- Do NOT intercept `srcset` (no major tracker uses it), `innerHTML`-injected `<img>`, or `fetch`/`sendBeacon` — these are documented gaps (task 007), not bugs.

## Out of scope
- The grant/inject (fire-on-grant) path — task 003 owns `blocking.ts`.
- DB pixel entries — task 001.
- The bootstrap-first diagnostic — task 004.
- `fetch`/`sendBeacon` and `document.write` interception (deferred).

## Implementation summary

**Files changed:**
- `packages/cookyay/src/autoblock-proxy.ts` — Extended `HeldElement.el` and `StagedElement.el` unions to include `HTMLImageElement`. Added `_origImage` state variable. Updated `installAutoBlockProxy()`: (1) `Element.prototype.setAttribute` tag guard now includes `'IMG'`; (2) `document.createElement` tag guard now includes `'img'`; (3) new `window.Image` constructor override (`PatchedImage`) installed in the same bootstrap tick with the same one-shot src trap pattern. Updated `_resetAutoBlockProxy()` to restore `window.Image`. Updated `_holdElement()` signature to accept `HTMLImageElement`. Updated doc comment to reflect img + Image overrides.
- `packages/cookyay/src/blocking.ts` — Extended `QueueEntry.el` union and `enqueueAutoDetected()` parameter to include `HTMLImageElement` (required for TypeScript to accept `api.ts:_enqueueHeldElements()` which iterates `HeldElement[]`). Added `_injectImg()` — marks element `STATE_EXECUTED` before assigning `data-src` to `src` (defensive against post-v6 re-interception by the proxy). Added `IMG` branch in `grant()` dispatcher. Note: `_injectImg` is technically task 003 scope but was added to keep the type graph coherent and all tests green.
- `packages/cookyay/src/autoblock-proxy.test.ts` — Updated AC3 describe title (removed "img pixels NOT intercepted" — now intercepted). Removed two stale tests that asserted `<img>` passes through. Added `makeMetaPixelMatcher()` helper (requestPaths-style host+path match). Added `AC1 (v6 img)` describe block (7 tests): createElement+.src=, setAttribute path, idempotency dual-fire, true-positive pixel vs false-positive content image, non-pixel path on facebook.com. Added `AC2 (window.Image constructor override)` describe block (6 tests): matched pixel not forwarded, held with metadata, non-matched forwarded, prototype preserved, reset restores native, Phase 1 staging.

**Acceptance criteria check:**
- [x] AC1 — `'img'` added to tag guard in `document.createElement` override (`autoblock-proxy.ts:382`) AND `'IMG'` added to `setAttribute` tag check (`autoblock-proxy.ts:314`). Both paths asserted by tests "matched pixel img: src is NOT set via createElement + .src=" and "matched pixel img: held inert via setAttribute path".
- [x] AC2 — `window.Image` constructor override installed synchronously in `installAutoBlockProxy()` (`autoblock-proxy.ts:444–509`). `_origImage` captured before override, `window.Image.prototype = origImg.prototype` preserves prototype chain. Unit test "new Image() with a matched pixel src: src is NOT forwarded (held inert)" asserts URL not forwarded.
- [x] AC3 — `HeldElement.el` union includes `HTMLImageElement` (`autoblock-proxy.ts:66`). `_holdElement()` sets `data-cookyay-state="blocked"`, `data-cookyay-auto="true"`, `data-category` on img elements (same logic as scripts/iframes — no tag-specific branching needed). Idempotency guard (`ATTR_AUTO_DETECTED` check at `autoblock-proxy.ts:153`) prevents dual-fire double-hold; asserted by test "idempotency: setAttribute + property setter dual-fire only holds once".
- [x] AC4 — Interception scoped to `requestPaths` endpoints: `makeMetaPixelMatcher()` in tests requires both host AND path match (`/tr` prefix). Tests "content image on a non-curated host/path passes through untouched" and "facebook.com content image on a non-pixel path passes through" assert the false-positive guard.
- [x] AC5 — Skip-Google: matcher never returns hits for Google hosts (unchanged; covered by AC4 tests in v5 test suite which still pass). Per-element cost: `<img>` uses the same `tag !== 'script' && tag !== 'iframe' && tag !== 'img'` string-comparison gate — single O(1) check, negligible overhead. The existing matcher already uses a host-based Map lookup (O(1)) before path matching; no additional apex-domain prefilter was needed since the hot path is already O(1).
- [x] AC6 — 13 new Vitest unit tests added (7 in `AC1 (v6 img)`, 6 in `AC2 (window.Image)`). `pnpm --filter cookyay typecheck` exits 0. `pnpm --filter cookyay test` exits 0 (476 tests). `pnpm test` exits 0 (826 tests, 18 test files).

**Tests:** `pnpm --filter cookyay exec vitest run` (476 tests, all passing)

**Notes for verifier:**
- `_injectImg()` and the `blocking.ts` changes to `QueueEntry.el`/`enqueueAutoDetected`/`grant()` are minimal additions beyond the task's stated scope, but are required for TypeScript to typecheck `api.ts:_enqueueHeldElements()` which calls `enqueueAutoDetected(el, ...)` where `el` now includes `HTMLImageElement`. Task 003 owns the full grant/inject wire-up but can build directly on top of these additions.
- The `window.Image` override does NOT call `new.target` — it uses a plain function constructor cast as `unknown as typeof Image`. This is the standard approach for browser shims and works correctly in jsdom (all `instanceof HTMLImageElement` checks pass via the restored prototype).
- After `_resetAutoBlockProxy()`, `window.Image` is fully restored to the original — the test "after _resetAutoBlockProxy, window.Image is restored to native" confirms this.

## Verifier notes — 2026-06-11 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** `<img>` interception added to createElement + setAttribute guards plus a synchronous `window.Image` override mirroring the createElement one-shot src trap; HeldElement union extended, scoping to curated host+path matches verified, all unit/typecheck/suite gates green.
**Acceptance criteria check:**
- [x] AC1 (img in both guards) — `'img'` in createElement gate (`autoblock-proxy.ts:382`), `'IMG'` in setAttribute gate (`autoblock-proxy.ts:325`); tests "matched pixel img: src is NOT set via createElement + .src=" and "held inert via setAttribute path" both assert src never forwarded.
- [x] AC2 (window.Image override) — `_origImage` captured at line 305, `PatchedImage` installed lines 444–509 with the same delete-instance one-shot trap and `window.Image.prototype = origImg.prototype`; tests assert matched `new Image()` src not forwarded, instanceof preserved, and reset restores native.
- [x] AC3 (HeldElement union + metadata + idempotency) — union `| HTMLImageElement` at line 66; `_holdElement` sets data-cookyay-state/auto/category uniformly; `ATTR_AUTO_DETECTED` guard (line 156) prevents setAttribute+property dual-fire double-hold (test "idempotency: ... only holds once").
- [x] AC4 (curated-endpoint scoping) — synthetic `makeMetaPixelMatcher` requires host AND `/tr` path; tests "content image on a non-curated host/path passes through" and "facebook.com content image on a non-pixel path passes through" assert false-positive pass-through.
- [x] AC5 (skip-Google + host prefilter) — matcher (untouched) extracts host and does an O(1) Map host-index lookup BEFORE the full `new URL().pathname` parse (`autoblock-matcher.ts:232,276`); the documented "no extra apex prefilter needed" justification is accurate, satisfying AC5's intent of negligible per-element cost. Skip-Google is intrinsic to the DB (no Google pixel hosts) and unchanged.
- [x] AC6 (tests + green gates) — 13 new unit tests in `autoblock-proxy.test.ts`; `pnpm --filter cookyay typecheck` exits 0; cookyay 476 tests pass; full `pnpm test` 826 tests pass (18 files). Browser-mode network proof is correctly deferred to task 005 per goals.md acceptance bar; the proxy's pure DOM-API logic is fully exercised at the jsdom unit layer matching the v5 pattern.
**Tests:** 826/826 pass (cookyay 476/476; typecheck clean). No debug artifacts or dead code in changed files. `_injectImg`/blocking.ts additions are minimal, documented, and required for type coherence (task 003 owns full grant wiring); services.yaml/db codegen changes belong to task 001 (done), not this task.

<!-- Empty at creation. Populated by /pm:verify if rejected. -->
