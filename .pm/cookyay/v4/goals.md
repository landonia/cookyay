---
version: v4
status: shipped
created: 2026-06-10
preceded_by: v3
jira_epic: ""
---

# v4 — Goals

## What ships in v4
Scanner-side **auto-detection of known third-party scripts** — closing the
biggest remaining feature gap versus paid CMPs [prd.md §3.2, §3.6, §7].

> **Scope note (from /pm:research, 2026-06-10):** the detection core already
> exists in the v3 codebase — `db.ts` has 20 curated services + 439 Open Cookie
> Database entries, `classifier.ts` runs a five-signal detection pass with
> high/medium/low confidence, and `config-emitter.ts` groups detections per
> category with confidence/matchedBy/serviceId. So v4 is **finish + harden +
> package**, not build-from-scratch. The concrete cut below reflects that.

Through v3 the project kept script blocking **declarative-only**: site owners
hand-declared every blocked script/iframe in config (per the 2026-06-06
amendment). v4 makes the scanner author those declarations for them:

- **Emit copy-paste block markup, not just detections.** The emitter currently
  outputs annotated service *entries*; v4 makes it produce ready-to-paste
  `type="text/plain" data-category="…"` script/iframe snippets per detected
  service so the site owner pastes rather than hand-authors. Requires adding
  script/iframe URL patterns to the signature schema and to the emitted config.
  **This is the bulk of v4's new work.** [resolved 2026-06-10]
- **Reach ~50 curated services with path-level matching.** Author ~30 more
  curated entries (with `requestHosts`) to reach ~50 — Google Ads, the major
  pixels (Snapchat/Pinterest/Reddit/Quora), PostHog, FullStory, etc. — and add a
  `requestPaths` matcher field for services that need path granularity (Meta
  `facebook.com/tr`, reCAPTCHA `www.google.com/recaptcha/`). reCAPTCHA ships
  classified **functional** (forms gated until consent, per strictest-everywhere
  [prd.md §3.3]). [resolved 2026-06-10]
- **Fix the false-positive signatures** found in the existing 20: `t.co`, bare
  `facebook.com` (→ `connect.facebook.net` + path), the generic `player`/`mp_`
  cookies, and `_ga` shared across three entries.
- **Upgrade the confidence model** from "curated source = high" to "two
  independent signals agree = high" [prd.md §3.6].
- **Dedupe block rules by host.** When multiple services collide on one host
  (GA4 + Google Ads → `googletagmanager.com`), emit a single host block rule
  listing all justifying services. [resolved 2026-06-10]
- **Package the signature DB as contributable data.** Migrate the inline
  `curated({…})` entries to a structured data source (mirroring the existing OCD
  ingestion pipeline) with a `schemaVersion` and a CI validator (schema check,
  no duplicate ids) so community PRs extend it safely [prd.md §7].
- **Detection-path test coverage.** Add `fixtures/detection/` stand-in pages and
  a second golden config (`expected-detection-config.json`) so the crawl →
  detect → emit path is asserted offline; today only the declared-category
  blocking path is exercised [goals.md §Acceptance bar].

The **banner stays declarative** — it blocks exactly what's in config, exactly
as today. v4 changes only how that config gets authored, not the runtime contract.

## What's deferred from prior version
Carry-overs from v1/v2/v3 RELEASE notes, NOT addressed in v4:
- Optional consent webhook (bring-your-own storage) — TBD
- No-code snippet generator UI — TBD
- CMS plugins (WordPress first) — TBD
- Built-in banner translations (English-only) — TBD
- Cosmetic: noisy Playwright first-run installer output (v3 known limitation) — TBD

## What's new in v4
- The known-services signature database (~50 services) as a maintained, structured,
  contributable asset.
- Scanner detection + classification of third parties during crawl.
- Pre-classified third-party block declarations in the emitted config JSON, with
  confidence + service-name + category annotations.

## What's deferred to later versions
- **Runtime auto-block in the banner** — the banner intercepting/blocking known
  third parties at runtime even when not declared in config (bundled signature
  DB on the client). Explicitly **v5+**: it risks the <20KB bundle budget and
  adds runtime breakage surface. v4 is scanner-side only.
- Growing the signature database materially beyond ~50 services — community-driven,
  ongoing.

## Acceptance bar
**Dogfooded in production.** v4 is done when:
- Running `@cookyay/scanner` against the author's own real site auto-detects the
  third parties actually present and emits correct, category-classified block
  declarations into the config JSON.
- That generated config, dropped into the live site, blocks those third parties
  until consent — verified end-to-end in prod (the project's standard dogfooding
  bar [prd.md §6]).
- The ~50-service database and the detection behavior are covered by the hermetic
  CI fixture site; the real-site run remains the manual acceptance step (per the
  v1 testing posture).

## Context from prior version
v1 shipped the full product (banner, declarative script blocking, GPC/Consent
Mode, client-side record, Playwright scanner, npm/CDN distribution, comparison
page). v2 and v3 were small corrective releases hardening the scanner's CLI: v2
fixed the documented `scan` subcommand parsing, and v3 made the scanner
auto-provision its own Chromium on first run so the documented one-liner works on
a clean machine. With the scanner now reliable end-to-end, v4 is the first
feature version since v1 — it builds on that working scanner to deliver the
auto-detection the PRD always intended (§3.2 deferred it from v1, §7 named the
top-20+ services database as the seed).
