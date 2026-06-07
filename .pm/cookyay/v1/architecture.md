---
slug: cookyay
version: v1
created: 2026-06-06
inherited_from: ""
status: drafted
---

# Architecture — Cookyay v1

## 1. Deployment topology
**No deployed runtime.** Cookyay ships as static artifacts: an npm-published
browser library (served by site owners or free public CDNs — jsDelivr primary,
per research) and a locally-run Node CLI. The only "deployment" is the docs/demo
site on GitHub Pages, which also dogfoods the banner [prd.md §3.7, §5 cost].

Runtime shape is the **two-part bootstrap** [prd.md Amendment 2026-06-06]:
- `bootstrap` — <1KB synchronous inline snippet: reads `cookyay_consent`, fires
  Consent Mode v2 defaults (all denied, `wait_for_update: 500`), detects GPC,
  arms the `type="text/plain"` script intercept. Must be first in `<head>`.
- `ui bundle` — deferred; banner, preferences modal, GPC toast, re-open link.

## 2. Scaling model
N/A — no server. Scale cost is borne by public CDNs / the host site. The
constraint that replaces scaling: **<20KB min+gzip combined budget**, CI-gated
(size-limit; soft warn 17KB) [goals.md §Acceptance bar].

## 3. Sync vs async work
- Synchronous (render-blocking, deliberately tiny): the bootstrap only.
- Deferred: UI bundle (`defer`), consent-granted script re-injection staggered
  via `setTimeout(fn, 0)` after the Consent Mode update fires (INP guard)
  [research: performance-engineer].
- No queues/background jobs anywhere.

## 4. Data layer
Client-side only [prd.md §3.5]:
- **Hot path:** `cookyay_consent` cookie (SameSite=Lax, configurable domain) —
  small, SSR-readable, checked by the bootstrap pre-paint (CLS guard).
- **Rich record:** mirrored to localStorage — timestamp, banner version, policy
  version, per-category choices. Schema is webhook-ready for v2.
- **Schema evolution:** record carries a `schemaVersion`; unknown versions
  re-prompt rather than crash.

## 5. API style
Browser JS API, no network API:
- `Cookyay.init(config)`, `getConsent()`, `onConsent(category, cb)`,
  `openPreferences()`, plus `data-cookyay-open` attribute binding.
- `cookyay:consent` / `cookyay:change` CustomEvents on `document` for
  zero-coupling integrations (GTM triggers) [research: integration-engineer].
- Versioning: semver on npm; CustomEvent payloads carry `schemaVersion`.
- Config: single JSON object; **every user-visible and ARIA string overridable**
  (English defaults, no bundled locales) [prd.md Amendment].
- Misconfiguration surfaces as structured `console.warn` at init — silent
  config typos are the top DX hazard [research: ux-researcher].

## 6. Consistency & resilience
- Consent state: single source of truth is the cookie; localStorage is a
  replica (cookie wins on disagreement).
- Idempotency: re-running `init()` or re-injecting an already-granted script is
  a no-op (tracked via `data-cookyay-state` attributes).
- Failure posture: if config is broken, **fail closed** — nothing unblocks,
  banner still renders, warnings logged. Withdrawal → "reload required" prompt.

## 7. Identity & auth
N/A — no accounts, no services. npm publish auth via GitHub Actions OIDC
(provenance); no long-lived npm tokens.

## 8. Observability
No telemetry, by design (privacy posture) [prd.md §3.5 "no data leaves the
visitor's device to us"]. Developer-facing observability = structured console
warnings + a `debug: true` config flag for verbose init logging.

## 9. Environments & deployment
- Local dev: pnpm + Vitest watch; demo page served by tsup/esbuild dev server.
- CI (GitHub Actions, free tier): lint + typecheck + unit/component on every
  push; Playwright E2E (Chromium-only) + axe-core + size-limit + publint/attw
  on PRs to main. Playwright browsers cached by version.
- Release: Changesets PR flow → tag → Actions publishes both packages to npm
  with provenance; docs deploy to GitHub Pages on main.

## 10. Tech stack
| Concern | Choice | Reason |
|---|---|---|
| Language / runtime | TypeScript (strict); browser ES2020 / Node ≥20 for CLI | Evergreen-only target, no polyfills [research: performance-engineer] |
| Backend framework | N/A | No server by design [prd.md §4] |
| Frontend framework | None — vanilla TS + DOM | Zero-dependency requirement [prd.md §3.1] |
| Primary database | N/A — cookie + localStorage | Client-side-only record [prd.md §3.5] |
| Cache | N/A (public CDN caching of artifacts) | Static distribution [prd.md §3.7] |
| Queue / bus / jobs | N/A | No async infra |
| Auth provider | N/A; npm via Actions OIDC | Supply-chain hygiene |
| Hosting / infra | npm + jsDelivr (SRI, /+esm); GitHub Pages for docs/demo | $0 at any traffic [prd.md §5] |
| CI/CD | GitHub Actions + Changesets | Free for public repos; PR-based releases |
| Testing | Vitest (jsdom unit) → Vitest browser mode (Chromium) → Playwright E2E + @axe-core/playwright + size-limit | jsdom can't test script re-execution [research: test-strategist] |
| Build / packaging | pnpm workspaces; tsup (ESM + IIFE + bootstrap); publint + attw in CI | Strict deps guard the zero-dep claim |
| Monorepo layout | `packages/cookyay` (banner), `packages/scanner` (@cookyay/scanner, Playwright-based CLI), `fixtures/` (hermetic e2e site), `docs/` | Separate dep profiles [research: test-strategist] |
| Logs / metrics / traces | N/A | No telemetry by design |

## 11. Cross-cutting concerns
- **Security baseline:** no runtime deps in banner (pnpm strict); Dependabot +
  `pnpm audit` in CI; npm provenance; README pins CDN examples to minor version
  tags with SRI integrity attributes; SECURITY.md with disclosure contact.
- **i18n:** English defaults, full string-override config (incl. ARIA labels);
  community locale JSON possible later without API breaks.
- **Accessibility tooling:** @axe-core/playwright + keyboard-nav script in CI;
  non-modal banner default (modal flag), focus-trapped preferences modal,
  `role="switch"` toggles, Escape never records consent.
- **Data retention / privacy:** consent record lives in the visitor's browser;
  expiry default 12 months then re-prompt; policy-version bump → re-prompt.
- **Cost ceiling:** $0 infrastructure, hard constraint [prd.md §5].
- **License:** Apache-2.0 [prd.md Amendment].

## 12. Out of scope for v1
- Auto-detection/MutationObserver blocking mode (v2; declarative-only now —
  note integration report wants MutationObserver for GTM-injected tags, which
  rides on the auto-detect work).
- GTM tag template (.tpl) — documented Custom HTML workaround only in v1.
- Consent webhook, snippet-generator UI, CMS plugins, bundled locales.

## 13. Open questions
None blocking /pm:plan. Two deferred details land during implementation:
`wait_for_update` configurability (default 500ms) and whether the GPC toast
shares the banner's dialog container (a11y review at PR time).

## Amendments

<!-- Append-only. Used by /pm:architect "amend" mode and by /pm:version when carrying forward.
Format:

### YYYY-MM-DD — <short title>
**Why:** ...
**Change:** ...
-->
