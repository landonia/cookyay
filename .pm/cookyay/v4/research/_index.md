# Research index — cookyay v4

Generated: 2026-06-10

Scope: scanner-side auto-detection of known third-party scripts — a ~50-service
signature database plus a detection/classification pass in `@cookyay/scanner`
that emits pre-classified block declarations into the generated config JSON. The
banner stays declarative; runtime auto-block is deferred to v5+ [goals.md].

## ⚠️ Headline: v4 is largely already built

The archaeologist found that v3's code already ships the core of what v4's goals
describe: `packages/scanner/src/db.ts` has 20 curated services (GA4, Meta Pixel,
YouTube, Hotjar, …) plus 439 Open Cookie Database entries in
`db-ocd.generated.ts`; `classifier.ts` already runs a **five-signal** detection
pass (cookies, request hosts, localStorage, script URLs, iframe URLs) with
`high`/`medium`/`low` confidence; and `config-emitter.ts` already groups detected
services per category with `_meta.confidence`, `_meta.matchedBy`, `_meta.serviceId`.

The **real, narrower v4 gap** the research converged on:
1. **Emit ready-to-block markup.** The emitter does not produce the
   `type="text/plain" data-category="…"` HTML snippets a site owner pastes in —
   the banner's blocking is markup-driven and there is no config-level script/iframe
   src field. This is the gap between "we detected it" and "ready-to-block
   declaration" [goals.md "What ships in v4"].
2. **Reach ~50 services.** Only 20 curated entries exist with `requestHosts`;
   ~30 high-value services need authoring (Google Ads, reCAPTCHA, Snapchat/
   Pinterest/Reddit/Quora pixels, PostHog, FullStory, …) [prd.md §7].
3. **Fix false-positive signatures** in the existing 20 (see domain-expert): `t.co`,
   bare `facebook.com`, generic `player`/`mp_` cookies, `_ga` shared across 3 entries.
4. **Upgrade the confidence model** from "curated source = high" to "two
   independent signals agree" [prd.md §3.6].
5. **Migrate the curated DB to a contributor-facing data file** (YAML/JSON) with a
   schema + CI validation, instead of inline `curated({…})` calls [goals.md "new"].
6. **Add detection-path fixture + golden coverage** — today only the declared-
   category blocking path is exercised in e2e [goals.md §Acceptance bar].

This materially shrinks v4 from "build auto-detection" to "finish, harden, and
package auto-detection." Worth confirming the cut before `/pm:plan`.

## Personas run
- [existing-codebase-archaeologist](existing-codebase-archaeologist.md) — the DB, classifier, and emitter already exist; the true gap is emitting block-markup + fixture coverage for the host-detection path.
- [domain-expert-trackers](domain-expert-trackers.md) — five concrete false-positive signature fixes, ~30 services to add to reach 50, and a stronger "two signals agree" confidence semantic; only the Apache-2.0 OCD list is license-safe to ingest.
- [data-modeler](data-modeler.md) — migrate inline curated entries to a generated `services.yaml` (mirroring the OCD pipeline), add `scriptUrlGlobs`/`iframeSrcGlobs` + emitted `scriptSrc`/`iframeSrc`, keep confidence computed not stored, gate community PRs with a `schemaVersion` + CI validator.
- [test-strategist](test-strategist.md) — DB schema-validation test, a data-driven `it.each` matching table, `fixtures/detection/` stand-in pages, a second golden file `expected-detection-config.json`; CI cost stays <1 min added.

## Cross-cutting open questions

Grouped by source report; the same theme (does v4 emit copy-paste block markup?)
recurs across three reports and is the most scope-relevant.

**A. Does v4 emit ready-to-block HTML markup, or just annotated service entries?**
(_The pivotal scope question._)
- archaeologist Q1 — grow `EmittedConfig` a `suggestedMarkup` field per service, or is review-and-edit of plain service entries acceptable?
- data-modeler Q2 — should the emitter populate `scriptSrc`/glob patterns the owner copies into HTML, or is a "human review required" note sufficient?

**B. The ~50-service curated set**
- archaeologist Q2 — author ~30 more curated entries (with `requestHosts`) to hit 50?
- domain-expert Q2 — reCAPTCHA as `functional` blocks form submission until consent; confirm that UX trade-off under [prd.md §3.3].
- domain-expert Q3 — add a `requestPaths` array for path-level matches (Meta `facebook.com/tr`, reCAPTCHA path) in v4, or defer?
- domain-expert Q4 — surface a `low`-confidence hit for self-hosted privacy analytics (Plausible/Fathom/Umami) detected by script path?
- data-modeler Q3 — augment the empty-`requestHosts` OCD entries with a hand-authored sidecar for the top 20, or keep that to curated only?

**C. Emitter behavior**
- domain-expert Q1 — when GA4 + Google Ads both load via `googletagmanager.com`, dedupe to one GTM block rule (noting both) or emit one rule per service?

**D. Signature DB source-of-truth & contribution layout**
- data-modeler Q1 — single `services.yaml` vs per-service files under `data/services/`?
- archaeologist Q3 / test-strategist Q1 & Q2 — should `fixtures/service-fingerprints.json` become the authoritative stub source (generated from the DB), or stay a test-only descriptor? If the curated set grows to 50, add a `stubCookies` entry per service?

**E. CI budget**
- test-strategist Q3 — is <10 min/PR still the ceiling? Detection fixture crawls push the `e2e` job to ~4–5 min.

## Recommended next step
Several open questions — especially **Question A** — materially change v4's scope
(emit copy-paste block markup vs. annotated entries reshapes the headline goal and
the emitted-config schema). Recommend the user answer A, B (reCAPTCHA + paths), and
C now; if the answers shift the stated scope, run `/pm:amend cookyay` to update the
PRD/goals, then `/pm:plan cookyay`. If you'd rather lock scope verbally, go straight
to `/pm:plan cookyay` — the planner can encode the decisions as task acceptance criteria.
