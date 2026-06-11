---
version: v4
release_tag: v4.0.0
released: 2026-06-10
status: shipped
---

# v4 — Release notes

## What shipped

Scanner-side **auto-detection of known third-party scripts** — closing the biggest remaining feature gap versus paid CMPs. The scanner now identifies which third-party services are present on a site, classifies them with a two-signal confidence model, and emits copy-paste-ready block declarations into the generated config. Site owners no longer hand-author blocked-script entries; the scanner authors them.

Key deliverables:

- **Contributable signature database** — 20 inline curated entries migrated to a human-editable `data/services.yaml` source with a `schemaVersion`, a codegen pipeline (`build-services-db.mjs`), and a CI prebuild validator. Community PRs can now extend the database safely.
- **~50 curated services** — ~30 new entries added (Google Ads, Snapchat/Pinterest/Reddit/Quora pixels, PostHog, FullStory, reCAPTCHA, and more). reCAPTCHA ships classified as `functional`.
- **Path-level matching** — `requestPaths` field added to the schema and classifier, enabling precise detection for services that share a host (Meta `facebook.com/tr`, reCAPTCHA `www.google.com/recaptcha/`).
- **Two-signal confidence model** — `high` confidence now requires two independent signals to agree, reducing false positives and weak guesses.
- **`suggestedBlocking[]` output** — the emitter produces host-deduped block rules with paste-ready `type="text/plain" data-category="…"` script/iframe snippets, collapsing multiple services on the same host into a single block entry.
- **`service-fingerprints.json`** — generated artifact for downstream consumption.
- **5 false-positive signature fixes** — `t.co`, bare `facebook.com`, generic `player`/`mp_` cookies, and shared `_ga` across multiple entries.
- **Detection-path test coverage** — `fixtures/detection/` stand-in pages, a second golden config (`expected-detection-config.json`), and an e2e spec locking down the crawl → detect → emit path offline.
- **Docs updated** — README and comparison page cover auto-detect; reCAPTCHA functional-gating note added.

## Tasks completed

- 001 — Migrate curated DB to data/services.yaml + generator, add schema fields
- 002 — Signature-DB schema validator + CI prebuild gate
- 003 — Fix the 5 false-positive signatures
- 004 — Add path-level (requestPaths) matching in classifier.ts
- 005 — Author ~30 more curated services to reach ~50
- 006 — Upgrade confidence to "two signals agree = high"
- 007 — Emit suggestedBlocking[] (host-deduped + paste-ready snippet)
- 008 — Generate service-fingerprints.json from the DB source
- 009 — Detection-path fixtures + 2nd golden file + e2e spec
- 010 — Docs — README + comparison page for auto-detect + reCAPTCHA gating note

## Deviations from original goals

None. All items in `v4/goals.md §What ships in v4` shipped as scoped.

## Evidence

- TODO: add PR link(s) / commit SHAs / deployment verification when available

## Known limitations

Carrying into v5 (from `v4/goals.md §What's deferred to later versions`):

- **Runtime auto-block in the banner** — intercepting/blocking known third parties at runtime (bundled signature DB on the client) is explicitly v5+; it risks the <20KB bundle budget and adds runtime breakage surface. v4 is scanner-side only.
- **Growing the signature database beyond ~50 services** — community-driven, ongoing.
- Prior deferred items unchanged: optional consent webhook, no-code snippet generator UI, CMS plugins (WordPress first), built-in banner translations, noisy Playwright first-run installer output.

## Research artifacts

- [Research index](research/_index.md) — 4 persona reports (data-modeler, domain-expert-trackers, existing-codebase-archaeologist, test-strategist)

## Amendments during this version

No PRD amendments were recorded during the v4 active window. (All in-flight resolutions were folded into v4 planning before execution began.)
