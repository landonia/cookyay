---
persona: existing-codebase-archaeologist
version: v6
date: 2026-06-11
---

# existing-codebase-archaeologist — Research findings

## Summary

- The v5 runtime auto-block proxy in `autoblock-proxy.ts` intercepts `document.createElement` and `Element.prototype.setAttribute` for `<script>`/`<iframe>` only; the comment at line 279 explicitly documents `<img>` as **intentionally NOT intercepted** — v6 must add a parallel `<img>` interception path using the same two-phase shim/classify pattern.
- The existing `HeldElement` / `_held` queue and `enqueueAutoDetected()` grant/inject path are designed for elements that need deferred **execution** (clone-and-reinsert for scripts, data-src promotion for iframes). `<img>` pixels are fire-and-forget GET requests — there is no "execution" to defer; the correct release mechanism is simply assigning `src` after consent, which maps cleanly to `_injectIframe`-style in-place promotion.
- The `matchAutoBlock` path via `requestPaths` already classifies `facebook.com/tr` correctly — the DB entry for `meta-pixel` uses `requestPaths: ["facebook.com/tr"]` and the path matcher in `autoblock-matcher.ts` is reused without change. Adding pixel entries requires only `services.yaml` edits and a codegen re-run.
- The bootstrap (`bootstrap.ts`) does **not** install the auto-block proxy; that happens synchronously inside `api.ts:init()`. There is no dev/prod mode flag yet — `config.debug` controls `_debug` logging but no "loaded-before-bootstrap" detection exists anywhere.

---

## Findings

**1. Proxy intercepts `<script>`/`<iframe>` only — `<img>` is the v6 extension seam**
[goals.md §What ships in v6, prd.md §3.2]
`autoblock-proxy.ts:installAutoBlockProxy()` (line 363–432) overrides `document.createElement` for tags `'script'` and `'iframe'` only; the line `if (tag !== 'script' && tag !== 'iframe') { return el }` is the exact gatekeeper. The `setAttribute` override checks `this.tagName === 'SCRIPT' || this.tagName === 'IFRAME'`. To intercept `<img>`, v6 must add `'img'` to both guards. For `<img>`, the instance-level one-shot `src` trap from `createElement` is sufficient; `setAttribute('src', …)` interception via the `setAttribute` override also applies. No other mechanism is needed.

**2. `HeldElement` type covers scripts/iframes — `<img>` fits with a union type extension**
[goals.md §What ships in v6]
`autoblock-proxy.ts:HeldElement` (line 64–73) types `el` as `HTMLScriptElement | HTMLIFrameElement`. Extending to `| HTMLImageElement` is the minimal TypeScript change. The `_holdElement()` function (line 142–170) is generic enough — it sets `data-cookyay-state="blocked"`, `data-cookyay-auto="true"`, and `data-category` on the element, then pushes to `_held`. These operations work identically on `<img>`.

**3. The grant/inject path for `<img>` does not need `enqueueAutoDetected()` — use in-place src assignment**
[goals.md §What ships in v6, prd.md §3.2]
`blocking.ts:grant()` (line 174–198) dispatches either `_injectScript()` (clone-and-reinsert) or `_injectIframe()` (data-src promote). An `<img>` pixel is fire-and-forget: once consent is granted, setting `img.src` triggers the GET immediately. The `_injectIframe` pattern (line 247–260: remove `data-src`, assign `src`, restore `display`) is the right model. The `grant()` dispatcher needs a third branch: `else if (el.tagName === 'IMG')` → `setTimeout(() => _injectImg(img), 0)`. No element clone is needed; no re-interception risk exists (the proxy only traps script/iframe). `enqueueAutoDetected()` needs to be called for `<img>` just as it is for iframes — the `data-src` storage path and `_enqueue()` call are identical.

**4. Matcher already handles pixel endpoints via `requestPaths` — no matcher changes needed**
[goals.md §Signature DB expansion, prd.md §3.6]
`autoblock-matcher.ts:matchAutoBlock()` step 2 (line 274–289) matches on `requestPaths` entries using `_hostMatches(host, pe.host) && pathname.startsWith(pe.path)`. The existing `meta-pixel` DB entry already has `requestPaths: ["facebook.com/tr"]`, so `https://www.facebook.com/tr?ev=PageView&...` resolves correctly today. New pixel-class services require only `services.yaml` additions with `requestPaths` entries. No changes to matcher logic are needed. The `requiresGlobMatch` shared-CDN guard does not trigger for `requestPaths`-only entries.

**5. DB codegen: add pixel services to `services.yaml`, re-run `build-services-db.mjs`**
[goals.md §Signature DB expansion]
`build-services-db.mjs` validates and emits three artefacts: `scanner/src/db-curated.generated.ts`, `cookyay/src/db-autoblock.generated.ts`, and `fixtures/service-fingerprints.json`. The validation rule at line 147–159 requires at least one match signal — for pixel-only services with no dedicated JS host, this means at minimum one `requestPaths` entry. The script strips cookies/localStorage/source for the client slice. Adding a pixel service: add entry to `services.yaml` with `requestPaths`, run `node scripts/build-services-db.mjs`, commit both generated files. The parity test at `scanner/src/parity.test.ts` will auto-extend to cover the new entry; it synthesises probe URLs from `requestPaths` via the `synthesiseUrl()` helper (line 52–65).

**6. Parity test must keep passing — pixel entries need a `requestPaths`-based probe URL**
[goals.md §Acceptance bar]
`parity.test.ts:synthesiseUrl()` builds `https://<rpHost><rpPath>parity-probe` for `requestPaths` entries. The scanner's `findServiceByRequest()` must also match this URL. The test currently covers all 50 services. Any new pixel service added without a `requestPaths` entry (only cookies) would fall into the `url === null` skip path — harmless but leaves a parity gap. Ensure every new pixel-class entry carries at least one URL signal.

**7. Bootstrap does NOT install the proxy — no diagnostic hook exists yet**
[goals.md §Bootstrap-first mitigation]
`bootstrap.ts:applyBootstrap()` (line 96–124) sets up `window.__COOKYAY`, GPC, dataLayer/gtag, and Consent Mode defaults. It does NOT call `installAutoBlockProxy()`. The proxy is installed synchronously inside `api.ts:init()` only when `config.autoBlock === true`. For the v6 "loaded before bootstrap" diagnostic, the hook point is: after `activateMatcher()` resolves in `api.ts` (line 286–296), iterate `window.performance.getEntriesByType('resource')` looking for known-tracker hostnames with `initiatorType: 'script'` and `startTime < init_call_time`. No `dev` flag exists currently; `config.debug` (boolean, `CookyayConfig`) is the existing dev-time gate and is the natural home for this diagnostic.

**8. Test conventions — three layers, clear placement rules**
[goals.md §Acceptance bar]
- Vitest jsdom unit: `packages/cookyay/src/*.test.ts` — pure logic, no real browser (e.g., `autoblock-wire.test.ts`, `autoblock-matcher.test.ts`, `autoblock-proxy.test.ts`).
- Vitest browser-mode: `packages/cookyay/src/*.browser.test.ts` — real Chromium via Playwright provider for anything requiring a real DOM event loop (e.g., `blocking.browser.test.ts`).
- Playwright e2e: `packages/scanner/e2e/*.spec.ts` — full page lifecycle with `page.route()` network interception. The v5 `auto-block.spec.ts` is the exact pattern to mirror for v6 `<img>` pixel assertions. New fixture page needed under `fixtures/auto-block/`.

**9. Bundle budget — current headroom is narrow**
[goals.md §Acceptance bar, prd.md §3.1]
`.size-limit.json` sets the auto-block-ON bundle at 20 kB gzip with a comment indicating 14.33 kB measured in v5. Each new pixel entry in `db-autoblock.generated.ts` adds ~50–100 bytes gzip. DB expansion headroom is ~5.6 kB. The auto-block-OFF bundle (ESM main only) must remain under 13 kB gzip — the `<img>` proxy code is statically imported via `autoblock-proxy.ts`, so any size added there affects all installs. Keep the `<img>` shim addition small.

---

## Gotchas

- **`document.createElement` override runs before `type="module"` scripts** in the fixture HTML because the module is deferred (runs after parsing). But `init()` itself is inside the module block in `all.html` — meaning the proxy is installed after parse, not before. This is correct for dynamically injected scripts but means HTML-parser-injected `<img>` tags with `src` already set in markup **cannot** be intercepted (same bootstrap-first limit as scripts). The diagnostic is the fix for surfacing this, not an intercept workaround.
- **`<img>` elements have no `type` attribute to set to `text/plain`** — the "hold inert" mechanism for `<img>` must use either (a) never assigning `src` (proxy path, identical to scripts) or (b) replacing `src` with a data URI placeholder. The proxy's one-shot instance `src` trap (never forwarding) is the cleanest approach — no visible broken-image state during the holding period if the element hasn't been appended yet. If appended without `src`, the browser renders nothing, which is the desired state.
- **The `_injectScript` re-interception guard** (`clone.setAttribute(ATTR_STATE, STATE_EXECUTED)` before assigning `src`) is needed because the proxy is still active during grant injection. An equivalent `_injectImg` function must set `data-cookyay-state="executed"` on the `<img>` before assigning `src` — even though the `<img>` proxy intercept won't exist yet in v5, it will exist after v6, and the injection path must be written defensively now.
- **`requestPaths` entries on broad hosts (facebook.com) are path-prefix matches, not exact** — `pathname.startsWith('/tr')` matches `/tr`, `/tr/`, `/track`, `/trending`, etc. For pixel endpoints this is almost always correct (fb's pixel endpoint is `/tr` exclusively) but worth auditing new pixel entries for over-broad path prefixes.
- **Parity test uses `synthesiseUrl()` which appends `parity-probe` to the path** — a `requestPaths` entry of `"facebook.com/tr"` synthesises `https://facebook.com/trparity-probe`, which still `startsWith('/tr')` — so the probe passes. This is correct but worth knowing when reading parity test output.

---

## Recommendations (priority order)

1. **Extend `HeldElement`, `installAutoBlockProxy`, and `_holdElement` for `<img>`** — single `autoblock-proxy.ts` edit; add `'img'` to the tag guard in `createElement` override and `setAttribute` override. Extend `HeldElement.el` union type. This is the core v6 blocker.
2. **Add `_injectImg()` to `blocking.ts` and wire `grant()` dispatcher** — mirror `_injectIframe` in-place src promotion. Add `| HTMLImageElement` to `enqueueAutoDetected` signature. Update `QueueEntry.el` union type.
3. **Add pixel-class services to `services.yaml`** — at minimum: tighten `meta-pixel` (already present via `requestPaths`); add any additional pixel endpoints (LinkedIn insight pixel, Twitter/X pixel image endpoint, etc.). Run `build-services-db.mjs` and commit generated files.
4. **Add bootstrap-first diagnostic in `api.ts`** — after `activateMatcher()` resolves, when `config.debug` is true, scan `performance.getEntriesByType('resource')` for tracker hostnames with `startTime` earlier than the proxy install timestamp. Emit `console.warn('[Cookyay] detected tracker loaded before Cookyay bootstrap: ...')`. Strictly gated on `config.debug` — zero runtime cost in production.
5. **Add e2e fixture + spec for `<img>` pixel** — new HTML fixture under `fixtures/auto-block/` with a dynamically injected `<img src="https://www.facebook.com/tr?ev=PageView">`. Mirror `auto-block.spec.ts` pattern: assert network request is NOT made before consent (via `page.route()` + abort), IS made after marketing grant. This is the acceptance bar item.

---

## Open questions for the user

1. **`<img>` pixel interception scope**: Should the proxy intercept ALL `<img>` elements whose src matches a `requestPaths` entry (e.g., LinkedIn insight pixel at `px.ads.linkedin.com/collect`), or only `<img>` elements where the src contains a known pixel endpoint path? The current `requestPaths` match logic handles this, but: are there `<img>` hosts that also serve legitimate content (profile photos, etc.) where interception would cause page breakage? The goals.md §What ships in v6 says "scoped to curated tracking-pixel endpoints (host + path / `requestPaths`), never `<img>` elements broadly" — confirm this means we rely on `requestPaths` (not `requestHosts`) for all `<img>` entries in the DB.
2. **`<img>` held-inert visual**: When a pixel `<img>` is held inert (src never set), it renders as a 0×0 empty element or broken-image icon depending on whether it has explicit dimensions. Pixel images typically have `width=1 height=1` or are `display:none`. Is there any concern about a visible broken-image state, or is the no-src approach sufficient?
3. **New pixel service entries in DB expansion**: Which specific pixel endpoints (beyond Meta Pixel, already present) are in scope for v6? LinkedIn, Twitter/X, Pinterest, Snapchat, TikTok, and Reddit pixel endpoints all use `<img>` or `<script>` — confirm which have `<img>`-specific paths that need `requestPaths` entries distinct from their existing `requestHosts` entries.

---

## Out of scope

- `document.write` legacy injection — explicitly deferred per goals.md §What's deferred to later versions.
- Auto-block on by default — remains opt-in; no default flip in v6.
- Any non-auto-block product capability (i18n, consent analytics, hosted config).
- Changing the declared-wins precedence logic or the `scanBlocked` registration path.
- Google tag handling — unchanged by design; CM v2 handles GA4/GTM/Google Ads.
## Update — 2026-06-11 — Author decisions

Open questions A–D resolved by the author (all confirm the recommended defaults; no `/pm:amend` needed — scope and schema unchanged):

- **A. DB expansion (→ Meta Pixel + ~5 majors).** Add `<img>`-pixel `requestPaths` entries for Meta, LinkedIn, Pinterest, Snapchat, TikTok, Reddit (~6 services). Trivially under the 20 KB budget.
- **B. `<img>` modeling (→ reuse `requestPaths`, no new field).** Interception keys on host + `requestPaths` only (never host alone); no `imgPixel`/`kind` schema field, so the parity test and codegen are unchanged.
- **C. `fetch`/`sendBeacon` (→ document as honest limit).** DOM interception cannot see `fetch`/`sendBeacon` beacons; v6 documents this as a known gap in the §3.8 honest-parity story. No `window.fetch` patch in v6 (deferred).
- **D. Diagnostic trigger (→ `debug:true` only).** The bootstrap-first warning fires only when `config.debug` is set; the diagnostic code is still DCE-stripped from production builds to cost zero bytes.
- **E–G (safe defaults adopted by the planner):** pixel fires synchronously in the grant handler on consent (E); held pixels rely on no-src (typically 1×1/`display:none`) (F); diagnostic in a new `autoblock-diagnostic.ts`, apex-domain prefilter for the hot path, `<img>` proxy intercepts both `img.src=` and `setAttribute('src',…)` (G).
