# Research index — cookyay v6

Generated: 2026-06-11

v6 scope: close the v5 runtime auto-block coverage gaps — `<img>` beacon pixel
auto-block, a dev-time bootstrap-first diagnostic, and signature-DB expansion;
`document.write` stays deferred. Acceptance: hermetic e2e proof per surface.

## Personas run
- [existing-codebase-archaeologist](existing-codebase-archaeologist.md) — adding `'img'` to the proxy's tag guard + an `_injectImg()` mirror of `_injectIframe()` is nearly the whole interception change; `config.debug` is the diagnostic gate; ~5.6 KB budget headroom.
- [runtime-interception-domain-expert](runtime-interception-domain-expert.md) — `new Image()` bypasses the v5 createElement/setAttribute proxy and must be patched via a `window.Image` constructor override; `fetch`/`sendBeacon` beacons are architecturally invisible and should be documented as an honest limit.
- [performance-engineer](performance-engineer.md) — ON bundle measured at 14,482 B gzip (~6 KB headroom); ~48 B/entry means the DB can grow to ~175 services before breaching 20 KB; the diagnostic must be DCE-guarded (`NODE_ENV`/`__DEV__`) to cost zero in production; add an apex-domain prefilter for the `<img>` hot path.
- [test-strategist](test-strategist.md) — pixel "not fired" is a negative-network proof: `page.route()` hit-counter (0 before, 1 after) + DOM `src===null`; diagnostic tested via `console` listener over dev/prod fixtures (runtime `debug` flag, no separate build); new `bootstrap-first.spec.ts`.

## Cross-cutting open questions

Grouped and deduplicated across all four reports. Bracketed tags link the
reports that raised each.

### A. DB expansion: how many pixel entries, and which services?
[archaeologist Q3, runtime Q3, performance Q1]
How many pixel/beacon endpoints ship in v6's initial expansion — Meta Pixel +
4–5 others, or a broader sweep? Candidates raised: LinkedIn (`px.ads.linkedin.com/collect`),
Twitter/X, Pinterest, Snapchat, TikTok, Reddit. Each entry costs ~48–65 B gzip,
so even 30 entries is well within budget — the answer mainly sizes the work, not
the bundle.

### B. `<img>` selection: `requestPaths`-only, and a schema flag?
[archaeologist Q1, performance Q2, test Q1]
Confirm `<img>` interception keys on **host + `requestPaths`** (never `requestHosts`
alone) so content images are never touched. Open sub-question: do we add an
explicit `imgPixel: true` (or pixel-class) field to `services.yaml` to distinguish
pixel entries — which would need parity-test coverage — or is the existing
`requestPaths` selector sufficient? Related: does the `facebook.com/tr` path entry
gate script/iframe blocking too, or only pixel interception?

### C. `fetch` / `sendBeacon` beacons — document as a gap, or attempt to patch?
[runtime Q1]
Modern Meta Pixel (Advanced Matching) and TikTok increasingly use `fetch`/
`navigator.sendBeacon`, which DOM-level interception cannot see. Recommendation:
document as an honest limitation in v6 (consistent with the §3.8 honest-parity
story); a `window.fetch` monkey-patch is higher risk and likely a later version.
Confirm.

### D. Diagnostic trigger: `debug:true` only, or any non-production / localhost?
[runtime Q4]
Should the bootstrap-first warning fire only when `config.debug` is set, or for
any localhost/non-production origin (more discoverable for devs who don't know
the flag)? Note the performance constraint: whichever it is, the diagnostic code
must be DCE-stripped from production builds to cost zero bytes [performance F3].

### E. Pixel hold-and-fire timing on grant — synchronous?
[runtime Q2]
On consent grant, fire the suppressed pixel synchronously in the grant handler,
or allow a rAF/microtask delay? Synchronous is preferred for analytics accuracy;
confirm it's acceptable alongside the existing `setTimeout(fn,0)` INP-stagger
posture from v5.

### F. Held-pixel visual state
[archaeologist Q2]
A held pixel `<img>` (no src) renders as 0×0 / broken-image depending on
dimensions. Tracking pixels are typically `1×1`/`display:none`, so the no-src
approach should be invisible — confirm there's no concern, or whether held
pixels should be forced `display:none`.

### G. Implementation placements (low-stakes; planner can default)
[test Q2, performance Q3, test Q3, archaeologist confirmed]
- Diagnostic in a new `autoblock-diagnostic.ts` vs a function in `api.ts` (recommend new file for DCE isolation + test ownership).
- Apex-domain prefilter vs hostname-cache for the hot path (recommend prefilter).
- `<img>` proxy must intercept BOTH `img.src=` (property) and `setAttribute('src',…)` (parser path) — archaeologist confirms both override sites already exist; just add `'img'`.

## Recommended next step
Questions **A–F** materially affect v6's scope and the signature DB schema. Answer
A, B, C, and D before planning (E, F, G have safe defaults the planner can adopt).
If the answers change the cut (e.g. adding a pixel-class schema field, or pulling
`fetch`-patching into scope), run `/pm:amend cookyay` to fold them into the PRD/goals.
Otherwise proceed to **`/pm:plan cookyay`**.
## Update — 2026-06-11 — Author decisions

Open questions A–D resolved by the author (all confirm the recommended defaults; no `/pm:amend` needed — scope and schema unchanged):

- **A. DB expansion (→ Meta Pixel + ~5 majors).** Add `<img>`-pixel `requestPaths` entries for Meta, LinkedIn, Pinterest, Snapchat, TikTok, Reddit (~6 services). Trivially under the 20 KB budget.
- **B. `<img>` modeling (→ reuse `requestPaths`, no new field).** Interception keys on host + `requestPaths` only (never host alone); no `imgPixel`/`kind` schema field, so the parity test and codegen are unchanged.
- **C. `fetch`/`sendBeacon` (→ document as honest limit).** DOM interception cannot see `fetch`/`sendBeacon` beacons; v6 documents this as a known gap in the §3.8 honest-parity story. No `window.fetch` patch in v6 (deferred).
- **D. Diagnostic trigger (→ `debug:true` only).** The bootstrap-first warning fires only when `config.debug` is set; the diagnostic code is still DCE-stripped from production builds to cost zero bytes.
- **E–G (safe defaults adopted by the planner):** pixel fires synchronously in the grant handler on consent (E); held pixels rely on no-src (typically 1×1/`display:none`) (F); diagnostic in a new `autoblock-diagnostic.ts`, apex-domain prefilter for the hot path, `<img>` proxy intercepts both `img.src=` and `setAttribute('src',…)` (G).
