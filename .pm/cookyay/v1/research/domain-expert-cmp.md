# CMP Domain Expert — Research findings

## Summary

- **Closest prior art is vanilla-cookieconsent v3 (orestbida):** it covers banner UI, opt-in script blocking, all four Consent Mode v2 signals, and granular category management — but has no CLI scanner, no GPC signal honoring, and bundles a heavier theming surface (~24 KB min+gzip per Bundlephobia). Cookyay's differentiation lives mainly in the scanner and the honest comparison page.
- **Prior script blocking has two distinct problems:** blocking static `<script>` tags (solved cleanly with `type="text/plain"` rewriting) and blocking dynamically injected scripts and iframes (requires a MutationObserver intercept that must fire synchronously before the browser parses the node — this is the most fragile piece of any CMP and the one most often broken).
- **Consent Mode v2 now has four mandatory signals** (`ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`) plus three optional ones; all must be defaulted to `'denied'` before any Google tag loads, then updated on user action — order-of-operations is critical.
- **Consent withdrawal is a hard GDPR requirement that is frequently under-implemented:** scripts must stop firing going forward on revoke; cookies that have already been set cannot always be deleted programmatically (third-party cookies, HttpOnly), so the CMP must document what it can and cannot do.

---

## Findings

**1. vanilla-cookieconsent v3 (orestbida) is the most complete open-source baseline** [prd.md §1, §3.1, §3.2, §3.4]
The library ships banner UI, opt-in/opt-out modes per category, all seven Consent Mode signals (superset of the v2 four), `onConsent`/`onChange` callbacks for script re-execution, and localisation hooks. It is the closest existing implementation to everything in §3.1–§3.4. Cookyay should study its architecture closely but is not a fork candidate because it lacks §3.6 and GPC and does not take the "strictest everywhere" posture of §3.3.

**2. Consent Mode v2 requires four specific gtag signals; all must be defaulted before any Google tag fires** [prd.md §3.4, goals.md §Acceptance bar]
The four signals are `ad_storage`, `analytics_storage`, `ad_user_data`, and `ad_personalization`. The correct pattern is: (a) push `gtag('consent','default',{all:'denied'})` into a `dataLayer` push *before* GTM/gtag.js loads; (b) call `gtag('consent','update',{...})` after the user acts. If the default fires after the tag library loads, Google ignores it and assumes denied — a silent failure that is very hard to detect in testing. As of June 2026, `ad_storage` is also becoming the governing signal for all advertising data in linked Ads accounts, so mapping it correctly to the marketing category is now more important than ever.

**3. The `type="text/plain"` technique only covers statically declared scripts** [prd.md §3.2]
Setting `type="text/plain"` on a `<script>` tag prevents execution, and re-executing on consent requires cloning the node (you cannot simply toggle `type` back; browsers cache the non-execution). For dynamically injected scripts and iframes (GTM-loaded pixels, YouTube embeds added via JS), a MutationObserver watching `document.documentElement` must intercept the node before the browser processes it — this requires the observer to be set up with `subtree:true, childList:true` and must be registered at `<head>` parse time, not `DOMContentLoaded`. Iframe blocking requires replacing `src` with a `data-src` attribute and optionally inserting a visible placeholder to maintain page layout.

**4. GPC has no real-world competitor coverage and is a genuine differentiator** [prd.md §3.3, goals.md §Acceptance bar]
`navigator.globalPrivacyControl` is a boolean readable synchronously in JS. No major open-source CMP auto-honors it by suppressing non-necessary scripts and presenting a pre-denied state. As of 2025, GPC is legally enforceable under CCPA; California will require browsers to ship it natively by January 2027. Hooking it costs ~5 lines of code and is a meaningful differentiator for the comparison page (§3.8).

**5. Consent withdrawal cannot fully delete already-set third-party cookies** [prd.md §3.2, §3.5]
GDPR Art. 7(3) requires withdrawal to be "as easy as giving consent." The CMP can stop re-executing scripts, fire a Consent Mode update back to `denied`, and delete first-party cookies it set itself. It cannot delete HttpOnly cookies or cookies already written by third-party iframes (cross-origin restriction). The consent record in §3.5 must document this limitation explicitly, and the README must tell site owners to inform users that a page reload may be needed for full effect.

**6. The Open Cookie Database (github.com/jkwakman/Open-Cookie-Database) is an importable classification corpus for the CLI scanner** [prd.md §3.6]
It provides CSV/JSON, categorised by Functional / Personalization / Analytics / Marketing / Security, with ~1,100+ entries. It is the canonical community resource and should be bundled (or lazily fetched) by the CLI scanner to bootstrap classification of common cookies. The PRD's suggestion of "top ~20 known services" is a reasonable starting floor (GA4 `_ga`/`_gid`/`_ga_*`, Meta `_fbp`/`_fbc`, YouTube `YSC`/`VISITOR_INFO1_LIVE`, HotJar `_hjid`, Intercom `intercom-*`) — but the Open Cookie Database means the scanner can launch with far broader coverage at minimal ongoing maintenance cost.

**7. The <20 KB size constraint is achievable but tight** [prd.md §5, goals.md §Acceptance bar]
vanilla-cookieconsent v3.1.0 sits at ~24 KB min+gzip (per Bundlephobia), which already exceeds the target. Cookyay's zero-dependency vanilla TS goal, no built-in translations in v1, and a focused UI surface should land under 20 KB min+gzip — but this needs to be a CI gate from day one, not a retrospective check. CSS should be inlined or tree-shaken aggressively; the consent record serialisation (§3.5) can be very small JSON.

**8. Osano's open-source cookieconsent is effectively unmaintained for granular use cases** [prd.md §1]
The Osano OSS library is simple but has no per-category granularity, no script blocking built in, and no Consent Mode support. Klaro! has per-service script blocking and i18n but no Consent Mode v2 and its configuration schema is verbose. Neither is a suitable baseline for Cookyay's goals.

---

## Gotchas

- **Script cloning on consent grant:** you cannot re-enable a `type="text/plain"` script by flipping its type back to `text/javascript`. You must `document.createElement('script')`, copy all attributes, and re-append. Forgetting this makes consent grant appear broken silently.
- **MutationObserver timing:** if the observer is registered after `DOMContentLoaded` (or lazily after the banner script itself loads asynchronously), dynamically injected scripts from GTM will have already fired. The CMP script must be the *first* `<script>` tag in `<head>`, before GTM.
- **Consent Mode default must precede the Google tag:** the `dataLayer` push with the default consent state must appear in a synchronous `<script>` block before the GTM/GA4 `<script src>`. If Cookyay is loaded as a single `<script src>` tag (§3.7), this ordering cannot be guaranteed without a separate tiny inline snippet — this is how every production CMP solves it (CookieYes, Cookiebot: they inject a tiny inline `<script>` that pre-seeds `dataLayer`, separate from the main bundle).
- **Consent record version bump:** when the site owner updates their cookie policy version (§3.5), existing stored consents must be invalidated and the banner re-shown. The consent cookie must store a `policyVersion` field and the CMP must compare it on load.
- **Consent withdrawal + page reload:** dynamically injected scripts that have already run (e.g., a loaded Google Analytics tracker) cannot be "unloaded." Only a page reload fully removes them. The UX should prompt or auto-reload, otherwise the privacy promise is misleading.
- **GPC check must happen before the banner renders, not after:** if the banner is shown and then GPC is detected, you've already caused a flash. Read `navigator.globalPrivacyControl` synchronously on script init and skip the opt-in banner for non-necessary categories — treat it as a pre-denied state.
- **iframe placeholder layout:** blocking iframes without a placeholder breaks page layout (e.g., YouTube embeds collapse to 0×0). The PRD lists iframe blocking under §3.2 — a placeholder mechanism must be included, even a minimal one.

---

## Recommendations

1. **Ship a tiny separate inline consent-mode default snippet** (~200 bytes) that pre-seeds `dataLayer` before GTM/GA4 loads. Document it as a required copy-paste in the README alongside the main `<script src>` tag. This is the most common production failure mode and the clearest gap from vanilla-cookieconsent's approach.

2. **Implement GPC honoring in the banner init path** — read `navigator.globalPrivacyControl` on script load; if `true`, silently apply denied state to all non-necessary categories, store a consent record with `gpc: true`, and suppress the banner. This costs ~10 lines and is a genuine market differentiator.

3. **Use Open Cookie Database as the CLI scanner's classification backbone.** Ingest the CSV at scanner build time, supplement with a hand-curated top-20 list for common services. This immediately makes §3.6 far more useful than a bare headless crawler and reduces ongoing maintenance burden.

4. **Enforce `<20 KB` in CI from the first commit.** Use `bundlesize` or a custom `size-limit` config. Retrofitting a size budget after the fact requires painful rewrites.

5. **Script blocking implementation should handle four cases explicitly:** (a) static `<script type="text/javascript">` — rewrite to `text/plain` at parse time using a data attribute convention (e.g., `data-category="analytics"`); (b) static `<iframe src>` — rewrite to `data-src` plus placeholder; (c) dynamic script injection — MutationObserver intercept; (d) dynamic iframe injection — same observer. Cases (c) and (d) require the observer to be active before GTM loads.

6. **Store the consent record as a first-party cookie (not just localStorage)** — cookies are readable server-side and survive private-browsing incognito restarts better in some browsers. A cookie named `cy_consent` with a short JSON payload satisfies §3.5 and makes SSR consent-gate patterns possible without requiring additional infrastructure.

7. **Add an automated ARIA smoke test in CI** (e.g., axe-core via Playwright) to verify keyboard trap, focus management, and modal role attributes. This is the cheapest way to sustain the accessibility bar in §3.1 and the Acceptance bar in goals.md.

---

## Open questions for the user

1. **Inline snippet vs. auto-injection for Consent Mode default:** should Cookyay require site owners to paste a two-line inline `<script>` before GTM (simpler, more reliable), or should the main script attempt auto-injection of the default via a synchronous trick (more magical, more fragile)? This decision shapes the "under 15 minutes" setup story significantly.

2. **Banner i18n in v1:** the PRD leaves this open (§7). Even "English + i18n hooks" requires a design decision: string keys in config vs. a bundled locale map vs. an external locale file loaded on demand. The answer affects bundle size and the comparison page story.

3. **Script blocking mode — declarative only vs. auto-scan:** should §3.2 require site owners to declare every blocked script in config (vanilla-cookieconsent style — explicit, reliable), or should Cookyay attempt to auto-detect and block known third-party scripts without declaration (Cookiebot/CookieYes style — convenient but fragile)? Auto-detect is a significant scope increase.

4. **Consent record cookie domain and SameSite policy:** should `cy_consent` be set with `SameSite=Strict` (no cross-subdomain sharing) or `SameSite=Lax`? Should it be configurable? This matters for sites spanning subdomains.

5. **CLI scanner output format:** should the scanner emit a ready-to-use Cookyay config JSON directly, or a separate "audit" JSON that a human then edits into config? The former is more magical; the latter is more transparent and honest about classification uncertainty.

---

## Out of scope

- **IAB TCF (Transparency & Consent Framework):** vendor-oriented, requires registration, significant XML payload overhead, and targets adtech platforms — not relevant to a solo-operated self-hosted tool.
- **Server-side consent logging / webhooks:** explicitly deferred to v2 in goals.md.
- **Geo-detection and regional banner variants:** excluded by PRD §4; the strictest-everywhere posture eliminates this complexity entirely.
- **CMS plugins (WordPress, etc.):** deferred to later versions per goals.md.
- **Legal compliance certification:** out of scope per PRD §4; the "not legal advice" stance is the right call.

## Update — 2026-06-06
User decisions: script blocking is **declarative-only in v1** (auto-detect deferred; CLI scanner offsets manual effort). Consent Mode default ordering solved via the **two-part bootstrap** (inline sync snippet, no auto-injection magic). i18n: **English defaults + full string override config**, no bundled locales. Scanner emits **ready-to-use config JSON with confidence annotations**. Consent cookie `cookyay_consent`, SameSite=Lax, configurable domain.
