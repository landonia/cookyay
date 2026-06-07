# UX Researcher — Research findings

## Summary

- **Reject-all on the first layer is now a hard regulatory requirement**, not a best practice. CNIL, the Belgian DPA, and the EDPB Cookie Banner Taskforce all require a "Reject all" button visually equivalent to "Accept all" on the banner's first surface — hiding it behind "Manage Preferences" is an enforcement target in 2025–2026.
- **Withdrawal must be permanently accessible.** GDPR Article 7(3) demands consent withdrawal be as easy as giving it; a persistent footer link reopening the preference centre is the minimum accepted implementation.
- **GPC signal handling is rapidly hardening.** CCPA/CPRA already mandate honoring `Sec-GPC: 1`; the California Opt Me Out Act (AB 566, Oct 2025) requires browser-level support by Jan 2027, and a multistate enforcement sweep (Sep 2025) is actively targeting non-compliant sites.
- **The developer onboarding path is the single most common failure mode for open-source consent libraries.** Complex or ambiguous config — especially around category-to-script mapping — causes silent misconfiguration that leaves sites non-compliant without any visible error.

---

## Findings

**1. Reject-all button must appear on the first banner layer with equal visual weight.**
CNIL's formal notices and the EDPB Cookie Banner Taskforce report (Jan 2023, reinforced through 2025) require that "Refuse all" and "Accept all" appear on the same layer with comparable size, colour, and visual weight. Hiding rejection behind a secondary "Manage preferences" route constitutes a dark pattern and is now actively fined (Google €325 M, Shein €150 M in 2025). Cookyay's default theme must render both buttons identically styled — same height, same border-radius, same font weight — making asymmetric styling a deliberate opt-in deviation, not the default. `[prd.md §3.1]` `[prd.md §3.3]`

**2. Granular toggles on the first layer reduce acceptance rates and increase cognitive load.**
Studies (2024–2025) show that exposing granular category toggles on the first layer decreases consent opt-in by 8–20 percentage points compared to a binary first layer. The recommended pattern is: first layer = Accept all / Reject all / Manage preferences (three equal-weight actions), with granular toggles exposed only in a second-layer preferences modal. This also avoids "banner fatigue" — users who must read and toggle multiple switches abandon the banner without interacting. `[prd.md §3.1]` `[prd.md §3.3]`

**3. Withdrawal/re-open affordance requires a permanent, always-visible access point.**
The EDPB requires withdrawal to be as easy as consent. A persistent footer link (e.g., "Cookie settings") that reopens the preference modal is the de facto standard. A floating badge/icon is an alternative but adds visual clutter. The library must emit a DOM hook (e.g., a `data-cookyay-open` attribute or dispatching a custom event) so developers can wire any element on their page to reopen the banner — this is the composable, self-hosted-friendly approach. `[prd.md §3.1]` `[prd.md §3.5]` `[goals.md §Acceptance bar]`

**4. Policy-version re-prompt is required when material changes occur.**
Consent stored under a previous `policy_version` value becomes stale when the site adds new cookie categories or materially changes data processing. The consent record `[prd.md §3.5]` must store the version at the time of consent, and the library must re-surface the banner when the current config version differs from the stored version. Best practice is annual re-prompt at minimum; any addition of a new non-necessary category requires immediate re-prompt. The developer must be clearly instructed to bump the version in config when they add or reclassify scripts.

**5. GPC signal (`navigator.globalPrivacyControl`) must be honored automatically without developer action.**
Under `[prd.md §3.3]` ("always-present 'Do Not Sell or Share' link and GPC signal honoring"), the library must read `navigator.globalPrivacyControl === true` on page load and treat it as an automatic opt-out from marketing/analytics categories before the banner is shown. Critically, as of Jan 2026, the CPRA regulations also require explicit user-facing confirmation that the signal was honored — the library should either suppress the banner and show a small toast/notice ("Your privacy preference was detected and applied") or apply GPC silently and ensure the preference centre reflects the opted-out state. `[prd.md §3.3]`

**6. JavaScript-disabled visitors: `<noscript>` tags on third-party scripts are not GDPR-safe.**
If a developer embeds a Google Analytics or Meta Pixel snippet verbatim, those snippets often include `<noscript>` fallback tags (e.g., `<noscript><img src="..."/></noscript>`) that fire pixels even when JS is off. The library cannot intercept these. The scanner output and README must explicitly warn: "remove all `<noscript>` fallback tags from third-party scripts — they bypass script blocking and are not GDPR compliant." The library itself can do nothing here; the developer must act. `[prd.md §3.2]` `[prd.md §3.6]`

**7. Developer onboarding (15-minute bar) is broken by silent misconfiguration.**
The two most common failure modes for open-source CMP libraries are: (a) a script assigned to a category that is never toggled by the banner (e.g., category name typo), leaving the script always-active; and (b) a category defined in config with no scripts assigned, producing an empty toggle that confuses visitors. The library should emit `console.warn` (not `console.error`, to avoid breaking CI pipelines) for both cases during initialization: `[cookyay] Script "gtag.js" references undeclared category "analytics" — it will not be blocked.` and `[cookyay] Category "functional" has no declared scripts.` `[goals.md §Acceptance bar]` `[prd.md §3.2]`

**8. Banner vs. modal layout: content-blocking overlay is a dark-pattern risk.**
Full-screen modals that prevent page interaction until consent is given ("consent walls") are prohibited under GDPR unless the site offers a genuine paid/non-tracking alternative (the "cookie wall" doctrine). The default layout must be a bottom or top banner — non-blocking. The modal used for granular preferences (second layer) is fine to be a dialog overlay since the user actively opened it. `[prd.md §3.1]` `[prd.md §3.3]`

---

## Gotchas

- **"Necessary" category must never have a toggle.** Toggling necessary cookies off is not legally meaningful and creates confusion. The UI must display necessary cookies as locked-on, with a visual explanation, not a disabled checkbox (disabled checkboxes imply it could be enabled, which implies choice). Use a lock icon or greyed static label.
- **Consent re-prompt on version bump must not show the full banner on pages where the visitor has not yet scrolled** — if the banner auto-appears immediately on every page visit for returning users, it reads as a dark pattern. Re-prompt should trigger on next page load, not mid-session.
- **GPC + existing consent record collision:** if a user previously accepted marketing cookies and then later enables GPC in their browser, the library must detect the GPC signal on each page load and override the stored consent — stored consent does not override a live GPC signal for CCPA opt-out purposes.
- **Consent Mode v2 default state** (`[prd.md §3.4]`): gtag must be called with `gtag('consent', 'default', {...})` before any other gtag calls, including the `gtag('js', new Date())` initialization. If the developer loads Cookyay after their existing gtag snippet, the default consent state fires too late. The README must make load-order explicit and flag it as a common breakage point.
- **The `<script type="text/plain">` blocking pattern** (common in other CMPs) is not supported natively by browsers for `<iframe>` elements — a different interception strategy (replacing `src` with `data-src`) is needed for iframes, and this must be documented as a required markup change.

---

## Recommendations

1. **Ship a strict default theme where Accept-all and Reject-all are identical in appearance.** Allow theming to diverge only through explicit class overrides. This makes compliance the path of least resistance. `[prd.md §3.1]`

2. **Three-action first layer only:** Accept all | Reject all | Manage preferences. Move all granular toggles behind "Manage preferences." This is both more compliant and produces better UX — users who want granularity can get it without the first layer being overwhelming.

3. **Emit structured console warnings for misconfiguration at init time.** A category name mismatch between config and a `data-category` attribute on a script should be an unmissable developer-mode warning. Consider a `debug: true` config flag that surfaces a visible on-page overlay listing misconfigurations.

4. **Provide a `data-cookyay-open` attribute and a `window.cookyay.openPreferences()` API** so developers can trivially wire a footer link, a floating badge, or any custom element to reopen the consent UI. Document this as the primary withdrawal mechanism pattern.

5. **Handle GPC before rendering the banner.** On each page load: read `navigator.globalPrivacyControl`; if true, apply opt-out to all non-necessary categories, store that state, and skip the banner (show a brief non-intrusive GPC-honored notice instead). If the stored consent already reflects GPC opt-out, skip even the notice.

6. **Version the consent record and re-prompt on version mismatch.** Store `{version, timestamp, choices}` in localStorage. On load, if `config.policyVersion !== storedConsent.version`, clear the stored record and re-surface the banner. Document that developers must bump `policyVersion` in their config when adding or reclassifying cookies.

7. **Add a `<noscript>` audit step to the CLI scanner output.** The scanner (`[prd.md §3.6]`) should detect `<noscript>` tags within third-party embeds and flag them in the generated config with a warning comment.

8. **README must address load order explicitly** — Cookyay's `<script>` tag must appear before any analytics/marketing script tags, and the Consent Mode v2 default state setup must be shown as the first call in the quickstart example.

---

## Open questions for the user

1. **Re-open affordance ownership:** Should the library inject a persistent "Cookie settings" footer link automatically (opt-out via config), or should it be fully the developer's responsibility (opt-in via `data-cookyay-open`)? Auto-injection is friendlier for the 15-minute onboarding bar but may conflict with existing footers.

2. **GPC notice UX:** When GPC is detected and the banner is suppressed, should the library show any visible confirmation to the visitor (e.g., a small toast), or apply silently? The CPRA Jan 2026 requirement for explicit confirmation tips toward showing something — but the correct UX (toast vs. banner vs. nothing) depends on the author's risk appetite.

3. **Multi-language in v1?** The PRD lists translations as a deferred item but the re-prompt, misconfiguration warning messages, and GPC notice are all user-visible text. If English-only for v1, confirm that the string API (i18n hooks) is designed so consumers can override every visible string — otherwise retrofitting i18n post-launch requires a breaking API change.

4. **"Necessary" cookie toggle behavior:** Lock-icon static label vs. pre-checked disabled checkbox is a minor but visible UX choice that affects how users perceive the library's transparency posture. Does the author have a preference?

5. **Consent Mode v2 default state for non-EEA visitors:** Under the strictest-everywhere posture, should `ad_storage` and `analytics_storage` default to `'denied'` for all visitors, or only when the banner is shown? (Relevant for sites that also have logged-in users with separate consent tracked server-side.)

---

## Out of scope

- **WCAG depth / screen reader implementation details** — covered by the dedicated accessibility persona. Only the flow-level a11y concern (keyboard-traversable banner, focus trap in preferences modal) is noted here.
- **IAB TCF / GPP signal** — explicitly excluded in `[prd.md §4]`. Not investigated.
- **Server-side rendering / SSR hydration** — the library targets `<script>` tag embedding on any stack; SSR-specific consent patterns (cookies set on the server before JS loads) are a v2 concern.
- **Geo-targeted UX variants** — explicitly a non-goal in `[prd.md §4]`.
- **Consent rate optimization beyond compliance** — maximizing opt-in rates through design nudges is out of scope; the library's job is compliance-correct UX, not conversion optimization.

## Update — 2026-06-06
User decisions: re-open affordance is **auto-injected "Cookie settings" link with config opt-out** plus the `data-cookyay-open` binding. GPC gets a **visible confirmation toast**. **English defaults + full string override** for all visible text. Consent Mode signals default **denied for all visitors** (strictest-everywhere). "Necessary" toggle presentation: implementer's choice at build time.
