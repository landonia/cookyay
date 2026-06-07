# Accessibility Specialist — Research findings

## Summary

- WCAG 2.2 AA is now legally enforceable for EU cookie banners under the European Accessibility Act (in force June 28, 2025); the banner is the first user touchpoint and therefore explicitly in scope. Two new AA criteria — 2.4.11 Focus Not Obscured and 2.4.12 Focus Not Obscured Enhanced — directly affect how a sticky/floating banner must behave.
- The right ARIA pattern is a **non-modal `role="dialog"` with `aria-modal="false"`** for the initial banner (users should still be able to scroll past it), and a **modal `role="dialog"` with `aria-modal="true"` plus a full focus trap** for the preferences panel. Using `role="alertdialog"` is tempting but incorrect — it implies immediate action is required and triggers more aggressive screen-reader interruption than GDPR banners warrant.
- Category toggles must use `role="switch"` (or native `<input type="checkbox">` with clear `on/off` labeling) — *not* a checkbox styled as a toggle. Misusing checkbox semantics is the single most common ARIA failure in existing banners and violates WCAG 1.3.1, 2.4.6, and 4.1.2.
- Because the library is **themeable**, the default theme must ship with passing contrast ratios and the documentation must warn implementers that color overrides transfer WCAG responsibility to them; offering a built-in dev-mode contrast warning (similar to Complianz's approach) would close the gap.

---

## Findings

**1. EAA makes WCAG 2.2 AA a hard legal requirement for the banner** [prd.md §3.1, §3.3]
The European Accessibility Act (Directive 2019/882) entered full force on June 28, 2025. Because the banner is the first interactive element EU visitors encounter, it is in scope. Fines range from €2,000 to €1,000,000 per infraction across member states. Cookyay's "strictest-everywhere posture" [prd.md §3.3] means every visitor's banner must meet WCAG 2.2 AA — no geo-carveout is possible.

**2. WCAG 2.4.11 Focus Not Obscured directly targets sticky cookie banners** [prd.md §3.1, goals.md §Acceptance bar]
A sticky banner that fully covers a focused element behind it fails 2.4.11 (AA). The W3C advisory explicitly names cookie banners as an example. The two compliant solutions are: (a) make the banner modal so the user dismisses it before reaching page content, or (b) add `scroll-padding` / `padding-bottom` to the page body so focused elements are never hidden beneath the banner. This must be a deliberate design decision, not an afterthought.

**3. Banner ARIA role: non-modal dialog, not alertdialog** [prd.md §3.1]
`role="alertdialog"` is semantically incorrect for a consent banner — it implies an emergency requiring immediate response. The correct pattern is `role="dialog"` with `aria-labelledby` pointing to the banner heading and `aria-modal="false"`. Focus should move *into* the banner on appearance (first interactive element) but must not be trapped there, because the non-modal pattern lets users scroll past and interact with page content. The preferences panel, however, should be modal (`aria-modal="true"`) with a full focus trap: Tab/Shift-Tab cycle within it, Escape closes it and returns focus to the element that opened it.

**4. ESC key: must close preferences panel but must not silently accept cookies** [prd.md §3.1, §3.3, goals.md §Acceptance bar]
WCAG 2.1.2 (No Keyboard Trap, Level A) requires a documented means of escape for any focus trap. For cookie consent, Escape must close the preferences panel without recording consent — it should be treated as a "dismiss panel" action that returns the user to the initial banner state, not as a reject or accept. If Escape on the initial non-modal banner dismisses it, it must not set affirmative consent (the strictest-everywhere posture requires explicit opt-in [prd.md §3.3]).

**5. Category toggles: use `role="switch"`, not styled checkboxes** [prd.md §3.1, goals.md §Acceptance bar]
The `role="switch"` communicates on/off semantics that match the visual pattern; `<input type="checkbox">` styled to look like a toggle misleads screen readers about the widget type (violates WCAG 4.1.2 Name, Role, Value). Each switch needs: an `aria-label` or `aria-labelledby` with the category name, `aria-checked="true|false"` toggled on state change, and must be individually reachable by Tab. Disabled/necessary categories should be `aria-disabled="true"` and read-only, not removed from the tab order (removing them leaves screen reader users without confirmation that the category exists). Group switches for a category inside a `<fieldset>` + `<legend>` if there are sub-options.

**6. Screen reader announcement strategy for the banner on page load** [prd.md §3.1, goals.md §Acceptance bar]
Moving focus programmatically into the banner on load is the most reliable announcement method — `aria-live` regions alone are inconsistent across screen reader / browser pairs and may not fire if the region is injected after page load. The banner container should have a visible or visually-hidden `<h2>` (or equivalent) so heading-navigation shortcuts (NVDA `H`, JAWS `H`) can locate it. After the user accepts or rejects from the initial banner, no live-region announcement is needed; after the preferences panel closes, focus should return to the triggering element (typically a "Manage preferences" link).

**7. Theming and color contrast responsibility chain** [prd.md §3.1, §3.8]
The default theme must ship with text/background contrast ≥ 4.5:1 (normal text) and ≥ 3:1 (large text / UI components and focus indicators per WCAG 1.4.3 and 1.4.11). When site owners override CSS custom properties, the library cannot enforce contrast, but the README and comparison page [prd.md §3.8] should clearly state that the implementer assumes WCAG responsibility for any color overrides. A dev-mode helper that logs a warning when detected contrast falls below AA (similar to Complianz's live contrast checker) is a high-value differentiator achievable with the `getComputedStyle` API at zero bundle-size cost in dev builds.

**8. How existing libraries compare** [prd.md §3.1, §3.8]
- **vanilla-cookieconsent (orestbida/v3):** Added WCAG 2.1 keyboard and screen reader fixes (VoiceOver tested); v3 is the most accessible free option but still accumulates open issues on aria-label configurability and focus return after modal close.
- **Klaro:** GitHub issue #100 (open) questions WCAG 2.1 AA/WAI-ARIA compliance; no systematic fix documented.
- **OneTrust:** VPAT report documents multiple keyboard navigation failures (unreachable dropdowns, missing focus indicators) and unlabeled buttons/form fields — significant gaps for a paid CMP.
- **GOV.UK cookie banner:** Cited by multiple audits as a fully WCAG 2.2 AA compliant reference implementation; worth studying directly.

---

## Gotchas

- **`aria-modal="true"` alone does not trap focus** — browsers do not implement it as a focus trap; JavaScript must manually intercept Tab/Shift-Tab in the preferences panel. Failing to write that JS is the #1 silent failure: screen readers may honor `aria-modal` while keyboard users can still Tab out.
- **Injecting the banner after DOM ready delays screen reader pickup.** If the banner is appended to `<body>` after load, `aria-live` regions may already be past the point where the browser announces them. Moving focus explicitly is more reliable than relying on live-region injection.
- **"Necessary cookies" toggle must be visibly disabled and still announced.** A common mistake is hiding it or making it non-interactive without ARIA — screen reader users then have no idea necessary cookies are always on.
- **Focus return after banner dismissal.** If the banner appears on a fresh page load and there was no prior focused element, return focus to `document.body` or the skip-navigation link — not `<html>`. Failing this leaves keyboard users at the start of the document with no cue that the dialog closed.
- **High contrast / forced colors mode.** CSS custom properties for theming may be overridden by Windows Forced Colors / High Contrast modes. Test that focus indicators and toggle states remain visible without relying solely on color.
- **2.4.11 + non-modal banner conflict.** If the banner is non-modal and sticky at the bottom/top, any page element that receives focus while the banner is visible must not be *completely* hidden under it. This is easy to miss when the banner height is dynamic (e.g., expanded preferences text).

---

## Recommendations

1. **Choose modal for the preferences panel, non-modal for the initial banner.** Implement a proper JS focus trap (Tab/Shift-Tab intercept + Escape handler) only for the preferences panel. This distinction matches user expectations and WCAG guidance.

2. **Use `role="switch"` with `aria-checked` for all category toggles.** Never style a checkbox as a toggle switch. Wrap each category in a `<fieldset>` + `<legend>` if additional sub-controls exist.

3. **Move focus into the banner on mount.** Target the first interactive element (typically "Accept all" or a heading). Do not rely on `aria-live` alone for initial announcement.

4. **Add a visible `<h2>` or visually-hidden heading to the banner.** Enables heading-jump navigation; solves the "banner is skipped entirely" failure seen in screen reader audits.

5. **Solve WCAG 2.4.11 deliberately.** Either make the initial banner modal (simplest) or apply `scroll-padding-bottom` (or top) equal to banner height so page content is never obscured behind it when focused.

6. **Ship accessible default contrast ratios and document the responsibility chain.** Publish minimum contrast specs in the README alongside each CSS custom property; add a dev-mode `console.warn` if computed contrast drops below 4.5:1.

7. **Make Escape "dismiss panel, don't consent" not "accept."** Map Escape on the preferences modal to close-without-saving; map Escape on the initial banner to focus the first banner button (do not dismiss the banner silently).

8. **Study GOV.UK's cookie banner as a reference implementation** before finalizing the HTML structure — it is the only publicly audited fully WCAG 2.2 AA compliant free implementation.

---

## Open questions for the user

1. **Modal vs. non-modal initial banner:** Should the initial banner trap focus (modal) or allow users to scroll past it (non-modal)? The modal path trivially solves WCAG 2.4.11 and simplifies focus management, but may feel aggressive on content-heavy pages. Which UX is preferred?

2. **What should Escape do on the initial banner?** Three options: (a) do nothing — user must click Accept/Reject/Manage; (b) move focus to page content without recording consent (truly non-modal); (c) treat as "reject all." Option (a) is the safest for the strictest-everywhere posture [prd.md §3.3]; options (b) and (c) each carry tradeoffs.

3. **Dev-mode contrast warning:** Is a zero-bundle-size dev-build contrast checker in scope for v1, or documented as a v2 item?

4. **i18n and ARIA labels:** If v1 ships English-only [prd.md §7 open question], are `aria-label` strings hardcoded in English or exposed as configuration options? Exposed config is required for non-English sites and affects the API surface.

5. **VPAT / ACR:** Is there an intention to publish an Accessibility Conformance Report (VPAT) for Cookyay? This would be a meaningful differentiator vs. OneTrust's incomplete VPAT, and aligns with the honest parity story [prd.md §3.8].

---

## Out of scope

- **WCAG Level AAA criteria** — the acceptance bar targets AA [goals.md §Acceptance bar]; AAA items (e.g., 2.4.13 Focus Appearance Enhanced, 1.4.6 Contrast Enhanced) are noted but not investigated in depth.
- **Native mobile app accessibility** (iOS VoiceOver, Android TalkBack) — the library is a web script; mobile browser accessibility is covered by the same WCAG criteria.
- **IAB TCF accessibility** — explicitly out of scope for the project [prd.md §4].
- **CMS plugin accessibility** — deferred to later versions [goals.md §What's deferred].
- **Server-side rendering / hydration edge cases** — relevant but an implementation detail, not a design-phase accessibility concern.

## Update — 2026-06-06
User decisions: initial banner is a **non-modal dialog by default with a config flag for modal**; preferences panel always a focus-trapped modal; Escape never records consent. **All ARIA/visible strings are config-overridable** (English defaults) — answers Q4. Dev-mode contrast warning and VPAT: not committed for v1, revisit at planning.
