# performance-engineer — Research findings

## Summary

v6 has three additive budget pressures against the hard 20KB min+gzip wall [prd.md §3.1,
§5]: DB expansion (pixel-class entries), `<img>` interception code, and the bootstrap-order
diagnostic. None is individually lethal, but combined they will consume ~2–3.5KB of the
**5.9KB headroom** currently left in the tightest path (ESM ON bundle: 14,482B measured,
14.1KB). The diagnostic is the only one that can be zeroed out entirely via dead-code
elimination (DCE). The `<img>` hot path is the sharpest runtime concern: `<img>` elements
are vastly more numerous than `<script>` tags and must be cheap to dismiss on the common
non-tracker case.

---

## Findings

### 1. Current headroom — tighter than v5 numbers suggest [prd.md §3.1; goals.md §Acceptance bar]

v5 figures from goals context were 14.33 KB gzip for the ESM ON bundle. Measured from
the current build:

| Artifact | Raw | Gzip |
|---|---|---|
| `index.js` (ESM main, auto-block OFF) | 53,054B | 12,082B |
| `autoblock-loader-*.js` chunk (DB + matcher) | 10,280B | 2,400B |
| **ESM ON combined** | — | **14,482B** |
| `index.iife.js` (IIFE, auto-block ON) | 41,656B | 11,610B |
| `bootstrap.js` | 1,024B | 506B |
| **IIFE + bootstrap combined** | — | **12,116B** |

The `.size-limit.json` budget gates both combined paths at 20KB (20,480B). Effective
headroom: **5,998B (5.9KB) on the ESM ON path** (the tightest). The IIFE+bootstrap path
has 8,364B (8.2KB) headroom and is not the binding constraint for v6.

### 2. DB expansion — per-entry gzip cost and breakeven points [goals.md §Signature DB expansion]

The autoblock-loader chunk (DB + index build code + matcher) currently weighs **2,400B
gzip** across 50 services (44 active, 6 Google-skipped). Average gzip cost per service
entry: **~48B gzip**. New pixel-class entries will include `requestPaths` fields
(richer per-entry data), so the true marginal cost for pixel entries is closer to
**55–65B gzip** per entry vs ~40B for host-only entries.

Projected total ESM ON bundle at scale (using 48B/entry conservative average):

| Services | DB chunk | ESM ON total | Headroom vs 20KB |
|---|---|---|---|
| 50 (now) | 2,400B | 14,482B | 5,998B |
| 75 | 3,600B | 15,682B | 4,798B |
| 100 | 4,800B | 16,882B | 3,598B |
| 150 | 7,200B | 19,282B | **1,198B** |
| ~175 | ~8,400B | ~20,482B | **-2B (OVER BUDGET)** |

**Breakeven: ~175 services breaches the 20KB ESM ON wall** before accounting for `<img>`
proxy code or the diagnostic. With the `<img>` interception addition (~250–400B gzip;
see Finding 3), the effective ceiling drops to roughly **165 services**. The IIFE+bootstrap
path has more slack and does not breach 20KB until ~220+ services.

Practical v6 scope (10–20 new pixel entries): consumes ~480–960B gzip on top of current
ESM ON, leaving 5,038–5,518B headroom. Safe, but every future version tightens the band.

### 3. `<img>` interception code and the diagnostic — byte cost and DCE opportunity [goals.md §What's new in v6; goals.md §Acceptance bar]

**`<img>` proxy extension:** Extending `installAutoBlockProxy()` to intercept `<img src>`
assignments adds a new branch in the `patchedSetAttribute` override plus `patchedCreateElement`
— structurally identical to the existing `SCRIPT`/`IFRAME` arms. Estimated incremental
cost: **150–300B gzip** (pure logic, no new data structures). The `HeldElement` interface
already supports any element type. Total: call it 200B gzip conservatively.

**Bootstrap-order diagnostic:** A console warning that fires when a known tracker loads
before the bootstrap. The detection logic itself (post-load scan of `performance.getEntries()`
or similar) is ~30–60 lines of TS — estimate **100–200B gzip** in compiled form.

**Critical observation — DCE via `process.env.NODE_ENV`:** The diagnostic is explicitly
described as "dev-time" / "dev-only" [goals.md §What ships in v6]. tsup 8.x wraps esbuild,
which replaces `process.env.NODE_ENV` with the literal `"production"` in minified builds
(`minify: true`). Code guarded by `if (process.env.NODE_ENV !== 'production')` is then
DCE'd to zero bytes by esbuild's constant-folding. The current `tsup.config.ts` IIFE build
already sets `minify: true`; no config change is required.

For the unminified ESM build (bundler consumers), esbuild does not automatically set
`NODE_ENV` — but downstream bundlers (Webpack, Vite, Rollup) perform this replacement at
their own build step. The diagnostic will be stripped from any production bundler output
even via the ESM path. **The diagnostic therefore costs ZERO bytes in any production
bundle if and only if it is wrapped in a `process.env.NODE_ENV !== 'production'` guard.**
Without that guard, it adds ~150–200B gzip permanently.

### 4. `<img>` hot path — runtime per-element matcher cost [goals.md §Acceptance bar]

`<img>` elements are structurally more numerous than `<script>` or `<iframe>` on typical
pages. A product page may have 50–200+ `<img>` elements; only 1–3 are tracking pixels.
The per-call cost of the current `matchAutoBlock()` path:

1. `_extractHost(url)` — a `new URL(url)` parse + `.hostname` (~2–5µs), short-circuited
   to `null` for relative paths (no `http://` prefix). Relative paths skip all matching.
2. Host index traversal — up to ~5 `Map.get()` calls (exact host + parent labels). O(1)
   per lookup; total ~0.5–2µs.
3. Path lookup — only if host lookup misses; currently 2 entries, ~0.2µs linear scan.

The dominant cost is `new URL(url)` for absolute URLs. For `<img>` elements loaded from
first-party or CDN hosts (the vast majority), the host will NOT be in the index and the
function returns `null` after at most 3–5 Map.get() calls. At 100 images per page this is
~0.5ms total — well within acceptable limits.

**Key optimisation opportunity — early host prefilter:** Before calling `new URL(url)`,
apply a fast string check: does the URL contain any of the tracked TLDs/apex domains?
A `String.prototype.includes()` over a comma-joined Set of 30–40 apex domains costs
~0.05µs per call and eliminates the `new URL()` cost for ~95% of `<img>` src values on
typical pages. The existing code already fast-paths relative URLs; extending to an
optional apex-domains prefilter is a single additional `if` before the URL parse.

**The `setAttribute` intercept on `Element.prototype` covers ALL elements including `<img>`,
so no second prototype patch is needed.** The `patchedSetAttribute` already gates on
`tagName` — adding `'IMG'` to the checked set is the minimal change.

### 5. Tree-shake-to-zero for opt-out installs [goals.md §Acceptance bar]

The existing architecture already satisfies this via the conditional `import()` in the proxy:
`if (config.autoBlock) { const { getAutoBlockMatcher } = await import('./autoblock-loader.js') }`.
As the DB grows, this guarantee is preserved as long as no new `<img>`-related code statically
imports the DB or matcher at the top level of any always-on module (`api.ts`, `bootstrap.ts`,
`index.ts`, `banner.ts`). The `autoblock-proxy.ts` file also must not gain any static DB
import — it currently doesn't. This invariant should be enforced via a CI check (e.g. a
`grep` assertion that `db-autoblock.generated` only appears in import expressions inside
`autoblock-loader.ts`).

---

## Gotchas

- **The `.size-limit.json` IIFE entry uses a glob** (`autoblock-loader-*.js`) for the ON
  bundle. If the chunk hash changes (e.g. after adding pixel entries), the glob must still
  match. This is currently fine but is an implicit coupling to the tsup output naming.
- **`new URL()` on data URIs / blob URIs:** Some image optimisation libraries set `src` to
  `data:image/...` or `blob:...`. The existing `_extractHost()` guard (`!url.startsWith('http')`)
  already returns `null` for these. Adding `<img>` support does not break this.
- **Double-intercept risk with `<img>` via both `setAttribute` and property setter paths:**
  the existing idempotency guard in `_holdElement()` (checks `ATTR_AUTO_DETECTED`) prevents
  double-registration, but the `_staged` queue could in theory receive two entries for the
  same element if both paths fire before Phase 2. The existing skip logic in `activateMatcher()`
  (`if (el.getAttribute(ATTR_AUTO_DETECTED)) continue`) handles this; no new logic needed.
- **~175-service ceiling on ESM ON path** is only ~50–75 services away from the current
  DB size [Finding 2]. This is not v6-immediate but must be tracked.
- **Diagnostic without NODE_ENV guard:** if the dev-only warning is shipped unguarded, it
  appears in every production console and is un-removable by the consumer.

---

## Recommendations

Priority-ordered:

1. **Guard the bootstrap-order diagnostic with `process.env.NODE_ENV !== 'production'`** —
   zero-cost in production, correct in dev. The IIFE `minify: true` build already activates
   esbuild DCE; no tsup config change required. This is a correctness requirement, not just
   a nice-to-have: unguarded diagnostics in production violate the "nothing throws, no dev
   noise in prod" acceptance criterion [goals.md §Acceptance bar]. Cost if guarded: 0B.

2. **Add `'IMG'` to the `tagName` check in `patchedSetAttribute` only** — do NOT add a
   separate `defineProperty` src trap in `patchedCreateElement` for `<img>` unless there is
   a demonstrated need. `<img>` src is almost always set via `setAttribute` or inline HTML
   (which fires `setAttribute`). The property setter path adds complexity and the double-intercept
   risk for marginal coverage gain.

3. **Apply an apex-domain prefilter before `new URL(url)` in `matchAutoBlock()`** — a
   `Set.has()` check on the apex portion of the URL (extracted via `indexOf('.')` fast path,
   not a full URL parse) eliminates the `new URL()` cost for non-tracked hosts. With `<img>`
   adding a ~50x volume increase in intercept calls on image-heavy pages, this filter is worth
   adding alongside the `<img>` PR.

4. **Keep pixel-class DB entries to `requestPaths` (host+path) not broad `requestHosts`** —
   pixel endpoints (`facebook.com/tr`) share hostnames with non-tracking resources.
   `requestPaths` entries already work correctly and cost only marginally more per entry (~20B
   extra gzip). Never add `facebook.com` as a bare `requestHosts` entry; it would block all
   Facebook embeds.

5. **Add a CI assertion that `db-autoblock.generated` appears only in `autoblock-loader.ts`
   static imports** — protects the tree-shake-to-zero guarantee as the DB grows [goals.md
   §Acceptance bar]. A one-line `grep` in the CI lint step suffices.

6. **Add a 17KB soft-warn entry to `.size-limit.json` for the ESM ON path** (the binding
   constraint) alongside the existing 20KB hard limit. At current trajectory (~48B per new
   service), a 17KB warning fires after adding ~50 services — well before the 20KB hard wall.

---

## Open questions for the user

1. **How many new pixel/beacon entries are targeted for v6?** At 48B/entry gzip, 10 entries
   costs 480B; 30 entries costs 1,440B. This changes whether there is meaningful work needed
   on the size-limit tooling vs. just adding entries.

2. **Should `requestPaths`-matching `<img>` entries also match `<script>` and `<iframe>`?**
   Meta Pixel's `facebook.com/tr` path today is a pixel (GIF pixel); the same host also
   has JS-based forms. Confirm whether the existing meta-pixel entry's `requestPaths` is
   intended to gate script blocking too, or only pixel interception in v6.

3. **Is the apex-domain prefilter (Recommendation 3) acceptable given it duplicates
   some index-build logic?** An alternative is to cache the `new URL(url).hostname` result
   — acceptable since URLs are typically unique; the cache hit rate is low. Prefer the
   prefilter or the caching approach?

---

## Out of scope

- `document.write` legacy injection — explicitly deferred past v6 [goals.md §What's deferred to later versions].
- Heuristic/ML-based detection of services not in the curated DB.
- Service Worker network interception (incompatible with plain `<script>` install model).
- Any server-side or CDN-edge enforcement.
- Auto-block on by default (a separate product decision, out of v6 [goals.md §What's deferred to later versions]).
## Update — 2026-06-11 — Author decisions

Open questions A–D resolved by the author (all confirm the recommended defaults; no `/pm:amend` needed — scope and schema unchanged):

- **A. DB expansion (→ Meta Pixel + ~5 majors).** Add `<img>`-pixel `requestPaths` entries for Meta, LinkedIn, Pinterest, Snapchat, TikTok, Reddit (~6 services). Trivially under the 20 KB budget.
- **B. `<img>` modeling (→ reuse `requestPaths`, no new field).** Interception keys on host + `requestPaths` only (never host alone); no `imgPixel`/`kind` schema field, so the parity test and codegen are unchanged.
- **C. `fetch`/`sendBeacon` (→ document as honest limit).** DOM interception cannot see `fetch`/`sendBeacon` beacons; v6 documents this as a known gap in the §3.8 honest-parity story. No `window.fetch` patch in v6 (deferred).
- **D. Diagnostic trigger (→ `debug:true` only).** The bootstrap-first warning fires only when `config.debug` is set; the diagnostic code is still DCE-stripped from production builds to cost zero bytes.
- **E–G (safe defaults adopted by the planner):** pixel fires synchronously in the grant handler on consent (E); held pixels rely on no-src (typically 1×1/`display:none`) (F); diagnostic in a new `autoblock-diagnostic.ts`, apex-domain prefilter for the hot path, `<img>` proxy intercepts both `img.src=` and `setAttribute('src',…)` (G).
