# test-strategist — Research findings

## Summary

v6 adds two genuinely new testing challenges on top of the solid v5 pattern: (1) asserting a **network request never fired** for a fire-and-forget `<img>` pixel — a negative proof the existing `window.__flag`-style assertions cannot address — and (2) driving a **dev-mode vs prod-mode fixture** to assert the bootstrap-order diagnostic fires exactly once in the right mode. Both are solvable with the existing Playwright `page.route()` harness; the key is extending the default-deny rule to count hits on a local stub endpoint, and controlling mode by passing a `debug:true/false` flag through the fixture HTML. The v5 `auto-block.spec.ts` + `fixtures/auto-block/all.html` pattern is the correct mirror target.

---

## Findings

### F1 — Asserting a pixel was NOT fired (the negative-proof problem)
The `<img>` pixel `facebook.com/tr?…` is a fire-and-forget GET — there is no `window.__flag` to check because the image element's load has no JS side-effect. Three options exist:

**Option A (recommended): `page.route()` request counter.** The existing default-deny route handler (`route.abort()` for all non-localhost) already blocks the real request. Add a dedicated route for `facebook.com/tr` that calls a local counter instead of aborting:
```ts
let hitCount = 0
await page.route('**/facebook.com/tr**', route => { hitCount++; route.fulfill({ status: 200, body: '' }) })
```
Assert `hitCount === 0` before consent, `hitCount === 1` after grant. This is hermetic, deterministic, and does not require a real network. [goals.md §Acceptance bar]

**Option B: Check `<img>.naturalWidth` / `complete`.** Not reliable in Playwright's headless Chromium — a pixel-sized 1x1 GIF fulfills with `naturalWidth === 1` but a fulfilled-empty route (`status:200, body:''`) returns `naturalWidth === 0, complete === true`. Requires careful stub construction; the counter approach is simpler.

**Option C: Intercept `document.createElement('img')` and src property.** v6's implementation will extend the proxy to intercept `<img src="…">` assignments. Asserting `img.getAttribute('src')` is `null` pre-consent (same as the script/iframe pattern in the existing proxy tests) works in the jsdom unit layer. But the e2e hermetic proof also needs the network-level guarantee — Option A must still be used in the e2e fixture alongside the DOM attribute check.

**Verdict:** Use both layers. In `autoblock-proxy.test.ts` (unit, jsdom): assert `img.getAttribute('src') === null` pre-consent (mirrors the script/iframe AC3 test pattern at line 417). In the e2e spec: `page.route()` counter proves zero network hits before consent, one hit after grant. [goals.md §Acceptance bar, prd.md §5]

### F2 — Testing the dev-time bootstrap-first diagnostic
The diagnostic must fire when `debug: true` is passed to `init()` and a known tracker was loaded before bootstrap. It must NOT fire in prod mode (`debug: false` / omitted). [goals.md §What's new in v6]

**Fixture construction:** The HTML fixture must place a tracker `<script src="https://connect.facebook.net/…">` (or an `<img src="https://www.facebook.com/tr?…">`) **physically before** the Cookyay `<script src="/packages/cookyay/dist/bootstrap.js">` in `<head>`. This is the only vector — static HTML parse order puts the tracker fetch before the bootstrap installs its proxy. The fixture server already serves from `fixtures/` so a new file `fixtures/bootstrap-first/dev.html` and `fixtures/bootstrap-first/prod.html` (or parameterised via query string) fits the existing convention.

**Capturing `console.warn`:** In Playwright: `const warnings: string[] = []; page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()) })` before `page.goto()`. Assert `warnings.some(w => w.includes('tracker loaded before'))` for dev mode, `warnings.length === 0` for prod mode. The unit layer (`bootstrap.test.ts` pattern) can use `vi.spyOn(console, 'warn')` directly.

**Unit vs e2e split:** The "fires in dev, silent in prod, never throws" behaviour is well-suited to a unit test in `packages/cookyay/src/` (e.g. `autoblock-diagnostic.test.ts`) for the synchronous logic, plus one e2e fixture test to prove the HTML parse-order scenario end-to-end. [goals.md §What's new in v6]

### F3 — Per-surface e2e fixture coverage

All new cases should extend or mirror `fixtures/auto-block/all.html` and live in `packages/scanner/e2e/auto-block.spec.ts`. Specific additions needed:

1. **`<img>` pixel held pre-consent → fired post-grant.** New `<img id="autoblock-fb-pixel">` element in the fixture HTML, injected dynamically (after `init()`) with `img.src = 'https://www.facebook.com/tr?id=…'`. `page.route()` counter confirms zero hits before consent, one hit after grant of `marketing`. The element's `src`/`getAttribute('src')` null-check confirms DOM-level hold.

2. **Content `<img>` (non-curated) NOT touched (false-positive guard).** A non-tracking `<img src="https://images.example.com/photo.jpg">` must pass through untouched — `getAttribute('src')` is non-null immediately, route counter shows one hit on load. This is the img-pixel equivalent of the existing same-origin and Google-skip negative cases. [goals.md §Acceptance bar]

3. **Google pixel skipped.** A Google-owned pixel endpoint (e.g. `google.com/pagead/…`) — if any such service has `google:true` in the DB — must not be held. If no Google `<img>` pixel services exist in the DB yet, add a "Google pixel skipped by design" comment stub here to reserve the case. [goals.md §What ships in v6]

4. **Declared-wins coexistence.** Mirror the existing script coexistence test: an `<img>` pixel with `data-category="marketing"` declared in HTML is owned by the declarative engine; the proxy must not set `data-cookyay-auto` on it. This guards the `_holdElement()` declared-skip guard extending to `<img>`. [goals.md §Acceptance bar]

### F4 — Parity and DB-expansion testing
The `parity.test.ts` is already data-driven over `CURATED_SERVICES` — adding a service to `services.yaml` and re-running the codegen automatically extends coverage. [goals.md §What ships in v6]

For v6 pixel-class fields: if `services.yaml` gains a new field (e.g. `imgPixel: true` or `elementType: img`) to distinguish pixel-class entries from script/iframe entries, `parity.test.ts` needs a new assertion group: "pixel-class services — scanner finds them by `requestPaths`, client holds `<img>` elements at those paths." The `synthesiseUrl()` helper already handles `requestPaths` entries; the parity assertion only needs a new branch checking `imgPixel` flag propagation. [goals.md §What ships in v6]

The totals-guard `it('covers all curated services — non-Google + Google counts equal total')` will automatically catch a new service left uncategorised.

### F5 — Flake risks and CI cost

**Flake risks:**
- **`page.route()` race on `<img>` pixel.** Unlike `<script>` (which the proxy holds before any fetch), an `<img>` element unblocked by v6's extended proxy will fire its request in a tick. Use `await page.waitForTimeout(200)` only after grant, not before — the default-deny route ensures zero hits pre-consent deterministically. The existing `150ms` setTimeout drain pattern from the script tests is sufficient.
- **`console.warn` capture ordering.** The diagnostic fires synchronously during `init()` startup. Register the `page.on('console', …)` listener before `page.goto()` (already the correct pattern for Playwright).
- **Fixture parse order.** The bootstrap-first fixture is fragile to HTML prettification — an auto-formatter reordering `<head>` children would silently break it. Add a comment block at the top of the fixture HTML flagging this constraint (same comment style as `all.html` line 7–10).

**CI cost:** The existing Playwright suite uses a single Chromium worker. Each new `test.describe` block adds ~1–3 tests at ~300–800ms each. Estimated addition: 6–8 new e2e tests = ~4–6 seconds total. Negligible vs. the existing suite. The bootstrap-first diagnostic spec is Playwright (needs real parse-order behaviour); it cannot be Vitest browser-mode because Vitest's fixture injection does not replicate `<head>` parse order with a real server.

**Test placement:** All new pixel e2e cases go in `packages/scanner/e2e/auto-block.spec.ts` (extending the existing file) or a sibling `pixel-block.spec.ts` if the file grows unwieldy. New unit tests for `<img>` proxy logic go in `packages/cookyay/src/autoblock-proxy.test.ts` (new `describe` block). The diagnostic unit test goes in a new `packages/cookyay/src/autoblock-diagnostic.test.ts`. The bootstrap-first e2e goes in `packages/scanner/e2e/bootstrap-first.spec.ts` as a standalone spec (different fixture, different concern from auto-block). [goals.md §Acceptance bar, prd.md §5]

---

## Gotchas

1. **`page.route()` default-deny MUST come last** (or use `route.abort()` as fallback). The existing `auto-block.spec.ts` registers a single `**/*` catch-all that aborts non-localhost — this works correctly only when more-specific routes are registered first with `await page.route('**/facebook.com/tr**', …)`. Playwright matches routes in registration order (last-registered wins for a glob). Register specific routes before the catch-all.

2. **`<img>` proxy scope is curated-only.** The v6 spec is explicit: blocking is scoped to curated tracking-pixel endpoints (host + path / `requestPaths`), never `<img>` elements broadly. The false-positive guard test (F3 item 2) is load-bearing — it prevents a regression where a broader matcher inadvertently blocks content images. [goals.md §What ships in v6]

3. **jsdom `<img>` vs real browser.** jsdom does not dispatch `load` events or populate `naturalWidth` for `<img>` elements; use `getAttribute('src')` checks in unit tests. The e2e route counter is the ground truth for "request actually fired."

4. **`debug:true` is a user-facing config flag, not a build-time flag.** The diagnostic is gated by `config.debug` (see `api.ts` line 80). The fixture HTML must pass `debug: true` explicitly to `init()` for the warning to fire — not via `NODE_ENV` or a build constant. The prod-mode fixture passes `debug: false` or omits it.

---

## Recommendations (priority order)

1. **Extend `autoblock-proxy.test.ts` first.** Add an `<img>` interception describe block (AC3-img) covering: matched `<img>` src held (getAttribute null), non-matched `<img>` passes through, route counter conceptual proof. This is pure unit work with no new fixtures needed.

2. **Add `page.route()` counter helper to `auto-block.spec.ts`.** Extract the `hitCount` pattern into a `setupPixelRoute()` helper to avoid repetition across the pixel-specific tests. Register it in `setupRoutes()`.

3. **New fixture HTML: `fixtures/auto-block/pixel.html` (or extend `all.html`).** Add the `<img id="autoblock-fb-pixel">` case, the content image false-positive guard, and the declared-wins `<img>` case. Keep `all.html` as the "all surfaces" canonical fixture; `pixel.html` is the v6 pixel-focused extension if `all.html` grows crowded.

4. **New `packages/scanner/e2e/bootstrap-first.spec.ts` + `fixtures/bootstrap-first/` directory.** Two HTML files: `dev.html` (tracker before bootstrap, `debug:true`) and `prod.html` (same order, `debug:false`). Three tests: warning fires in dev, silent in prod, nothing throws in either mode.

5. **Parity test: add `imgPixel` field assertion if the YAML schema gains it.** Make it a data-driven `it.each` over `CURATED_SERVICES.filter(s => s.imgPixel)` so new pixel services auto-extend coverage. If no new schema field is added (the `requestPaths` entry for `facebook.com/tr` already exists), no change to `parity.test.ts` is needed.

---

## Open questions for the user

1. **Does v6 add a new `imgPixel: true` (or similar) flag to `services.yaml`** to distinguish pixel-class entries from script/iframe entries in the DB and generated client slice? If yes, parity assertions need to cover that field; if no, the existing `requestPaths` entry for `facebook.com/tr` is already the selector.

2. **Should the bootstrap-first diagnostic live in `autoblock-diagnostic.ts` (new file) or as a function inside `api.ts`?** The placement determines which unit test file owns it; the recommendation above assumes a new file.

3. **Will the `<img>` proxy extension intercept both `img.src = '…'` (property setter) and `img.setAttribute('src', '…')` (HTML parser path)?** The current proxy only intercepts `SCRIPT`/`IFRAME` tags. Extending to `IMG` requires confirming the interception surface — this is an implementation decision that gates which unit tests to write.

---

## Out of scope

- `document.write` legacy injection — explicitly deferred to a future version. [goals.md §What's deferred to later versions]
- Auto-block on by default — not in v6, no testing change needed. [goals.md §What's deferred to later versions]
- Non-auto-block capabilities (i18n, hosted config, consent analytics). [goals.md §What's deferred to later versions]
- Browser compatibility testing beyond Playwright's headless Chromium — evergreen-only per the PRD constraint. [prd.md §5]
## Update — 2026-06-11 — Author decisions

Open questions A–D resolved by the author (all confirm the recommended defaults; no `/pm:amend` needed — scope and schema unchanged):

- **A. DB expansion (→ Meta Pixel + ~5 majors).** Add `<img>`-pixel `requestPaths` entries for Meta, LinkedIn, Pinterest, Snapchat, TikTok, Reddit (~6 services). Trivially under the 20 KB budget.
- **B. `<img>` modeling (→ reuse `requestPaths`, no new field).** Interception keys on host + `requestPaths` only (never host alone); no `imgPixel`/`kind` schema field, so the parity test and codegen are unchanged.
- **C. `fetch`/`sendBeacon` (→ document as honest limit).** DOM interception cannot see `fetch`/`sendBeacon` beacons; v6 documents this as a known gap in the §3.8 honest-parity story. No `window.fetch` patch in v6 (deferred).
- **D. Diagnostic trigger (→ `debug:true` only).** The bootstrap-first warning fires only when `config.debug` is set; the diagnostic code is still DCE-stripped from production builds to cost zero bytes.
- **E–G (safe defaults adopted by the planner):** pixel fires synchronously in the grant handler on consent (E); held pixels rely on no-src (typically 1×1/`display:none`) (F); diagnostic in a new `autoblock-diagnostic.ts`, apex-domain prefilter for the hot path, `<img>` proxy intercepts both `img.src=` and `setAttribute('src',…)` (G).
