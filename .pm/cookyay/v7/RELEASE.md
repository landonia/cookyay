---
version: v7
release_tag: "cookyay@0.3.0 / @cookyay/scanner@0.2.0"
released: 2026-06-12
status: shipped
---

# v7 — Release notes

## What shipped
v7 extends runtime auto-block from the DOM (scripts, iframes, pixels) to the
**transport layer**, closing the `fetch` / `navigator.sendBeacon` gap that v6
documented as known. The fastest-growing class of trackers bypasses the DOM
entirely and beacons directly over the network; v7 intercepts those calls along
the same install seam, with the v5–v6 contract — opt-in, skip-Google,
declared-wins — unchanged and additive.

- **`fetch` interception.** `window.fetch` is wrapped so a call whose URL matches
  a curated tracking endpoint in a not-yet-granted category is held rather than
  sent, and replayed on grant within the same page session. Pre-consent, the
  matched call resolves immediately to a benign `204 No Content` stub — no hangs,
  no throws for calling code that inspects the response. Non-matching (app API)
  fetches pass through synchronously and untouched; the `Request` body is cloned
  at intercept time so replayed payloads are intact.
- **`navigator.sendBeacon` interception.** `sendBeacon` is wrapped via
  instance-property shadow (frozen-prototype safe). A matched pre-consent beacon
  is queued and returns `true` synchronously; on grant the captured payload is
  sent exactly once. Pre-consent beacons fired at page unload
  (`pagehide`/`visibilitychange`) are **dropped, not deferred** — no
  `sessionStorage` persistence — the legally correct no-consent-no-send outcome.
- **Same guardrails as pixels.** Blocking is scoped to curated tracking endpoints
  only — never the app's own traffic. Google endpoints pass through to Consent
  Mode v2 (never network-blocked); declared rules win over auto-detected ones.
  Replay calls through the saved original `fetch`/`sendBeacon`, never the wrapped
  globals, preventing circular re-interception.
- **Bundle-budget reclamation.** The v6 bootstrap-first diagnostic was moved into
  the lazy `autoblock-loader` chunk, and the transport wrappers' replay/drain
  logic lives there too — keeping the always-on bundle thin. ESM-OFF lands at
  **12.92 kB gzip under a tightened 13.1 kB gate**; all four `.size-limit.json`
  gates pass and declared-only installs still tree-shake the transport + DB code
  to zero.

## Tasks completed
- 001 — Bundle-budget reclamation — lazy-load v6 diagnostic, re-baseline size gate
- 002 — Transport install seam — save/replace globals, held stores, reset, release wiring
- 003 — fetch interception — hybrid 204-stub + clone-and-replay on grant
- 004 — navigator.sendBeacon interception — queue, return true, replay, drop-on-unload
- 005 — Hermetic transport proof — e2e fixtures, browser-mode + unit specs
- 006 — Final bundle-budget gate — verify ESM-OFF under budget, tighten size-limit
- 007 — Docs — README honest-limits (transport + unload-drop) and parity page

## Deviations from original goals
None. All 7 planned tasks shipped as scoped in `goals.md` "What ships in v7" — no
additions, no cuts. The deliberate non-goals carried in v7 (`XMLHttpRequest` and
`document.write` interception deferred; auto-block remains opt-in) were respected.

## Evidence
- Cold, independent QE verification (pre-ship) — all CI gates green:
  - typecheck / build / lint / format — pass
  - unit tests — 970/970
  - browser-mode (`vitest.browser.config.ts`, Chromium headless) — 61/61,
    including `transport-proxy.browser.test.ts` (real `window.fetch` /
    `navigator.sendBeacon` wrapping + grant-path replay)
  - Playwright e2e — 104 passed / 1 skipped (intentional pagehide-keepalive
    edge); `transport-block.spec.ts` proves zero pre-consent network hits and
    exact post-grant replay counts for both transports via a single
    `page.route('**/*')` catch-all counter
  - size — all 4 gates pass; ESM-OFF 12.92 kB / 13.1 kB ceiling (180 B headroom)
- Changeset: `.changeset/v7-transport-interception.md` (`cookyay: minor`)
- QE spot-checks confirmed against built output: lazy-chunk tree-shake boundary
  (DB strings absent from `index.js`), reset restores byte-identical originals,
  replay via saved originals, skip-Google passthrough, sendBeacon unload-drop.
- Note: v7 work is uncommitted at release time — no PR/commit SHA yet.

## Known limitations
Carrying into the next version (seed material for v(N+1) planning):
- **`XMLHttpRequest` interception** — still deferred; QE's silent-gap check
  confirmed no curated-DB tracker is XHR-only, so coverage loss is not material
  today, but XHR remains uncovered.
- **`document.write` legacy injection** — still deferred (highest interception
  risk, narrowest payoff).
- **Phase-1 async escape window** — between page load and lazy-chunk resolution,
  a `fetch`/`sendBeacon` can escape unblocked. Intrinsic to the bootstrap-first
  model (same limit as DOM interception since v5/v6); documented honestly in the
  README and comparison page.
- **Thin ESM-OFF headroom** — 180 B to the firm 13.1 kB gate; any future addition
  to the always-on path will breach immediately and needs budget planning.
- **Auto-block opt-in only** — unchanged; flipping the default remains a separate
  product decision.

## Research artifacts
- [Research index](research/_index.md) — 4 persona reports
  (existing-codebase-archaeologist, performance-engineer,
  runtime-interception-domain-expert, test-strategist)

## Amendments during this version
None recorded during the v7 active window.
