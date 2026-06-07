# Integration Engineer — Research findings

## Summary

- Google Consent Mode v2 uses **seven named signals** (four required for ads/analytics, three optional for functionality/personalization/security); the `default` call must fire **before** gtag.js or GTM processes any hit, and GTM consumers must use `setDefaultConsentState`/`updateConsentState` Sandbox APIs rather than `gtag('consent','update',...)` or updates are silently queued too late.
- Blocked scripts cannot be re-enabled by toggling `type` back to `text/javascript` on an existing element; the element must be **cloned and re-inserted** to trigger re-execution; blocked iframes unblock by swapping `data-src` → `src`; consent withdrawal requires a full page reload because executed JS cannot be un-run.
- A clean public JS API (event-driven + promise-based) is achievable with zero dependencies and forms the stable integration surface that other tools (GTM tags, analytics, A/B testing) can bind against.
- jsDelivr is the preferred CDN over unpkg for v1 because it auto-generates SRI hashes, supports both IIFE and ESM `/+esm` paths, and provides multi-CDN redundancy; pinning advice and SRI should be first-class in the README.

---

## Findings

**1. The seven Consent Mode v2 signal names** [prd.md §3.4]

The full set is: `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization` (the four "required" v2 signals), plus `functionality_storage`, `personalization_storage`, and `security_storage` (optional, Google treats the last two as implicitly granted unless explicitly denied). Cookyay must at minimum fire all four required signals; mapping the banner's four categories (necessary/functional/analytics/marketing) to signals is: necessary → `functionality_storage` + `security_storage` (always `granted`); functional → `functionality_storage`/`personalization_storage`; analytics → `analytics_storage`; marketing → `ad_storage` + `ad_user_data` + `ad_personalization`.

**2. gtag `default` must precede gtag.js script loading** [prd.md §3.4, goals.md §Acceptance bar]

The Google-documented ordering is: (a) push `dataLayer` + `gtag` stub, (b) call `gtag('consent','default',{...})` with all signals set to `denied` and `wait_for_update: 500`, (c) load `gtag.js` or GTM container. Cookyay's inline snippet must output this block synchronously before any `<script src="...gtag/js?id=...">` tag. If the site owner inserts Cookyay's `<script>` after their GA4/GTM tag, consent defaults are never registered.

**3. GTM consumers need Sandbox API, not gtag commands** [prd.md §3.4]

In a GTM-managed page, the update signal should go through a GTM Custom Template that calls `updateConsentState()` (GTM Sandbox API), not `window.gtag('consent','update',...)`. The gtag command is queued behind pending dataLayer messages, creating a race condition where hits fire before the update is processed. Cookyay should either ship a companion GTM tag template (`.tpl`) or document clearly in the README that GTM sites need to fire the update via a Custom HTML/Template tag that uses `updateConsentState`.

**4. `wait_for_update` window** [prd.md §3.4]

`wait_for_update: 500` (ms) is the widely-used default but should be configurable. It instructs Google tags to pause hit dispatch while the CMP loads an existing consent cookie. If Cookyay reads a stored consent record synchronously on page load (which it should, given §3.5), it can call `gtag('consent','update',...)` before the 500ms window expires and Google tags proceed with the granted state — meaning no data loss for returning visitors.

**5. Script re-execution contract** [prd.md §3.2]

Blocking: set `type="text/plain"` (or a custom MIME like `text/cookyay-blocked`) and store the original `src` or inline content in a `data-*` attribute. MutationObserver watches for late-injected scripts (e.g., from GTM). Unblocking: create a new `<script>` element, copy all attributes except `type`, set `src` or `textContent`, append to `<head>` or original parent — do **not** mutate `type` on the existing element, as browsers ignore that change after the first parse. iframes block/unblock by swapping `data-src` ↔ `src`; the iframe re-fetches automatically on `src` assignment.

**6. DOMContentLoaded dependency for late-consent re-injection** [prd.md §3.2, goals.md §Acceptance bar]

Scripts that rely on `DOMContentLoaded` (e.g., an analytics lib that calls `document.querySelector` at top-level) will miss the event if consent is granted after it fired. The cloned-and-reinserted `<script>` executes synchronously in modern browsers (spec-compliant), so the code runs with full DOM access — no extra workaround needed for most cases. Edge case: libraries that use `document.addEventListener('DOMContentLoaded', ...)` internally will call that handler immediately because `document.readyState === 'complete'` at that point, which is correct browser behavior.

**7. Public JS API contract** [prd.md §3.1, §3.4, goals.md §Acceptance bar]

Recommended minimal API surface (on a `window.Cookyay` or named ESM export):

```
// Lifecycle
Cookyay.run(config): Promise<void>
Cookyay.show(): void
Cookyay.hide(): void
Cookyay.showPreferences(): void

// Consent reads
Cookyay.getConsent(): { necessary: bool, functional: bool, analytics: bool, marketing: bool }
Cookyay.acceptedCategory(name: string): boolean

// Consent callbacks (fire on update)
Cookyay.onConsent(callback: (consent) => void): () => void  // returns unsubscribe fn
Cookyay.onChange(callback: (changed, consent) => void): () => void

// Programmatic accept/reject
Cookyay.acceptCategory(categories: string | string[]): void
```

Events on `document`: `cookyay:consent` and `cookyay:change` (CustomEvent with `detail.consent`) allow zero-coupling integration from any third-party script. This mirrors the proven pattern from CookieConsent v3 (Orest Bida) and avoids global namespace conflicts by namespacing events.

**8. npm `exports` field and CDN distribution** [prd.md §3.7, goals.md §Acceptance bar]

Ship three artifacts: `dist/cookyay.iife.js` (global `window.Cookyay`, for `<script>` tags), `dist/cookyay.esm.js` (for bundlers and jsDelivr `/+esm`), and type declarations `dist/index.d.ts`. `package.json` `exports` map:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/cookyay.esm.js",
      "require": "./dist/cookyay.cjs.js",
      "default": "./dist/cookyay.esm.js"
    }
  },
  "browser": "./dist/cookyay.iife.js"
}
```

jsDelivr IIFE URL: `https://cdn.jsdelivr.net/npm/cookyay@1.x.x/dist/cookyay.iife.min.js` — fetch the SRI hash from `https://data.jsdelivr.com/v1/package/npm/cookyay@1.x.x/stats` or the jsDelivr UI. Advise users to pin to a minor version (`@1.0`) not a major range to receive patches without breaking changes.

---

## Gotchas

1. **Consent default fires after gtag.js**: If a site loads GA4's `gtag.js` script before Cookyay's inline block, Google records the session with no consent defaults — silent GDPR violation. The README must show the exact `<head>` ordering and warn about async loaders that hoist their script tag.

2. **GTM `gtag('consent','update')` race**: Sending consent updates via `window.gtag` inside a GTM Custom HTML tag fires too late (queued behind pending dataLayer pushes). Without the GTM Sandbox API, consent updates do not take effect for the current page's hits.

3. **`wait_for_update` must be set**: Without it, Google tags fire immediately on page load with the default `denied` state, before Cookyay reads the stored consent cookie. Even 300ms is enough; 500ms is the industry standard.

4. **Type mutation does not re-execute scripts**: Changing `scriptEl.type = 'text/javascript'` on an already-parsed element has no effect. Clone + re-insert is mandatory.

5. **YouTube privacy-enhanced mode (`youtube-nocookie.com`) is not sufficient for GDPR**: YouTube nocookie still writes to localStorage and sends data to Google. Full iframe blocking via `data-src` swap is required.

6. **Consent withdrawal requires reload**: Once a marketing script has executed (e.g., Meta Pixel), its memory state cannot be erased without a page reload. The library must trigger `window.location.reload()` on consent withdrawal (or document this limitation clearly).

7. **SRI on dynamic file loads**: If users self-host from npm, they must regenerate SRI hashes when they update. Document this workflow; don't assume CDN-only users.

8. **Dual-package hazard**: If the package ships both ESM and CJS, it can be instantiated twice in the same bundler graph (two separate singleton states for consent). Keep a single canonical state module; export the IIFE build from a separate entry point.

---

## Recommendations

1. **Ship an inline `<head>` snippet** (~200 bytes, sync) that stubs `window.dataLayer` and fires `gtag('consent','default',{all: 'denied', wait_for_update: 500})` before any other script. This is the single most important correctness item for Consent Mode v2. [prd.md §3.4]

2. **Provide a GTM Custom Tag template** (`.tpl` file) that calls `updateConsentState()` via GTM Sandbox API. Without it, GTM-managed sites have a silent race condition. Alternatively, document a GTM Custom HTML workaround using `google_tag_data.iac.push(...)`. [prd.md §3.4]

3. **Implement the seven-signal map explicitly** so the four banner categories map deterministically to all seven gtag signal names. `necessary` always grants `functionality_storage` and `security_storage`. [prd.md §3.4]

4. **Use clone-and-reinsert, never type mutation** for script unblocking; use `data-src` → `src` swap for iframes. MutationObserver for late-injected third-party tags (GTM-injected scripts). [prd.md §3.2]

5. **Emit `cookyay:consent` and `cookyay:change` CustomEvents** on `document` alongside the callback API, so zero-coupling integrations (GTM triggers, other scripts) can react without importing Cookyay. [prd.md §3.1]

6. **Prefer jsDelivr over unpkg** for the CDN recommendation — SRI auto-generation, Brotli, multi-CDN fallback, China availability. Pin README examples to a minor version tag, not `@latest`. [prd.md §3.7]

7. **Trigger reload on consent withdrawal** and document why. Do not attempt to `unload` previously executed scripts. [prd.md §3.2]

8. **Run `publint` and `attw` in CI** to verify the `exports` field is correct before every npm publish. [prd.md §3.7, goals.md §Acceptance bar]

---

## Open questions for the user

1. **GTM support depth**: Should Cookyay ship a first-party GTM tag template (`.tpl`) to handle the `updateConsentState` Sandbox API issue, or is a documented GTM Custom HTML workaround sufficient for v1? A `.tpl` template requires publishing to the GTM Community Gallery.

2. **`wait_for_update` value**: Should it be hardcoded to 500ms or user-configurable? Synchronous consent-cookie reads should not need more than ~50ms, but async setups (e.g., consent from a worker) would need a larger window.

3. **Consent withdrawal behavior**: Is a forced `window.location.reload()` on withdrawal acceptable UX, or should the library surface a "reload required" prompt that the user must dismiss? (Some CMPs do a silent reload, others ask.)

4. **ESM-only vs dual CJS+ESM**: Given the bundle is a browser-only library, ESM-only publishing simplifies the package and eliminates the dual-package hazard. Is CJS compat (Node.js `require()`) needed at all, or can the package be ESM-only with a separate IIFE CDN build?

5. **Custom event namespace collision**: The `cookyay:consent` event name is proposed here. Should it be versioned (`cookyay:v1:consent`) to allow future schema changes without breaking existing listeners?

---

## Out of scope

- **Server-side consent propagation**: The PRD explicitly defers server-side audit logs and webhooks to v2. Not investigated.
- **IAB TCF signal encoding**: PRD §4 explicitly excludes TCF. Not investigated.
- **CMP platform certifications** (Google CMP Partner Program): Certification process not researched — not needed for a self-hosted open-source tool.
- **Meta Pixel / TikTok Pixel re-injection specifics**: Mechanism is identical to GA4 (clone + reinsert); vendor-specific quirks (e.g., Pixel's `fbevents.js` relying on `fbq` stub) are implementation detail, not integration contract.
- **Bundle toolchain selection** (Rollup vs tsup vs esbuild): Covered by architecture persona, not integration.

## Update — 2026-06-06
User decisions: **two-part bootstrap** (inline sync default-consent snippet + deferred UI bundle). GTM v1 support via **documented workaround**, .tpl template deferred. **ESM-only + IIFE CDN build** (no CJS). Withdrawal shows a **"reload required" prompt** rather than silent reload. `wait_for_update` and event-namespace versioning: take report defaults, finalize at /pm:architect.
