# Existing-codebase-archaeologist — Research findings

## Summary

- The `cookyay` banner's blocking engine (`blocking.ts`) is a **pure DOM-scan + queue** system: it only blocks elements that already carry `type="text/plain"` or `data-src` markup. There is no MutationObserver, no network intercept, and no concept of a "signature" — v5 must add both a signature lookup step and a dynamic element-insertion intercept from scratch.
- The v4 signature database is split into two layers — `packages/scanner/src/db-curated.generated.ts` (50 hand-curated services from `data/services.yaml`) and `db-ocd.generated.ts` (Open Cookie Database entries) — but **only the curated layer is client-side safe**: it contains `requestHosts`, `requestPaths`, `scriptUrlGlobs`, and `iframeSrcGlobs`. The host-matching functions (`findServiceByHost`, `findServiceByRequest` in `db.ts`) contain zero Node/Playwright dependencies and are **directly portable to the browser**.
- The current combined bundle (IIFE + bootstrap) is **~9.3 KB gzip**. A compact client-only slice of the 50-service curated DB (id, category, requestHosts, requestPaths) compresses to **~1 KB gzip**, leaving roughly **10 KB of headroom** against the 20 KB budget — tight but plausible without the OCD entries.
- The `cookyay` package has **no dependency on `@cookyay/scanner`** and cannot safely acquire one: the scanner's full bundle (~230 KB uncompressed) is Node-only and includes Playwright. v5 must share data, not the package — via a new codegen step that writes a client-side DB module under `packages/cookyay/src/`.

## Findings

**1. Two-part bootstrap and where auto-block must fit** [prd.md §5, goals.md §What ships in v5]

The synchronous inline snippet (`packages/cookyay/src/snippet.ts`, `bootstrap.ts`) establishes `window.__COOKYAY = { q: [], gpc: false }` and fires Consent Mode defaults. The deferred UI bundle (`index.ts` side-effects imports) triggers `init()` → `_scanDOM()` → `scanBlocked()`. For v5, the MutationObserver / element-intercept for runtime auto-block must register **before** the document finishes parsing, making the deferred bundle the right insertion point (not the <1 KB inline snippet).

**2. Declarative blocking mechanism — no MutationObserver exists today** [prd.md §3.2, goals.md §Client-side signature recognition]

`packages/cookyay/src/blocking.ts` exports `scanBlocked()` and `grant()`. `scanBlocked()` calls `querySelectorAll('script[type="text/plain"][data-category]')` and `querySelectorAll('iframe[data-src][data-category]')` — a one-shot DOM walk. There is no `MutationObserver` watching for late-inserted elements. The queue `_q: Map<string, QueueEntry[]>` is keyed by `CategoryId`. v5's auto-block mode needs either: (a) a `MutationObserver` that intercepts newly-inserted `<script src>` and `<iframe src>` elements before they load, or (b) `document.createElement` / `appendChild` monkey-patching. Neither mechanism exists today.

**3. Consent state is readable synchronously** [prd.md §3.5, goals.md §Reuse the v4 confidence + category model]

`packages/cookyay/src/consent/storage.ts:readConsent()` reads the `cookyay_consent` cookie synchronously. `api.ts:_replayStoredGrants()` replays grants for all already-consented categories after init. Auto-block can call `readConsent()` or `getConsent()` to check whether a detected category is already granted — no new consent-read machinery is required.

**4. `grant()` is the single unblock entry point** [prd.md §3.2, goals.md §Client-side signature recognition]

`blocking.ts:grant(category)` drains the queue for a category and injects scripts / restores iframes via `setTimeout(fn, 0)`. For auto-block, once a script/iframe is intercepted and enqueued under its detected category, the same `grant()` call will release it on consent — no changes to the grant path are needed. The `_enqueue()` function and `QueueEntry` shape are the natural insertion point.

**5. Curated DB's host-matching functions are browser-portable** [goals.md §Reuse the v4 confidence + category model]

`packages/scanner/src/db.ts` exports `findServiceByHost(host)` and `findServiceByRequest(url, host)`. Both use only `new URL()` (native browser API) and array iteration — zero Node imports. The same file imports from `db-curated.generated.ts` and `db-ocd.generated.ts`. The curated generated module imports only from `./db.js` (for the type `ServiceDefinition`). **These functions can be copied or symlinked directly into the banner package**, provided the DB data is also present client-side.

**6. `scriptUrlGlobs` and `iframeSrcGlobs` are defined in the schema but all-empty today** [goals.md §Client-side signature recognition]

All 50 entries in `data/services.yaml` have `scriptUrlGlobs: []` and `iframeSrcGlobs: []`. The fields exist in the `ServiceDefinition` type and are passed through `build-services-db.mjs`, but no service currently uses them. For v5, populating these globs in the YAML is necessary for services whose script/iframe URL cannot be determined from the host alone — or they remain a future capability.

**7. OCD entries are scanner-only; only the 50 curated services are client-appropriate** [goals.md §Honor the <20KB budget, prd.md §5]

`packages/scanner/src/db-ocd.generated.ts` is 183 KB uncompressed. Its entries are cookie-name patterns only — no `requestHosts`, so they provide zero signal for runtime script/iframe blocking. Including OCD entries client-side would blow the budget with no benefit. The client DB is the curated 50 only.

**8. No cross-package dependency from `cookyay` to `@cookyay/scanner` exists or should exist** [prd.md §3.7, goals.md §Signature-DB delivery to the client]

`packages/cookyay/package.json` has no dependency on `@cookyay/scanner`. The scanner is platform: node with a Playwright `dependency` — importing it from the browser bundle would break the zero-dep, <20 KB constraint immediately. The correct pattern (matching the v4 precedent of `db-curated.generated.ts`) is a new codegen script that reads `data/services.yaml` and emits a client-targeted TS module, e.g. `packages/cookyay/src/db-autoblock.generated.ts`, as part of the scanner's `prebuild`.

**9. Bundle budget: currently ~9.3 KB gzip combined; client DB adds ~1 KB** [prd.md §3.1, goals.md §Honor the <20KB budget]

Current: `index.iife.js` ~8.8 KB gzip + `bootstrap.js` ~0.5 KB = ~9.3 KB total. A compact client DB (50 services, id + category code + requestHosts + requestPaths only, minified) compresses to ~1 KB gzip. The MutationObserver intercept code adds perhaps 0.5–1 KB gzip. **Total estimated: ~11–12 KB**, well within the 20 KB limit — but this assumes the OCD layer is excluded entirely and the DB subset is well-minified.

**10. The `build-services-db.mjs` codegen pipeline is the right reuse seam** [goals.md §Client-side signature recognition]

`packages/scanner/scripts/build-services-db.mjs` reads `data/services.yaml`, validates it, and emits `src/db-curated.generated.ts` plus `fixtures/service-fingerprints.json`. A second output target — `../../cookyay/src/db-autoblock.generated.ts` — would keep `services.yaml` as the single source of truth and avoid a forked client copy. The script already resolves paths relative to the workspace root (line 32: `const WORKSPACE_ROOT = join(PKG_ROOT, '..', '..')`).

## Gotchas

1. **MutationObserver timing vs. parser-inserted scripts.** Scripts declared in static HTML are parsed before `DOMContentLoaded`; a MutationObserver registered in the deferred bundle will miss them. The existing `_scanDOM()` already handles this with a `DOMContentLoaded` fallback scan for static elements. The same dual-path strategy (initial scan + observer for late-inserted) must apply to auto-block.

2. **`type="text/plain"` does not prevent inline `<script>` from being inserted dynamically.** The current blocking pattern for declarative scripts relies on the site owner marking them `type="text/plain"` before the browser sees them. For runtime auto-block of GTM-injected tags (which arrive as real `<script>` elements), a MutationObserver that fires `beforescriptexecute`-equivalent logic (or `document.write` intercept) is required. This is substantially harder and is the core implementation risk.

3. **`scriptUrlGlobs` are all empty.** The schema supports them, but no service has populated them. If v5's MutationObserver approach relies on glob-matching script `src` attributes, the YAML must be populated first — or the implementation should fall back to host-only matching (which `findServiceByHost` already handles).

4. **The `source: 'curated'` field is scanner-specific** and unnecessary client-side. The client DB codegen should strip it to save bytes. Similarly, `cookies`, `localStorage` arrays are scanner-only signals and should not be emitted to the client module (they provide no utility for blocking scripts/iframes).

5. **`requestPaths` host-qualified matching requires URL parsing.** `findServiceByRequest()` calls `new URL(url)` to extract `pathname`. For script `src` attributes this is fine (they are full URLs). For dynamically-inserted script tags injected without a full URL (relative paths), `new URL(relativePath)` will throw — the client-side matcher must guard this with a try/catch (already done in the scanner version).

6. **`sideEffects: true` on the cookyay package.** This is set correctly to prevent tree-shakers from dropping the side-effect module imports in `index.ts`. Any new auto-block module imported as a side effect must not change this setting.

## Recommendations

1. **Add a second output target to `build-services-db.mjs`** that writes `packages/cookyay/src/db-autoblock.generated.ts` — a stripped, client-safe version (id, category, requestHosts, requestPaths only; no cookies, localStorage, source). This is the lowest-risk DB delivery mechanism: same codegen pipeline, zero new infrastructure, generated file committed to git.

2. **Copy (not import) `findServiceByHost` and `findServiceByRequest` into the banner package** as a `packages/cookyay/src/autoblock-matcher.ts` module, importing from the local generated DB. Do not create a dependency on `@cookyay/scanner`.

3. **Implement auto-block as a new module `packages/cookyay/src/autoblock.ts`** with a `scanAutoBlock(root)` function (for initial DOM scan, analogous to `scanBlocked`) and a `startAutoBlockObserver()` function that installs the MutationObserver. Wire it into `api.ts:init()` behind the new `autoBlock: true` config flag, after `_scanDOM()`.

4. **Reuse the existing `_enqueue()` / `grant()` path in `blocking.ts`** for auto-detected elements by calling `_enqueue(detectedCategory, { el, placeholder })` — no new queue required.

5. **Populate `scriptUrlGlobs` / `iframeSrcGlobs` in `services.yaml` incrementally** (at least for the top-10 services) alongside the v5 implementation to enable glob-based matching as a fallback for cases where host-only matching is ambiguous.

6. **Add a `size-limit` soft-warn threshold** (e.g. 17 KB) as noted in `architecture.md §2`, so CI catches budget creep early without blocking on the exact 20 KB hard limit.

## Open questions for the user

1. **MutationObserver intercept strategy:** should v5 use a `MutationObserver` (fires after insertion, cannot prevent network fetch for parser-inserted scripts) or a `document.createElement` / `appendChild` proxy (prevents fetch but is more invasive and may conflict with GTM)? The answer determines whether already-loaded scripts are blocked or only future insertions.

2. **OCD entries:** should the client DB include any OCD cookie-name entries, or strictly the 50 curated services with host/path signals? (Cookie-name matching is useless for blocking scripts/iframes but could feed a future "cookies already written" warning.)

3. **`autoBlock` config default:** the goals say opt-in (`false` by default). Should it also be opt-in _per category_ (e.g. `autoBlock: { analytics: true, marketing: false }`) or a single boolean for all categories?

4. **Declared + auto-block coexistence:** when a script is both declared (`type="text/plain" data-category="analytics"`) AND matched by the auto-block DB, the goals say "declared wins." Does this mean auto-block skips already-state-attributed elements (checking `data-cookyay-state === 'blocked'` is sufficient) or should it actively de-register them from the auto-block queue?

## Out of scope

- **OCD database analysis:** the ~2,700 OCD entries provide cookie-name classification only, which is irrelevant for runtime script/iframe blocking. Not investigated beyond confirming they carry no `requestHosts`.
- **Playwright / crawler code:** `crawler.ts`, `ensure-browser.ts`, and the E2E suite under `packages/scanner/e2e/` are Node/Playwright-only and have no bearing on the client-side banner. Not read.
- **Banner UI modules** (`banner.ts`, `preferences.ts`, `withdrawal.ts`, `gpc.ts`): these are unchanged by v5. Not investigated in detail.
- **docs/ site and CHANGELOG:** not relevant to implementation seams.
