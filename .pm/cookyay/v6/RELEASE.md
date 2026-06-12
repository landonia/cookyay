---
version: v6
release_tag: "cookyay@0.2.0 / @cookyay/scanner@0.2.0"
released: 2026-06-12
status: shipped
---

# v6 — Release notes

## What shipped
v6 closes the runtime auto-block coverage gaps left by v5. Runtime auto-blocking
now covers **tracking pixels** (`<img>` and `new Image()`) alongside scripts and
iframes: detected pixels are intercepted and held inert until the matching consent
category is granted, then fired via `_injectImg()`. A **dev-time bootstrap-first
diagnostic** warns (console, debug-gated only) when a known tracker loads before
the Cookyay bootstrap — the hard limit stands, but the failure is now loud rather
than silent. The curated signature DB was expanded with pixel-class entries (Meta,
LinkedIn, TikTok, Snapchat, Pinterest, Reddit, Twitter/X, Quora), and the
`fetch`/`sendBeacon` gap is documented honestly in the README and comparison page.
The v5 runtime contract, opt-in posture, skip-Google decision, and
declared-wins precedence are all unchanged — v6 is additive coverage only.

## Tasks completed
- 001 — Pixel-class signature entries in services.yaml + codegen regen + validation
- 002 — `<img>` interception in proxy — createElement/setAttribute + new Image() override, HeldElement union
- 003 — Wire held `<img>` pixels into blocking.ts grant path — `_injectImg()` fire-on-grant
- 004 — Bootstrap-first diagnostic — autoblock-diagnostic.ts, debug-gated, DCE-stripped from prod
- 005 — Hermetic e2e fixtures + specs — pixel lifecycle, content-img untouched, Google-skip, declared-wins, dev/prod diagnostic
- 006 — Bundle-budget gate + prod-DCE-strip assertion + parity-still-green
- 007 — Docs — README pixel coverage, honest limits (fetch/sendBeacon gap), compare page

## Deviations from original goals
None — shipped exactly to goals.

## Evidence
- PR #10 — v6 implementation + QE hardening: https://github.com/landonia/cookyay/pull/10
- PR #11 — cookyay changeset (minor bump): https://github.com/landonia/cookyay/pull/11
- PR #9 — version packages (0.2.0 for both packages): https://github.com/landonia/cookyay/pull/9
- npm: `cookyay@0.2.0` — published via OIDC Trusted Publishing
- npm: `@cookyay/scanner@0.2.0` — published via OIDC Trusted Publishing
- git tags: `cookyay@0.2.0`, `@cookyay/scanner@0.2.0`
- CI gates: Build · Lint · Typecheck · Test · Browser-mode tests · E2E · Bundle size · Package quality · Accessibility — all green

## Known limitations
Carrying into the next version:

- **`document.write` legacy injection** — highest interception risk, narrowest
  payoff; explicitly deferred again.
- **ESM-OFF bundle headroom is thin** (~0.4 kB remaining to the 13 kB limit) —
  future `<img>` proxy additions could breach the budget.
- **`fetch`/`sendBeacon` gap** — transport-layer beacons still pass through;
  documented in README as a known limit.
- **Auto-block opt-in only** — flipping the default remains a separate product
  decision, not yet taken.

## Research artifacts
- [Research index](research/_index.md) — 4 persona reports
  - existing-codebase-archaeologist
  - performance-engineer
  - runtime-interception-domain-expert
  - test-strategist

## Amendments during this version
None.
