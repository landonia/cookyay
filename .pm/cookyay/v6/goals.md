---
version: v6
status: planning
created: 2026-06-11
preceded_by: v5
jira_epic: ""
---

# v6 — Goals

## What ships in v6
**Close the runtime auto-block coverage gaps left by v5.** v5 shipped opt-in
runtime auto-block for `<script>` and `<iframe>` loads against the ~50-service
curated signature DB. v6 extends that coverage to the surfaces v5 explicitly
deferred and hardens the honest limits, so `autoBlock:true` catches materially
more real-world tracking without the site owner hand-declaring it. The runtime
contract, opt-in posture, skip-Google decision, and declared-wins precedence
from v5 are unchanged — this is additive coverage, not a redesign. [prd.md §3.2]

Concrete cut:
- **`<img>` beacon pixel auto-block.** Intercept `<img>`-based tracking beacons
  (canonical case: Meta Pixel `facebook.com/tr`, and similar pixel endpoints in
  the curated DB) and hold them inert until the matching consent category is
  granted — extending the v5 `createElement`/`src`-setter proxy to `<img>`.
  Because pixels carry a higher page-breakage risk [v5 research], blocking is
  scoped to curated tracking-pixel endpoints (host + path / `requestPaths`),
  never `<img>` elements broadly. Skip-Google and declared-wins still apply.
- **Bootstrap-first mitigation (diagnostic, not a silent fix).** The hard limit
  stands — a `<script src>`/pixel placed before the Cookyay bootstrap cannot be
  intercepted. v6 makes the failure *loud* rather than silent: a dev-time
  diagnostic (console warning, dev-only) that detects a known tracker which
  loaded before the bootstrap and tells the installer to move Cookyay first in
  `<head>`. No attempt to retroactively block already-fetched resources.
- **Signature DB expansion.** Grow the curated DB beyond the current ~50 services
  (prioritising pixel/beacon endpoints now in scope) and/or tighten the
  contribution tooling so the expanded set stays validated, parity-checked
  (scanner↔banner, per v5 task 007), and within the bundle budget.

## What's deferred from prior version
Carried over from v5's "Known limitations" (`v5/RELEASE.md`):
- `<img>` beacon pixels — **now in scope for v6** (above).
- Bootstrap-first install requirement — **addressed in v6 as a diagnostic** (the
  limit itself is intrinsic and remains; v6 surfaces it loudly).
- `document.write` legacy injection — **still deferred** (see below).
- Google tags passing through to Consent Mode v2 — **unchanged by design**, not a
  defect; remains the intended behaviour.

## What's new in v6
- A dev-time bootstrap-order diagnostic surface (new observable behaviour, not
  present in v5).
- Pixel-class signatures in the curated DB tuned for `<img>` interception
  (distinct page-breakage risk profile from script/iframe entries).

## What's deferred to later versions
- **`document.write` legacy ad/script injection** — TBD. Highest interception
  risk (rewriting the parser stream), narrowest payoff; explicitly out of v6.
- **Auto-block on by default** — remains opt-in; flipping the default is a
  separate product decision, not in v6.
- Any non-auto-block product capability (consent analytics, i18n banner, hosted
  config, etc.) — out of scope; would warrant its own version or PRD revision.

## Acceptance bar
v6 is **done** when:
- Each new blocking surface (`<img>` beacon pixels) is proven **block-until-consent**
  in a hermetic e2e fixture mirroring v5's `auto-block.spec` pattern: the pixel
  request is NOT made before consent (network asserted), and IS made after the
  matching category is granted. No real network to third-party hosts.
- The bootstrap-first diagnostic is proven by a fixture where a known tracker
  loads before the bootstrap: the dev-time warning fires; in production mode it
  does not; and nothing throws.
- Scanner↔banner parity (v5 task 007) still holds across the expanded DB, and the
  `autoBlock`-enabled bundle stays **under the 20KB min+gzip budget** [prd.md §3.1].
- `pnpm typecheck && build && lint && test && size` all green in CI; declared-only
  installs remain byte-for-byte unaffected (opt-out still tree-shakes to zero).

## Context from prior version
v5 delivered opt-in runtime auto-block for scripts and iframes via a synchronous
bootstrap proxy, reusing the v4 signature DB and the existing `blocking.ts`
grant/inject queue, with a scanner↔banner parity test and a bundle-budget gate
(enabled bundle 14.33 KB gzip). It shipped with no scope deviations. The three
honest limitations it documented — `<img>` pixels, the bootstrap-first
requirement, and `document.write` — are exactly the seam v6 works along: v6
takes on pixels and the bootstrap-first diagnostic, and leaves `document.write`
for later. The v5 architecture is inherited as v6's baseline.
