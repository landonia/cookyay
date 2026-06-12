---
slug: cookyay
title: Cookyay — free, self-hosted cookie consent
created: 2026-06-06
active_version: v7
status: active
shipped_versions: [v1, v2, v3, v4, v5, v6, v7]
---

# Cookyay — free, self-hosted cookie consent

## 1. Problem
Cookie consent management is table stakes for any site with EU/California
traffic, yet the dominant tools (CookieYes, Cookiebot, OneTrust) charge
monthly subscriptions for what is fundamentally a static script plus a
config. The recurring cost exists because vendors host infrastructure
(CDN script delivery, site scanners, consent-log databases) — none of
which a small site actually needs. Site owners who won't pay either run
non-compliant banners or no banner at all.

**Why now:** Google Consent Mode v2 became effectively mandatory for
EEA ad/analytics traffic (2024), pushing even small sites toward paid
CMPs. There's no polished free alternative that covers banner + script
blocking + Consent Mode + scanner end-to-end.

## 2. Users and use cases
- **Primary: developers** building/maintaining sites. Use cases:
  - Drop a script tag + JSON config into any site and get a compliant banner.
  - Block analytics/marketing scripts until consent is given.
  - Pass consent state to Google tags (Consent Mode v2) automatically.
  - Run a CLI at build time to discover cookies and generate the declaration.
- **Secondary (deferred): non-technical site owners** via snippet
  generator / CMS plugins. Not in v1.

## 3. Goals
- **§3.1 Consent banner library** — zero-dependency vanilla TS script,
  <20KB min+gzip, themeable, accessible (keyboard + screen reader),
  granular category toggles (necessary / functional / analytics / marketing).
- **§3.2 Prior script blocking** — declared scripts/iframes stay inert
  until their category is consented; re-execute on grant, support
  consent withdrawal and re-prompt.
- **§3.3 Strictest-everywhere compliance posture** — GDPR-style opt-in
  for all visitors; always-present "Do Not Sell or Share" link and
  Global Privacy Control (GPC) signal honoring for CCPA. No geo
  detection needed or used.
- **§3.4 Google Consent Mode v2 integration** — fire default + update
  gtag consent signals from banner state.
- **§3.5 Client-side consent record** — consent stored in the visitor's
  browser (cookie/localStorage) with timestamp, policy version, and
  choices; no data ever leaves the visitor's device to us.
- **§3.6 CLI cookie scanner** — local tool (headless browser) that
  crawls a site, detects cookies/storage/third-party requests,
  classifies known services, and emits the config JSON.
- **§3.7 Distribution** — published to npm; loadable from public free
  CDNs (jsDelivr/unpkg); fully self-hostable. No infrastructure owned
  by the project.
- **§3.8 Honest parity story** — a comparison page documenting what
  Cookyay covers vs CookieYes, including what it deliberately doesn't do.

## 4. Non-goals
- Hosted anything: no central script CDN we operate, no hosted consent
  log, no dashboard, no accounts.
- Server-side consent audit log (client-side only; optional webhook is
  a possible v2 item, not v1).
- Geo-targeted banner variants / IP geolocation.
- No-code snippet generator UI or CMS plugins (WordPress etc.) — deferred.
- Legal guarantee of compliance — ship with a clear "not legal advice"
  stance.
- IAB TCF registration/certification (heavy, vendor-oriented; out of scope).

## 5. Constraints
- **Cost:** ~zero marginal cost at any traffic level — sites serve the
  script themselves or via free public CDNs.
- **Technical:** zero runtime dependencies for the banner; <20KB
  min+gzip; works as a plain `<script>` tag on any stack. CLI scanner
  is a separate package and may have heavier deps (headless Chrome).
- **Team/budget:** solo, spare-time, open source (license TBD —
  MIT/Apache-2 leaning).
- **Timeline:** _TBD_ — no deadline pressure stated.

## 6. Success metrics
- Running in production on the author's own sites (dogfooding bar).
- The §3.8 comparison page is honest and complete — a developer can
  read it and confidently drop their CookieYes subscription.
- (Tracked but not targets: npm downloads, GitHub stars.)

## 7. Risks and open questions
- **Compliance correctness without legal review** — mitigate with the
  strictest-everywhere posture and explicit disclaimer.
- **Scanner scope creep** — cookie classification needs a maintained
  database of known services; start with the top ~20 (GA4, Meta Pixel,
  YouTube, etc.) and accept community contributions.
- **"Strictest everywhere" UX cost** — US-only sites show an opt-in
  banner they don't strictly need; accepted trade-off for v1.
- **Consent Mode v2 API drift** — Google changes gtag semantics;
  integration must be versioned and testable.
- **Open:** project license; whether banner text ships with built-in
  translations in v1 or English-only + i18n hooks.

## Amendments

<!-- Append-only. Each entry MUST have a date and a reason. Format:

### YYYY-MM-DD — <short title>
**Why:** ...
**Change:** ...
-->

### 2026-06-07 — GPC override must not stomp explicit post-GPC user choices
**Why:** Dogfooding (task 020) in Brave — which enables Global Privacy Control by
default — found that preferences saved via the Cookie settings modal are forgotten
on every reload. Explicit choices write a record with `gpc:false`
(`api.ts:_recordConsent` default param), so on the next page load `_runGpc()`
misreads the record as a stale pre-GPC grant, overwrites it with all-denied, and
re-shows the toast. For GPC-default browsers this makes saved preferences
permanently unpersistable.
**Change:** §3.3 GPC semantics refined: a live GPC signal overrides only consent
records written *without knowledge of* the GPC signal. Any record written while
GPC is live is marked GPC-acknowledged (`gpc:true`), so explicit user choices made
after the GPC opt-out was applied persist across reloads and suppress repeat
toasts. This is CCPA-consistent: §7025(c)(2) permits a consumer's explicit
subsequent consent to override the GPC signal. Pre-GPC stale grants are still
overridden (task 009 AC2 unchanged); the toast still shows exactly once.
Implementation: `_recordConsent` sets the record's gpc flag when GPC is live at
write time (`gpc || window.__COOKYAY?.gpc`).
**Impact on pending work:** Task 009 (done) needs a fix + regression tests
(unit + Playwright: save-prefs-under-GPC → reload → choices persist, no repeat
toast). Task 020 dogfood acceptance should add a GPC-browser persistence check.

### 2026-06-06 — Fold v1 research resolutions into the PRD
**Why:** The /pm:research phase (7 personas) surfaced 17 open questions; all were
answered by the author on 2026-06-06. Several answers change stated PRD scope or
add requirements (see v1/research/_index.md §Resolutions for the full list).
**Change:**
- §3.2: script blocking is **declarative-only** in v1 — site owners declare every
  blocked script/iframe in config; auto-detection of known third parties is
  explicitly deferred to v2.
- §3.3: GPC honoring now requires a **visible confirmation toast** (CCPA regs
  effective 2026-01-01 require explicit on-page confirmation, not silent honoring).
  Consent Mode signals default to denied for ALL visitors, consistent with
  strictest-everywhere.
- §3.1/§3.7: the "drop a script tag" install becomes a **two-part bootstrap** —
  a <1KB synchronous inline snippet (consent read, Consent Mode v2 defaults, GPC
  detection, script intercept) + a deferred UI bundle. The <20KB budget applies
  to the combined deliverables.
- §3.1: banner is a **non-modal dialog by default with a modal config flag**;
  preferences panel is always a focus-trapped modal; Escape never records consent.
  A persistent "Cookie settings" re-open link is auto-injected (config opt-out).
- §3.1 (i18n, closes §7 open question): v1 ships **English defaults with every
  user-visible and ARIA string overridable via config**; no bundled locales.
- §3.5: consent cookie is named `cookyay_consent`, SameSite=Lax, configurable
  domain; record schema must be webhook-ready (timestamp, banner version, policy
  version, per-category choices). Withdrawal surfaces a "reload required" prompt.
- §3.6: scanner is **Playwright-based** and emits ready-to-use config JSON with
  per-classification confidence annotations.
- §3.7: **monorepo, two packages** — `cookyay` (zero-dep banner, ESM + IIFE CDN
  build, no CJS) and `@cookyay/scanner`.
- §5 (closes §7 open question): license is **Apache-2.0**.
- §5: browser support is evergreen-only; CI uses a hermetic fixture site, the
  real-site scanner run stays a manual acceptance step.
**Impact on pending work:** none — no tasks exist yet (planning has not run).
