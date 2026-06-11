---
slug: cookyay
version: v5
created: 2026-06-06
inherited_from: v4
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

### 2026-06-08 — Inherited from v1
**Why:** Starting v2 from the prior version's architecture as the baseline.
**Change:** Copied verbatim. Edit this file or run `/pm:architect cookyay` (amend
mode) to capture v2-specific changes. v2 is a scanner-CLI bugfix; no architecture
change is expected.

### 2026-06-09 — Inherited from v2
**Why:** Starting v3 from the prior version's architecture as the baseline.
**Change:** Copied verbatim. Edit this file or run `/pm:architect cookyay` (amend
mode) to capture v3-specific changes. v3 makes the scanner auto-provision its
Chromium binary on first run (`@cookyay/scanner` ships `playwright` but cold
installs never download the browser); contained to the scanner package's crawl
bootstrap, no broader architecture change expected.

### 2026-06-10 — Inherited from v3
**Why:** Starting v4 from the prior version's architecture as the baseline.
**Change:** Copied verbatim. Edit this file or run `/pm:architect cookyay` (amend
mode) to capture v4-specific changes. v4 adds scanner-side auto-detection of
known third-party scripts: a bundled ~50-service signature database (structured,
contributable data) and a detection/classification pass that emits pre-classified
block declarations into the generated config JSON. Contained to the scanner
package and a new shared signatures asset; the banner runtime contract is
unchanged (blocking stays declarative — §12 "Out of scope for v1" runtime
auto-block remains deferred to v5). Worth an `/pm:architect` amend pass to settle
where the signature database lives in the monorepo and its data schema.

### 2026-06-10 — v4 architecture decisions (amend)
**Why:** `/pm:research` (2026-06-10) found the detection core already exists in
the v3 codebase (`db.ts`: 20 curated + 439 OCD entries; `classifier.ts`:
five-signal pass with confidence; `config-emitter.ts`: per-category grouping).
v4 is **finish + harden + package**, scoped to `packages/scanner`. The banner
runtime contract (§5 API style, the markup-driven `type="text/plain"` blocking)
is unchanged — no edits to §1–3, §7–11. The deltas below resolve the open data
and emitter questions surfaced by research.

**Change — all within `packages/scanner`:**

1. **Signature DB becomes generated-from-data (§4 Data layer / §10 monorepo row).**
   The 20 inline `curated({…})` entries in `db.ts` migrate to a single
   contributor-facing source file `packages/scanner/data/services.yaml`
   (~50 entries), compiled to a generated TS module (`db-curated.generated.ts`)
   by a new `build-services-db.mjs`, mirroring the proven
   `ingest-ocd.mjs` → `db-ocd.generated.ts` pipeline. Generated modules stay
   git-committed and rebuilt in `prebuild`. The OCD-derived DB is untouched.
   - **`ServiceDefinition` schema additions:** `requestPaths?: string[]`
     (path-level matching — Meta `facebook.com/tr`, reCAPTCHA
     `www.google.com/recaptcha/`), `scriptUrlGlobs?: string[]`,
     `iframeSrcGlobs?: string[]` (drive the emitted block markup). A top-level
     `schemaVersion: 1` gates the data file.
   - **Confidence stays computed, never stored** — upgraded semantic: `high` =
     two independent signals agree on the same service (cookie + requestHost
     cross-check in `classifier.ts`), not "came from a curated source"
     [prd.md §3.6].

2. **Emitted config carries ready-to-paste block markup (§5 / §6).**
   `config-emitter.ts` gains a `suggestedBlocking[]` array. Each entry is keyed
   by **host (deduped)** — when multiple services collide on one host
   (GA4 + Google Ads → `googletagmanager.com`) they share one entry that lists
   all justifying `services` — and carries `category`, `confidence`, and a
   rendered `snippet` string: a verbatim-pasteable
   `<script type="text/plain" data-category="…" data-src="…">…`. The emitter
   owns the markup format (single place it's defined).

3. **Fixture stub data is generated from the DB (§9 Environments / testing).**
   `fixtures/service-fingerprints.json` (test stub source) is generated from the
   same `services.yaml` source so it cannot drift as the DB grows to ~50. A new
   hermetic `fixtures/detection/` set of stand-in pages exercises the crawl →
   detect → emit path, asserted against a second golden file
   `e2e/expected-detection-config.json` (regenerated deliberately on DB changes).

4. **CI gate for community contributions (§9 / §11 security baseline).**
   A `prebuild` validator checks `services.yaml` against the schema: required
   fields, valid category enum (necessary/functional/analytics/marketing), unique
   `id`s, and ≥1 match signal per entry. Only the **Apache-2.0** Open Cookie
   Database is license-safe to ingest; EasyPrivacy/Disconnect/Ghostery (GPL /
   non-commercial) must not be vendored [prd.md §5 license].

**Still deferred to v5+ (unchanged §12 posture):** runtime auto-block in the
banner (bundled signature DB on the client; risks the <20KB budget), a separate
`@cookyay/signatures` package (no consumer outside the scanner in v4), and the
optional self-hosted-analytics (Plausible/Fathom/Umami) script-path heuristic
(in-scope only if it falls out cheaply).

**Open question for `/pm:plan`:** none blocking. One implementation detail —
whether `requestPaths` matching reuses the existing host-matcher or needs a
small URL-path matcher in `classifier.ts` — lands at execute time.

### 2026-06-10 — Inherited from v4
**Why:** Starting v5 from the prior version's architecture as the baseline.
**Change:** Copied verbatim. Edit this file or run `/pm:architect cookyay` (amend mode) to capture v5-specific changes — in particular the signature-DB-to-client delivery mechanism for runtime auto-block (bundle-budget tradeoff), which v5/goals.md flags as the first thing /pm:research must resolve.
