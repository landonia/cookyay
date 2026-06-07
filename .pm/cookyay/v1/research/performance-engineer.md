# Performance Engineer — Research findings

## Summary

- The library's own `<script>` tag must execute **synchronously in `<head>`** — not `async`, not `defer` — to act as a blocking gate before any third-party tag runs. This is the single biggest architectural constraint that shapes every other decision.
- The 20 KB min+gzip budget is achievable but tight. vanilla-cookieconsent v3 sits around 15–17 KB gzipped (JS + CSS bundled); Klaro's full bundle is ~57 KB gzipped; CookieYes CDN delivers ~100 KB+. Cookyay must be held to budget in CI or it will creep past it.
- Banner injection is a well-documented cause of Cumulative Layout Shift. Fixed/overlay positioning is non-negotiable; any inline block-pushing placement will fail Core Web Vitals at the first Lighthouse audit.
- Re-executing blocked scripts after consent grant is a hidden jank source. Injecting several heavy third-party scripts synchronously on the Accept click produces long tasks that spike Interaction to Next Paint (INP).

---

## Findings

**1. Synchronous head placement is required for correct script blocking** `[prd.md §3.2]`

The library must read stored consent and set up its intercept mechanisms before the browser's HTML parser reaches any third-party `<script>` tag. If the library is loaded with `async` the browser races it against other scripts; if loaded with `defer` it runs after parsing completes — both create a window where a tracking script fires unconsented. The correct pattern is a plain `<script src="cookyay.js">` (no attribute) in `<head>`, or a small synchronous inline bootstrap that configures the intercept, with the heavier UI code deferred. This is render-blocking by necessity for the intercept path — the UI code (banner drawing, animations) does not need to be.

**2. Declarative `type="text/plain"` blocking should be the primary mechanism; MutationObserver is supplementary** `[prd.md §3.2]`

`type="text/plain"` rewrites on the authored HTML are processed at parse time — zero runtime overhead. MutationObserver watching for dynamically injected scripts adds per-insertion CPU cost and fires asynchronously, meaning there is a brief window where a dynamically appended script could execute before the observer fires. MutationObserver should be retained for dynamically-injected third-party scripts (GTM-managed tags, lazy-loaded pixels), but the primary contract with site owners should be: add `type="text/plain" data-category="analytics"` to your tags and the library handles the rest. Automatic DOM scanning is a fallback, not the default hot path.

**3. Banner injection is a CLS risk; overlay/fixed positioning is required** `[prd.md §3.1, §3.8]`

Banners that insert as block-level elements push page content, causing CLS scores well above the 0.10 threshold Google uses as a ranking signal. The banner must use `position: fixed` or `position: sticky` and never inject itself into the document flow. For returning visitors where consent is already stored, the banner must not render at all — the consent-check inline snippet should suppress the banner paint entirely, not rely on a post-paint hide. This is the most common implementation mistake in open-source CMPs.

**4. The 20 KB budget is achievable but CSS-in-bundle is the preferred approach** `[prd.md §3.1, goals.md §Acceptance bar]`

Bundling CSS into the JS (via esbuild `--bundle`, injecting a `<style>` tag at runtime) avoids a second HTTP request and means the full library ships as one file that CDN users can drop in. Separating JS and CSS forces two HTTP round-trips for self-hosters on HTTP/1.1. Budget allocation rough guide: ~10–12 KB for JS logic (consent state machine, Consent Mode v2 signals, GPC detection, MutationObserver intercept) and ~3–5 KB for minified CSS. No polyfills for IE11 or legacy Edge — target ESNext and rely on the `<20 KB` constraint to keep polyfill pressure off. Use esbuild for production builds (fastest, excellent tree-shaking, built-in minify+gzip reporting); a CI step should run `gzip -9` on the output and `test $(stat -f%z cookyay.min.js.gz) -lt 20480` (or equivalent) to fail the build on budget breach.

**5. Consent state must be read from a cookie, not localStorage, for the synchronous head check** `[prd.md §3.5]`

The inline bootstrap script that runs in `<head>` cannot use `localStorage` reliably across all browser configurations (private-browsing mode, third-party storage restrictions). More critically, reading a named cookie in a tiny inline script adds ~0 ms latency, whereas localStorage requires a synchronous read that must resolve before the parser can continue. For the hot path (returning visitor, consent already given), the library should read a lightweight cookie (`cookyay_consent=...`) to suppress the banner and set `window.dataLayer` consent defaults before GTM fires. `localStorage` can be used as a secondary store for richer metadata (timestamp, policy version, granular choices) but must not be on the critical render path.

**6. Re-execution of blocked scripts after Accept is a hidden INP hazard** `[prd.md §3.2, §3.4]`

When a user clicks Accept, the library may need to inject 5–10 previously blocked third-party scripts simultaneously. Injecting them all synchronously on the click handler creates a long task that freezes the page for hundreds of milliseconds, violating the INP threshold of 200 ms. The consent-grant path should: (a) update stored consent and fire Consent Mode v2 signals immediately and synchronously (GTM needs this fast); (b) yield to the browser via `setTimeout(fn, 0)` or `scheduler.yield()` before injecting deferred scripts; (c) stagger large script injections if more than 2–3 are queued.

**7. The library becoming the Largest Contentful Paint element is a real risk** `[prd.md §3.1]`

If the banner is the first large painted element and the actual hero content is blocked by consent-gated analytics scripts, Lighthouse will flag the banner as LCP. The library must not mark any of its text or images with `elementtiming` attributes, and the banner should paint after a microtask yield so the browser's LCP heuristic has a chance to find real page content first.

---

## Gotchas

- **async/defer on the main script tag breaks prior blocking.** Site owners will instinctively add `async` for performance. The README must explicitly warn against this and explain the trade-off.
- **Inline bootstrap + deferred UI split is architecture, not an optimisation.** If the library is shipped as a single file intended to be loaded with no async/defer, the entire JS (including banner rendering and i18n) is render-blocking. Splitting into a tiny synchronous bootstrap (~2 KB inline or tiny external) and a deferred UI bundle is the correct design, not optional.
- **GPC header detection requires reading `navigator.globalPrivacyControl`** early in the page lifecycle. If this check is deferred, the GPC signal may be missed. It must be in the synchronous bootstrap path [prd.md §3.3].
- **Consent cookie size.** Cookies are sent with every HTTP request. The consent cookie should be small (JSON-encoded bitfield or a short string like `n:1,f:1,a:0,m:0|v:2|t:1234567890`), not a full JSON blob. Keep it under 200 bytes.
- **MutationObserver + `type="text/plain"` interacts badly with some GTM setups** where GTM removes the `type` attribute before injecting. The intercept must also check `data-category` attributes and potentially wrap `document.createElement` to catch GTM's dynamic injection path.
- **CSS animation for banner entry must not animate `top`, `bottom`, or `height`** — only `transform` and `opacity`, or CLS will be triggered during the animation frame.

---

## Recommendations

1. **Ship a two-part artefact:** a tiny synchronous bootstrap (inline-able, <1 KB) that reads the consent cookie, sets Consent Mode v2 defaults, detects GPC, and configures the `type="text/plain"` intercept; plus a deferred UI bundle (`defer` is safe here) for the banner. This gives correct blocking without making the full UI render-blocking.

2. **Use `position: fixed` bottom-of-screen as the default banner placement.** Zero CLS, minimal LCP interference, broadly accepted UX pattern for consent banners.

3. **CI size gate from day one.** Add an esbuild build step that outputs `cookyay.min.js` and immediately tests its gzipped size. Use `esbuild-plugin-limit-size` or a two-line shell assertion. Fail the build if it exceeds 20 KB. Establish a soft warning at 17 KB to leave room for features.

4. **Declarative `type="text/plain"` as the documented first-class API.** Make MutationObserver interception opt-in (auto-blocking mode) so users who need it can enable it, but the default path avoids the observer overhead.

5. **Stagger post-Accept script injection using `setTimeout(fn, 0)` after the Consent Mode v2 signal fires.** Keep the Accept click handler under ~50 ms of synchronous work.

6. **Store consent as a small cookie for the hot path; replicate to `localStorage` for richer metadata.** Document the cookie name and format so server-side frameworks can read it for SSR consent gates.

7. **No polyfills.** Target Chrome 80+, Firefox 75+, Safari 13+. MutationObserver, `navigator.globalPrivacyControl`, and the Cookie API are universally available in these versions.

---

## Open questions for the user

1. **Bootstrap split:** Is the two-part bootstrap/UI split acceptable for v1, or should the library ship as a single drop-in file even if that means the full script is synchronous? The answer determines whether render-blocking can be avoided.

2. **CSS delivery:** Should the CSS ship bundled inside the JS (single-file drop-in, runtime `<style>` injection) or as a separate `.css` file? Bundled is simpler for CDN users; separate is better for CSP-strict environments that block inline styles.

3. **Auto-blocking mode:** Should MutationObserver-based automatic script interception ship in v1 or be a v2 feature? Auto-blocking significantly widens compatibility but adds complexity and a small ongoing CPU cost.

4. **Banner animation:** Is an entry animation required for v1, or is a simple appear/disappear acceptable? Animations constrain the CSS approach (must use transform/opacity only).

5. **Consent cookie name:** Does the author care about the exact cookie name (e.g., `cookyay` vs a user-configurable name)? Server-side frameworks reading it for SSR need a stable name.

---

## Out of scope

- **Server-side performance** (SSR consent gates, Edge middleware) — PRD is client-only for v1 [prd.md §4].
- **CDN delivery optimisation** (Brotli, HTTP/2 push, cache headers) — the library is self-hosted or via public CDNs; delivery tuning is the host's responsibility [prd.md §3.7].
- **CLI scanner performance** — the scanner is a separate package with heavier deps; its performance profile is distinct from the browser library [prd.md §3.6].
- **i18n bundle splitting** — deferred pending the decision on whether v1 ships translations at all [prd.md §7, goals.md §deferred].

## Update — 2026-06-06
User decisions: **two-part bootstrap accepted** (<1KB sync inline + deferred UI bundle). Declarative-only blocking in v1 — **no MutationObserver auto-detect**. Cookie name fixed: `cookyay_consent`. CSS delivery and banner animation: take report defaults (bundled CSS injection, transform/opacity-only animation), finalize at /pm:architect.
