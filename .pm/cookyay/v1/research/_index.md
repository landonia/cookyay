# Research index — cookyay v1

Generated: 2026-06-06

## Personas run
- [domain-expert-cmp](domain-expert-cmp.md) — vanilla-cookieconsent v3 is the closest prior art; Cookyay's real differentiators are the CLI scanner and GPC; Consent Mode default ordering demands an inline `<head>` snippet.
- [compliance-and-legal](compliance-and-legal.md) — client-side-only consent record is the biggest compliance gap (Art. 7 burden of proof); GPC on-page confirmation required by CCPA regs from Jan 1, 2026; Apache-2.0 recommended over MIT.
- [accessibility-specialist](accessibility-specialist.md) — EAA (June 2025) makes WCAG 2.2 AA enforceable for consent UIs; non-modal dialog for banner + focus-trapped modal for preferences; toggles must be `role="switch"`.
- [integration-engineer](integration-engineer.md) — seven Consent Mode v2 signals map onto the four categories; unblocking requires clone-and-reinsert of script elements; withdrawal needs a page reload; jsDelivr over unpkg (auto SRI, `/+esm`).
- [test-strategist](test-strategist.md) — jsdom cannot test script re-execution (vacuous passes); three-tier pyramid: Vitest+jsdom → Vitest browser mode → Playwright E2E with hermetic fixture site, axe-core, and size-limit gate.
- [ux-researcher](ux-researcher.md) — "Reject all" must sit on the first layer with equal weight (CNIL/EDPB enforcement line); permanent `openPreferences()` affordance required by Art. 7(3); silent config typos are the top DX hazard.
- [performance-engineer](performance-engineer.md) — split into a <1KB synchronous bootstrap (consent read, CM defaults, GPC, intercept) + deferred UI bundle; suppress banner pre-paint for returning visitors to avoid CLS; stagger script re-injection on grant.

## Cross-cutting open questions

Deduplicated; sources in brackets.

1. **Script blocking mode: declarative-only vs auto-detection of known third parties?** Auto-detect (MutationObserver classification) is a major scope increase. [domain-expert-cmp #3, performance-engineer #3]
2. **i18n in v1:** English-only with every visible string (incl. ARIA labels) overridable via config, or bundled locales? Retrofitting post-launch is a breaking API change. [domain-expert-cmp #2, accessibility-specialist #4, ux-researcher #3, test-strategist #4]
3. **Bootstrap architecture:** tiny synchronous inline/bootstrap script + deferred UI bundle, vs single drop-in file? Determines render-blocking story and the README snippet. [performance-engineer #1, domain-expert-cmp #1]
4. **Package layout:** one npm package or monorepo with `cookyay` + `cookyay-scanner`? And should the scanner reuse Playwright (shared with tests) instead of Puppeteer? [test-strategist #1, #3]
5. **License: Apache-2.0 (recommended for patent grant) or MIT?** [compliance-and-legal #4]
6. **GPC UX:** silent application vs visible confirmation (toast)? CCPA regs effective Jan 1, 2026 require explicit on-page confirmation. [compliance-and-legal #3, ux-researcher #2]
7. **Re-open affordance:** auto-inject a persistent "Cookie settings" link (opt-out) vs developer-placed `data-cookyay-open` (opt-in)? [ux-researcher #1]
8. **Consent cookie attributes:** name stability, `SameSite=Strict` vs `Lax`, cross-subdomain domain scope — configurable? [compliance-and-legal #5, domain-expert-cmp #4, performance-engineer #5]
9. **Initial banner: modal vs non-modal, and what does Escape do?** Modal trivially satisfies WCAG 2.4.11; Escape must never record consent. [accessibility-specialist #1, #2]
10. **Withdrawal behavior:** silent `location.reload()` vs "reload required" prompt? [integration-engineer #3]
11. **Scanner output:** ready-to-use config JSON vs human-reviewed audit JSON? [domain-expert-cmp #5]
12. **GTM support depth:** published GTM tag template (`.tpl`) vs documented workaround for the Sandbox API issue? [integration-engineer #1]
13. **Module format:** ESM-only + IIFE CDN build, or dual CJS+ESM? [integration-engineer #4]
14. **Consent Mode defaults for all visitors:** `denied` everywhere under strictest-everywhere, even for non-EEA? [ux-researcher #5]
15. **Browser support matrix:** evergreen-only? Determines test tooling. [test-strategist #2]
16. **CI vs real-site scanner test:** acceptance bar names the author's real site — keep that manual, hermetic fixture in CI? [test-strategist #5]
17. **Minor UX/a11y choices:** "necessary" toggle presentation, banner animation, dev-mode contrast warning, VPAT publication, `wait_for_update` configurability, event namespace versioning. [ux-researcher #4, performance-engineer #4, accessibility-specialist #3/#5, integration-engineer #2/#5]

## Resolutions — 2026-06-06
All 17 questions were answered by the user the same day (details appended as `## Update` sections in each report):
1. Declarative-only blocking in v1 (auto-detect → v2). 2. English defaults + full string-override config, no bundled locales. 3. Two-part bootstrap (<1KB sync inline + deferred UI bundle). 4. Monorepo: `cookyay` + `@cookyay/scanner` (Playwright-based). 5. Apache-2.0. 6. GPC visible confirmation toast. 7. Auto-injected re-open link with opt-out. 8. `cookyay_consent`, SameSite=Lax, configurable domain. 9. Non-modal banner default + modal config flag; Escape never records consent. 10. Withdrawal: "reload required" prompt. 11. Scanner emits ready-to-use config with confidence annotations. 12. GTM: documented workaround in v1. 13. ESM-only + IIFE CDN build. 14. Consent Mode defaults denied for all visitors. 15. Evergreen browsers only. 16. Hermetic fixture in CI; real-site scan manual. 17. Minor items: research defaults, finalize at /pm:architect.

## Recommended next step
The answers materially change the PRD (license, architecture, package split, GPC toast). Run `/pm:amend cookyay` to fold them in, then `/pm:plan cookyay` (or `/pm:architect cookyay` first for the architecture.md).
