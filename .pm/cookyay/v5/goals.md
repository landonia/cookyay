---
version: v5
status: shipped
created: 2026-06-10
preceded_by: v4
jira_epic: ""
---

# v5 — Goals

## What ships in v5
**Runtime auto-block in the banner** — the banner intercepts and blocks known
third-party scripts/iframes at runtime *even when they are not declared in the
site's config*, using a signature database bundled with (or loaded by) the
client [prd.md §3.2 deferral, v4/goals.md §What's deferred to later versions].

Through v4 the runtime contract stayed strictly **declarative**: the banner
blocked exactly what the site owner listed in config, and the scanner authored
those declarations offline. v5 closes the loop — the banner itself recognizes
the ~50 curated services at load time and gates them until consent, so a site
owner gets correct blocking without hand-declaring (or scanning) every third
party first.

Concrete cut (decisions below settled by /pm:research, 2026-06-10 — see
`research/_index.md §Update`):
- **Client-side signature recognition.** The banner matches outgoing
  script/iframe loads (and known request hosts/paths) against the v4 signature
  database, classifies them by category, and blocks until the matching consent
  category is granted — reusing the v4 `services.yaml` source of truth, not a
  hand-maintained second copy.
- **Scripts and iframes only.** v5 wraps `<script>` and `<iframe>` insertion.
  `<img>`-beacon pixels (e.g. Meta Pixel `facebook.com/tr`) and `document.write`
  legacy ad injection are **deferred to a later version** (higher page-breakage
  risk, narrower payoff). [resolved 2026-06-10]
- **Interception mechanism: synchronous `createElement`/`setAttribute` proxy.**
  Installed in the <1KB bootstrap so it runs before any third party parses. A
  `MutationObserver` fires too late to stop a parser-inserted script's fetch.
  Honest limit: any `<script src>` placed in the HTML *before* the Cookyay
  bootstrap cannot be blocked — so **"Cookyay first in `<head>`" is a hard
  install requirement** and an acceptance-test invariant. [resolved 2026-06-10]
- **Consent Mode v2: skip Google tags.** Auto-block does **not** DOM-block
  GTM/GA4; the existing Consent Mode v2 integration [prd.md §3.4] degrades Google
  services (denied-by-default) instead — DOM-blocking GTM would suppress all CM v2
  `update` signals. Non-Google trackers are still auto-blocked. Auto-block carries
  a Google-host skip-list derived from the curated DB. [resolved 2026-06-10]
- **Auto-block is opt-in via a single config boolean** (`autoBlock`, default
  `false`); default behavior is unchanged (declarative-only) so existing installs
  are not silently altered. Declared rules always win over auto-detected ones.
  The client DB **tree-shakes to zero** for opt-out installs. [resolved 2026-06-10]
- **Confidence threshold: single host/path match (`medium`).** At load time the
  banner sees only host/script-src signals (no cookies yet), so v4's two-signal
  `high` is unreachable — a curated-service host or path match is enough to block.
  Shared-CDN hosts must carry a `scriptUrlGlob` to avoid false-positives.
  [resolved 2026-06-10]
- **Signature-DB delivery: inline a stripped client subset via codegen.** A
  second output of the existing `build-services-db.mjs` pipeline emits a
  client-safe module (id/category/requestHosts/requestPaths only — cookies and
  localStorage keys dropped). The ~50-service slice compresses to ~1KB gzip,
  leaving the combined bundle well under the §3.1 <20KB budget (~10KB headroom).
  A lazily-loaded asset was rejected on correctness, not size — a 100–300ms fetch
  arrives too late to block scripts that execute within milliseconds.
  [resolved 2026-06-10]
- **Honor the <20KB budget posture.** Enforced by the existing `size-limit` CI
  gate, extended to cover the auto-block-enabled bundle. [resolved 2026-06-10]
- **Reuse the v4 confidence + category model and the existing `blocking.ts`
  grant/inject queue** so runtime classifications match what the scanner emits
  offline (no divergence between scan-time and run-time verdicts), and so
  consent-grant re-execution and withdrawal reuse proven code.

## What's deferred from prior version
Carry-overs from v4 RELEASE.md "Known limitations", NOT necessarily addressed
in v5 unless pulled into scope above:
- Optional consent webhook (bring-your-own storage) — TBD
- No-code snippet generator UI — TBD
- CMS plugins (WordPress first) — TBD
- Built-in banner translations (English-only) — TBD
- Growing the signature database materially beyond ~50 services — community-driven, ongoing
- Cosmetic: noisy Playwright first-run installer output (v3 known limitation) — TBD

## What's new in v5
- A runtime detection/blocking path in the `cookyay` banner package (previously
  scanner-only).
- A client-consumable form of the signature database (delivery mechanism TBD in
  research).
- Parity between scan-time and run-time classification of the same service.

## What's deferred to later versions
- **Auto-discovery of services not in the curated DB** — runtime heuristics for
  unknown third parties (vs. the curated ~50). Out of scope; v5 blocks only
  recognized services.
- **Materially expanding the signature DB beyond ~50 services** — community-driven,
  ongoing; not a v5 deliverable.
- Consent webhook, no-code UI, CMS plugins, bundled i18n locales — TBD, later
  versions.

## Acceptance bar
**Dogfooded in production** (the project's standard bar [prd.md §6]). v5 is done
when:
- With runtime auto-block enabled and *no* hand-declared third-party rules,
  the `cookyay` banner on the author's own live site blocks the third parties
  actually present until the matching consent category is granted — verified
  end-to-end in prod.
- Declared rules and auto-block coexist correctly (declared always wins; no
  double-block, no gaps) on the live site.
- The runtime-block path is covered by the hermetic CI fixture site; the
  real-site run remains the manual acceptance step (per the v1 testing posture).

## Context from prior version
v4 (shipped 2026-06-10, `@cookyay/scanner@0.2.0`) delivered scanner-side
auto-detection: a contributable `data/services.yaml` signature DB of ~50 curated
services with codegen + CI validation, path-level matching, a two-signal
confidence model, and host-deduped `suggestedBlocking[]` output with paste-ready
snippets — but kept the banner's runtime contract declarative-only. v5 builds
directly on that signature DB and confidence model, moving detection from
scan-time into the banner at run-time. The key lesson carried forward: the DB is
now a single structured source of truth (`services.yaml`), so v5 should consume
it rather than fork a client copy. The central open risk is bundle budget — the
reason runtime auto-block was explicitly deferred out of v4 — which /pm:research
must resolve before planning.
