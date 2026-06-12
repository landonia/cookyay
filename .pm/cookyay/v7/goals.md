---
version: v7
status: shipped
created: 2026-06-12
preceded_by: v6
jira_epic: ""
---

# v7 — Goals

## What ships in v7
**Extend runtime auto-block to the transport layer: `fetch` and
`navigator.sendBeacon`.** v5–v6 intercept tracking that loads through the DOM
(`<script>`, `<iframe>`, `<img>`/`new Image()` pixels). The fastest-growing class
of trackers bypasses the DOM entirely and beacons directly over the network —
`fetch()` and `navigator.sendBeacon()` to endpoints like `facebook.com/tr`,
`region1.google-analytics.com/g/collect`, and similar. v6 documented this as a
known gap; v7 closes it. The runtime contract, opt-in posture, skip-Google
decision, and declared-wins precedence from v5–v6 are unchanged — this is
additive coverage along the same seam. [prd.md §3.2]

Concrete cut:
- **`fetch` interception.** Wrap `window.fetch` in the bootstrap proxy. A call
  whose URL matches a curated tracking endpoint (host + path / `requestPaths`)
  in a not-yet-granted category is **held** rather than sent; on grant the held
  call is **replayed**. Pre-consent, the matched call resolves to a benign,
  non-throwing stub so application code that inspects the result does not break.
  Non-matching fetches (the app's own API calls) pass through untouched and
  synchronously.
- **`navigator.sendBeacon` interception.** Wrap `sendBeacon` (fire-and-forget,
  returns `boolean`). A matched pre-consent beacon is **queued** and returns
  `true` (queued for delivery); on grant the queued payload is sent. Non-matching
  beacons pass through.
- **Same guardrails as pixels.** Blocking is scoped to curated tracking endpoints
  only — never the app's own network traffic. Skip-Google (pass through to
  Consent Mode v2, never network-block Google endpoints) and declared-wins
  precedence both still apply. Higher page-breakage risk than pixels (app code
  may `await` a fetch) is mitigated by the curated-endpoint-only scope and the
  benign-stub response.
- **Bundle-budget reclamation.** The v6 QE flagged thin ESM-OFF headroom
  (~0.4 kB to the 13 kB limit). v7 adds a dedicated work item to reclaim headroom
  (e.g. lazy-load or further tree-shake the proxy path) so the new transport
  interception code lands without breaching the budget. The `autoBlock`-enabled
  bundle stays under the 20 KB min+gzip budget; declared-only installs remain
  byte-for-byte unaffected (opt-out still tree-shakes to zero). [prd.md §3.1]

## What's deferred from prior version
Carried over from v6's "Known limitations" (`v6/RELEASE.md`):
- `fetch` / `sendBeacon` transport gap — **now in scope for v7** (above).
- ESM-OFF bundle headroom thin — **addressed in v7** via the reclamation work item.
- `document.write` legacy injection — **still deferred** (see below).
- Auto-block opt-in only — **unchanged**; flipping the default remains a separate
  product decision, not taken in v7.

## What's new in v7
- Network-layer (non-DOM) interception surface — a new class of observable
  behaviour distinct from the DOM-element proxying of v5–v6.
- Hold-and-replay semantics for asynchronous (`fetch` promise) and
  fire-and-forget (`sendBeacon`) transports, with benign pre-consent stubbing.

## What's deferred to later versions
- **`XMLHttpRequest` interception** — older transport, less used by modern
  trackers; TBD for a later version unless v7 research shows material coverage
  loss without it.
- **`document.write` legacy ad/script injection** — highest interception risk
  (rewriting the parser stream), narrowest payoff; explicitly out of v7.
- **Auto-block on by default** — remains opt-in; a separate product decision.
- Any non-auto-block product capability (consent analytics, i18n banner, hosted
  config, etc.) — out of scope; would warrant its own version or PRD revision.

## Acceptance bar
v7 is **done** when:
- Each new transport surface (`fetch`, `sendBeacon`) is proven
  **block-until-consent** in a hermetic e2e fixture mirroring v6's pixel pattern:
  the matched tracking request is NOT sent before consent (network asserted), and
  IS sent after the matching category is granted. No real network to third-party
  hosts.
- A matched pre-consent `fetch` resolves to a benign stub (does not throw, does
  not hang); the application's own `fetch`/`sendBeacon` calls to non-curated
  endpoints are provably untouched.
- Skip-Google holds (Google endpoints pass through to Consent Mode v2, not
  network-blocked) and declared-wins precedence still holds across the transport
  layer.
- Bundle-budget reclamation lands: ESM-OFF is back under budget with measurable
  headroom, and the `autoBlock`-enabled bundle stays under the 20 KB min+gzip
  budget. Scanner↔banner parity (v5 task 007) still holds.
- `pnpm typecheck && build && lint && test && size` all green in CI (including
  the v6 browser-mode and format gates); declared-only installs remain
  byte-for-byte unaffected.

## Context from prior version
v6 extended runtime auto-block from scripts/iframes to `<img>`/`new Image()`
tracking pixels (intercept → hold inert → fire on grant), added a debug-gated
bootstrap-first diagnostic (dead-code-eliminated from prod), and expanded the
curated signature DB with pixel-class endpoints — shipping with no scope
deviations as `cookyay@0.2.0` / `@cookyay/scanner@0.2.0`. Its QE review surfaced
the transport-layer (`fetch`/`sendBeacon`) gap and thin ESM-OFF headroom as the
top carry-overs, which are exactly v7's cut. The bootstrap-first requirement
remains intrinsic — network interception, like DOM interception, only works when
the proxy is installed before any third party runs. The v5–v6 architecture
(synchronous bootstrap proxy, `blocking.ts` grant/inject queue, curated DB +
matcher) is inherited as v7's baseline.
