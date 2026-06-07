# Compliance & Legal — Research findings

> **Not legal advice.** This document is a research summary intended to inform implementation decisions. Consult qualified legal counsel before making compliance claims about any product.

## Summary

- GDPR Art. 7 + ePrivacy Directive require opt-in prior consent, equal-weight Accept/Decline presentation, easy withdrawal, and — critically — the **controller must be able to demonstrate consent was given** (Art. 7(1) + Art. 5(2) accountability). A client-side-only consent record satisfies the *visitor's* device but is weak evidence for a controller facing a regulator; the PRD must communicate this limitation clearly to site owners.
- The consent-preference cookie/localStorage entry used to remember the visitor's choice is itself exempt from consent as "strictly necessary" under ePrivacy Art. 5(3) — but only that one entry; all other non-essential storage still needs prior consent.
- CCPA/CPRA already mandates honoring the Global Privacy Control (GPC) as an opt-out of sale/sharing, and starting January 1, 2026, sites must provide explicit confirmation to the user when a GPC signal is honored. The "strictest everywhere" posture satisfies this, but the GPC detection + acknowledgment must be implemented correctly at runtime, not just described.
- Apache-2.0 is marginally preferable to MIT for a library targeting corporate adoption because it includes an explicit patent-grant clause that matters to enterprise legal teams, while remaining compatible with nearly all open-source ecosystems.

---

## Findings

**1. GDPR Art. 7 / ePrivacy: what the banner must do** `[prd.md §3.3]`

The ePrivacy Directive Art. 5(3) is the lex specialis that triggers consent before any non-essential storage access. GDPR Art. 4(11) + Art. 7 define what valid consent looks like: freely given, specific, informed, unambiguous affirmative action. The EDPB Cookie Banner Taskforce (2023) and CNIL enforcement (2025 fines against Google totalling €325 M) confirm:

- Accept and Decline options must be **visually equivalent** — same font size, same color contrast, same click count.
- Pre-ticked boxes and "consent by continued browsing" are invalid.
- Withdrawal must be **as easy as giving consent** — a persistent footer link or re-open icon is required.
- Banner must name the **purposes, third-party recipients, and retention periods** (or link to a cookie policy that does).

All four of these are implementation requirements for `§3.1` (banner UI) and `§3.2` (script blocking).

**2. The consent cookie itself is exempt — narrowly** `[prd.md §3.5]`

Under ePrivacy Art. 5(3), storing/reading information on a terminal is permitted without consent only if it is "strictly necessary to provide a service explicitly requested by the user." The EDPB Guidelines 02/2023 (final version Oct. 2024) interpret this narrowly. A single cookie or localStorage key that stores only the visitor's consent choices qualifies as strictly necessary — the banner itself is the requested service. No other cookies written by the library (e.g., any analytics helper) would share this exemption. Implementation must set *only* the consent-state record before consent is granted; all other writes must be gated.

**3. Client-side consent record is a weak accountability posture** `[prd.md §3.5, §4 non-goals]`

GDPR Art. 7(1) places the burden of proof on the **controller** (the site owner, not Cookyay). Art. 5(2) accountability requires the controller to demonstrate compliance on demand. A browser-local record satisfies the visitor experience but cannot be queried by the site owner when a regulator asks "show me the consent record for user X on date Y." Enforcement in 2025–2026 has specifically targeted organizations unable to produce consent logs on demand (Italy's Garante). The PRD's §3.5 posture (client-side only, no server infrastructure) is acceptable as a default for small/zero-budget sites, but Cookyay must:

- Document this limitation prominently (README + comparison page §3.8).
- Design the consent record schema so site owners can optionally forward it to their own backend (the v2 webhook mentioned in `goals.md §deferred`).
- Store enough in the browser record (timestamp, policy version, per-category choices, banner version shown) so it is at least partially useful as evidence.

**4. CCPA/CPRA + GPC: runtime honoring required** `[prd.md §3.3, goals.md §What ships in v1]`

The CPRA (effective 2023) and CCPA regulations require businesses to honor GPC as an opt-out of sale/sharing without requiring additional steps from the user. Multi-state enforcement sweeps in September 2025 targeted companies not honoring GPC. Starting **January 1, 2026**, updated CCPA regulations require explicit on-page confirmation to the visitor when a GPC signal is honored. Because v1 ships at an unspecified date, this confirmation UI is a live requirement. The "Do Not Sell or Share" persistent link is also required on every page for businesses subject to CCPA — Cookyay must generate or require this link and cannot make it optional.

**5. "Strictest everywhere" covers UK GDPR and Brazil LGPD for the core opt-in** `[prd.md §3.3]`

UK GDPR + PECR are substantively identical to EU GDPR for cookie consent. The UK's Data Use and Access Act (June 2025) introduced five narrow exemptions for low-risk cookies but analytics and marketing cookies remain opt-in only. Brazil's LGPD requires opt-in consent and Portuguese-language notices. The opt-in-everywhere posture satisfies both jurisdictions' core requirement. Key gap: LGPD technically requires Portuguese for Brazilian users. Since Cookyay v1 is English-only `[goals.md §deferred — translations]`, the library should expose i18n hooks from the start so site owners can supply translated strings without a library rewrite.

**6. License: Apache-2.0 preferred for corporate-facing library** `[prd.md §5 constraints]`

MIT and Apache-2.0 are both permissive and compatible with virtually all open-source dependencies. The decisive difference for a consent library distributed via npm and embedded in corporate sites: Apache-2.0 includes an explicit patent grant from contributors, which matters to enterprise legal reviewers. Over 53% of npm packages use MIT (lower friction for individual contributors), but Apache-2.0 is the norm for SDKs adopted by Google, Microsoft, and Amazon. For Cookyay — a library corporate sites will drop into production — Apache-2.0 signals legal maturity without adding meaningful friction for community contributors.

---

## Gotchas

1. **Equal-prominence Decline button is not optional.** Many implementations hide or deprioritize the Decline path. Regulators have fined specifically for this. The `§3.1` banner must enforce equal visual weight in CSS defaults.

2. **GPC January 2026 confirmation requirement.** If v1 ships after January 1, 2026 and targets California traffic, the library must render a visible acknowledgment when GPC is detected (e.g., a notice in the banner or a toast). Implementing GPC detection without the confirmation UI will be non-compliant for CCPA-subject sites.

3. **The consent-cookie exemption breaks if the library writes anything else before consent.** If the script sets any third-party or analytics helper storage alongside the consent record before a choice is made, the exemption is lost and the entire library is pre-consent non-compliant. Audit the initialization path carefully.

4. **"Policy version" in the consent record is mandatory for re-prompt logic.** GDPR requires re-collecting consent when the purposes change materially. Without versioning the stored record `[prd.md §3.5]`, site owners have no mechanism to trigger the required re-prompt. This must be in the v1 schema.

5. **Consent withdrawal must undo script execution, not just block future scripts.** `[prd.md §3.2]` Re-executing scripts on grant is straightforward; on withdrawal, already-executed analytics/marketing scripts may have set their own storage. The library cannot fully clean up third-party state, but it should document this and provide a `clearOnWithdraw` hook or page-reload strategy.

6. **"Do Not Sell or Share" link is a per-page persistent requirement under CCPA** — it is not the same as the consent banner and cannot be satisfied by the banner alone.

---

## Recommendations

1. **(Critical) Document the client-side consent record limitation clearly** in the README and the `§3.8` comparison page. Tell site owners: "For full GDPR Art. 7(1) accountability, forward consent events to your own backend. Client-side storage alone does not satisfy proof-of-consent obligations if you are audited."

2. **(Critical) Design the consent record schema in v1 to be webhook-ready.** Even if the webhook ships in v2, the stored object must already include: ISO-8601 timestamp, consent banner version string, per-category boolean map, policy version, and user agent/locale. This avoids a breaking schema change later.

3. **(High) Implement GPC confirmation UI before shipping.** Detect `navigator.globalPrivacyControl === true` and render a visible acknowledgment. Target completion before January 1, 2026 given the CCPA regulatory change.

4. **(High) Default CSS must give Accept and Decline equal visual weight.** Make this a test in CI (e.g., compare computed button styles) so a theme override cannot accidentally violate it.

5. **(Medium) Add i18n string hooks from day one** even if v1 ships English-only. Expose all user-visible strings as a config object so LGPD/UK GDPR site owners can provide translated text without forking.

6. **(Medium) Choose Apache-2.0 as the project license.** Update `prd.md §5` to close this open question.

7. **(Low) Include a minimal "what this library cannot do" section** in the `§3.8` comparison page: no server-side consent log, no IAB TCF certification, no geo-detection, no built-in translations. Honesty here builds trust and manages expectations.

---

## Open questions for the user

1. **Who is the "controller" Cookyay is designed for?** If primarily solo developers / micro-businesses, the client-side-only posture is arguably acceptable for their risk profile. If Cookyay aims at SMBs with EU DPOs, a first-party webhook or export feature becomes more urgent. This changes the v1 scope vs. v2 scope decision.

2. **Will the `§3.8` comparison page include a compliance disclaimer sufficient to satisfy the PRD's "not legal advice" stance?** Should it be in-library (banner footer text) or only in documentation?

3. **Is the January 2026 CCPA GPC confirmation requirement already known and in scope?** This appears to be a live requirement if the library is intended for California-traffic sites at launch.

4. **Apache-2.0 or MIT?** The analysis favors Apache-2.0 for corporate adoption. Is there a specific reason the author prefers MIT (e.g., contributor friction concerns, dependency compatibility with a specific ecosystem)?

5. **Should the consent record cookie use `SameSite=Strict`?** This is a technical detail but affects cross-site embedding scenarios (iframes). Clarifying intended embedding use cases would inform the cookie attribute defaults.

---

## Out of scope

- **IAB TCF (Transparency and Consent Framework):** The PRD explicitly excludes TCF registration. TCF compliance requires vendor registration, consent string encoding, and ongoing governance — out of scope for a lean open-source library.
- **HIPAA / SOC 2:** No health data processing is involved. Not applicable.
- **Detailed per-country ePrivacy national implementations:** The EU ePrivacy Directive has been implemented differently across member states (e.g., Germany's TTDSG, France's CNIL guidelines). The "strictest everywhere" posture satisfies the most restrictive implementations; per-country nuance is out of scope for v1.
- **Cookie classification database legal liability:** The CLI scanner `[prd.md §3.6]` classifies cookies by service. Whether a misclassification creates legal exposure for Cookyay (as the tool author) vs. the site owner is a distinct legal question not addressed here.
- **GDPR reform / Digital Omnibus (proposed Nov. 2025):** The EU Commission's proposed reform of cookie consent rules (potentially narrowing when banners are required) is in proposal stage only and has no current effective date. Not actionable for v1 planning.

## Update — 2026-06-06
User decisions: license is **Apache-2.0**. GPC honoring gets a **visible confirmation toast** (meets the Jan 1, 2026 CCPA reg). Client-side-only record stands for v1 with the limitation documented in README + comparison page; record schema to be webhook-ready. Cookie defaults: `cookyay_consent`, SameSite=Lax, configurable domain. Target controller: solo devs / micro-businesses (the PRD's stated audience).
