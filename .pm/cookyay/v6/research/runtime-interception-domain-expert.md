# runtime-interception-domain-expert — Research findings

## Summary

The v5 `createElement`/`src`-setter proxy is a solid foundation but covers only a
subset of `<img>` creation paths. `new Image()` bypasses it entirely; `fetch()` and
`sendBeacon()` are completely orthogonal. For pixels specifically, the fire-and-forget
semantics mean "block-until-consent then re-execute" does not directly apply — the
right model is suppress-then-fire-once-on-grant (with no replay after the page visit
ends). Strict host+path scoping from the curated DB is the correct and sufficient
guard against content-image breakage. The bootstrap-first diagnostic is straightforwardly
implementable via `performance.getEntriesByType('resource')` combined with a DOM scan,
but must be gated to dev mode only and must tolerate false positives gracefully.

---

## Findings

### 1. `<img>` interception surface — what the v5 proxy catches and what it misses

[goals.md §What ships in v6]

The v5 proxy installs two hooks: a `document.createElement` wrapper and a
`Element.prototype.setAttribute` override. For `<img>`:

**Covered paths:**
- `document.createElement('img')` followed by `el.src = url` — the instance-level
  one-shot getter/setter installed by the `createElement` wrapper intercepts the
  `src` assignment before the browser sees it.
- `document.createElement('img')` followed by `el.setAttribute('src', url)` — the
  `setAttribute` prototype override fires.
- `<img>` in HTML injected via `innerHTML` — the HTML parser does NOT call
  `document.createElement`; it creates elements natively. However, if the injected
  `<img>` has a `src` attribute in the string, the parser sets it as a DOM attribute
  after parsing. Whether `setAttribute` fires depends on the parser implementation;
  in practice Chromium's HTML parser does NOT route through `Element.prototype.setAttribute`
  for parser-initiated attribute setting — this is a **blind spot**.

**Blind spots:**
- `new Image()` — this calls the `HTMLImageElement` constructor directly, NOT
  `document.createElement`. The `createElement` wrapper is never invoked. This is a
  **significant gap**: Meta Pixel's classic snippet uses `new Image()` for the pixel
  fire and many tag managers do likewise.
- `<img src="...">` present in the original HTML or injected via `innerHTML`/`insertAdjacentHTML` —
  the native HTML parser path bypasses both hooks entirely.
- `el.setAttribute('srcset', ...)` — the `setAttribute` override only filters on
  `name === 'src'`; `srcset` fires a separate set of image requests and is not
  intercepted.
- `fetch(url)` and `navigator.sendBeacon(url)` — completely orthogonal. These are
  not `<img>` mechanics at all. Modern Meta Pixel, TikTok Pixel, and similar SDKs
  increasingly use `fetch`/`sendBeacon` for reliability (keepalive fetch survives
  page unload). No amount of `<img>` interception catches these; they require a
  separate Service Worker or `fetch` monkey-patch (high-risk, out of v6 scope
  per goals.md §What's deferred to later versions).

**Practical coverage verdict:** The v5 mechanism, extended to `<img>`, will catch
`document.createElement('img') + .src = ...` and its `setAttribute` variant — a
common dynamic-JS pattern. It will NOT catch `new Image()` (the canonical pixel
pattern), parser-initiated `<img src>`, or `fetch`/`sendBeacon` beacons. v6 must
add a `new Image()` constructor trap to close the most impactful gap.

**`new Image()` trap approach:** Override `window.Image` (the HTMLImageElement
constructor exposed on the global object) synchronously in the same bootstrap tick
as the existing overrides. Intercept the `src` property on the returned instance
identically to the `createElement` path. This is safe: `window.Image` is
configurable, the original constructor is captured as `_origImage`, and the same
one-shot instance property trick applies. Example shape:

```ts
const _origImage = window.Image
window.Image = function PatchedImage(width?: number, height?: number) {
  const img = new _origImage(width, height)
  // install one-shot src trap identical to createElement path
  return img
} as unknown as typeof Image
window.Image.prototype = _origImage.prototype
```

This closes the `new Image()` gap at negligible cost.

---

### 2. Fire-and-forget semantics — does "block-until-consent then re-execute" map?

[goals.md §Acceptance bar]

For scripts and iframes, "re-execute on grant" means injecting a live `<script>`
clone or re-assigning the `<iframe>` `src` — the resource is fetched, parsed, and
runs. The v5 `blocking.ts` grant/inject queue handles this.

Pixels carry a fundamentally different contract:

- The pixel request is a side-effect-only GET: no JS executes, no response is
  consumed. Its only purpose is to fire a 1x1 image request to a tracker endpoint,
  signalling that a page view / event occurred.
- The event being tracked (page load, pageview, add-to-cart) is tied to a specific
  moment in the user's visit. Firing the pixel 10 seconds later on consent grant
  still fires it at roughly the right time, which is acceptable.
- Firing it on a subsequent page load after the visit ends is not meaningful — the
  event timestamp would be wrong and most pixel endpoints deduplicate or time-window
  incoming events.

**Correct model:** Suppress the pixel at creation time. On consent grant, if the
`HeldElement` for the pixel is still in the held queue (i.e. the page has not been
torn down), fire it once by assigning the original `src` to the held `<img>` element.
This is simpler than script re-execution: no cloning, no `<script>` injection, just
`img.src = storedSrc`. If the page navigates away before consent is granted, the
pixel is simply never fired — this is the correct outcome (the user did not consent
during that visit).

The acceptance bar's "IS made after the matching category is granted" criterion
[goals.md §Acceptance bar] is met by this model: in the fixture, grant fires on the
same page as the block, so the network request is asserted on-page.

`HeldElement` should be extended (or a parallel `HeldPixel` type introduced) to
record `<img>` alongside `<script>`/`<iframe>`. The grant/inject path in `blocking.ts`
needs a branch: for `<img>` held pixels, simply assign `el.src = src` rather than
running the script-injection flow.

---

### 3. Page-breakage risk — scoping to curated endpoints only

[goals.md §What ships in v6 — "never `<img>` elements broadly"]

The v5 goals.md already specifies the mitigation: blocking is scoped to curated
tracking-pixel endpoints (host + path / `requestPaths`), never `<img>` broadly.
The technical substance:

- The matcher's `requestPaths` field (already present in the curated DB for `<script>`
  entries) must be populated for every pixel-class entry. A signature match requires
  BOTH the host AND a matching path prefix/pattern (e.g. `facebook.com` + `/tr`).
  A bare `<img>` with `src="https://facebook.com/some-profile-photo.jpg"` does NOT
  match because the path `/some-profile-photo.jpg` is not in `requestPaths`.
- Lazy-loading libraries (lazysizes, Intersection Observer patterns) assign `src`
  from a `data-src` attribute swap — these are first-party or CDN-hosted image URLs
  that will never match any tracker host in the curated DB. Zero risk.
- CLS risk from held images: a held `<img>` that is layout-relevant (e.g. a hero
  image that happens to be served from a tracker domain) would cause CLS. This risk
  is real but negligible in practice because: (a) the curated DB only contains known
  tracker endpoints, not image CDNs; (b) tracking pixels are always 1x1 transparent
  GIFs with no layout impact. The risk can be further mitigated by checking element
  dimensions: if `width` and `height` attributes are both set to non-pixel values
  (e.g. `width > 1 || height > 1`) skip interception and log a debug warning.

**Recommendation:** Require that every pixel-class DB entry has a non-empty
`requestPaths` array with at least one path prefix. Enforce this in the DB validation
tooling (contribution gate). This is the primary correctness invariant.

---

### 4. Bootstrap-first diagnostic — detection mechanics

[goals.md §What's new in v6, §Bootstrap-first mitigation]

Two complementary signals, both available synchronously at bootstrap time:

**A. `performance.getEntriesByType('resource')`**
Returns all already-fetched resources (including images, scripts, XHR/fetch). If a
known tracker URL appears here at bootstrap time, it was fetched before the proxy
installed. Match each entry's `.name` (the URL) against the curated DB at startup.
Reliability: high for scripts and images loaded before the bootstrap script.
False positives: effectively none — a URL matching a known tracker in the DB
genuinely loaded before interception.
Caveat: PerformanceObserver/Navigation Timing Level 2 is available in all evergreen
browsers. Resource Timing entries for cross-origin resources may have `name` but
not timing breakdown detail — the URL is always present regardless of CORS headers,
so matching is reliable.

**B. DOM scan of existing `<script src>`, `<img src>`, `<iframe src>`**
Walk `document.querySelectorAll('script[src], img[src], iframe[src]')` at bootstrap
time. Match each `src` against the DB. This catches parsers-committed HTML elements
that may not yet have fired network requests (e.g. elements added after DOMContentLoaded
but before the proxy installed). Complements the PerformanceObserver approach.

**Combining both:** Use `performance.getEntriesByType('resource')` as the primary
signal (network proof), DOM scan as a secondary hint. If either hits, fire the
console warning.

**Dev-only gating:** Gate behind a `debug: true` config flag or `NODE_ENV !== 'production'`
check. The warning should name the specific service and the offending URL to make it
actionable:

```
[Cookyay] INSTALL ORDER WARNING: "Meta Pixel" (https://connect.facebook.net/...) 
loaded before Cookyay bootstrap. Move Cookyay to the first <script> in <head>.
Auto-block cannot retroactively suppress already-fetched resources.
```

No attempt to retroactively block — this is correctly specified as diagnostic-only
[goals.md §What's new in v6].

---

### 5. Skip-Google and declared-wins for pixels

[goals.md §What ships in v6 — "Skip-Google and declared-wins still apply"]

Both invariants extend naturally to the `<img>` path without new logic:

- **Skip-Google:** The curated DB contains no Google-owned hosts in pixel-class
  entries (identical to the script/iframe posture). The matcher returns null for all
  Google pixel endpoints (e.g. `google-analytics.com/collect`, `doubleclick.net`),
  so they are never intercepted. No change needed.
- **Declared-wins:** The `_holdElement` function already checks
  `el.getAttribute(ATTR_STATE) === STATE_BLOCKED` and skips double-registration.
  `<img>` elements held by the proxy receive the same `data-cookyay-state="blocked"`
  attribute, so a declared rule arriving after the auto-detection does not double-register.
  The idempotency guard (`ATTR_AUTO_DETECTED` check) prevents re-entry via
  `setAttribute` + property setter dual-fire.

---

## Gotchas

1. **`new Image()` is the canonical pixel pattern — omitting it makes v6's pixel
   interception materially incomplete.** Meta Pixel's standard snippet uses
   `new Image()` directly. The gap must be closed synchronously in the same bootstrap
   tick as the `createElement` and `setAttribute` overrides.

2. **`fetch`/`sendBeacon` beacons are invisible to any DOM-level interception.**
   Modern SDKs (Meta Pixel Advanced Matching, TikTok Events API browser-side) use
   `fetch` with `keepalive: true` instead of `<img>`. This is an honest limitation
   that v6 should document rather than attempt to solve (a fetch monkey-patch or
   Service Worker would be high-risk scope creep).

3. **`innerHTML` / `insertAdjacentHTML` injection bypasses both hooks.** A
   third-party script that injects `<img src="https://example.com/pixel">` via
   innerHTML sidesteps the createElement wrapper. This is acceptable because: the
   injecting script itself is already blocked by the v5 mechanism, so its inline pixel
   injection never runs. The only gap is pixels injected by scripts that the auto-block
   mechanism missed (e.g. scripts loaded before bootstrap) — but those are already
   in the bootstrap-first diagnostic category.

4. **The one-shot src trap (delete instance property) must be applied to `<img>`
   elements created via `new Image()` identically to those from `createElement`.**
   Re-entry on `img.src = placeholder` patterns (lazy loaders doing `src=''` then
   `src=realUrl`) will re-arm the prototype setter if the instance property is
   deleted — confirm the idempotency guard (`ATTR_AUTO_DETECTED`) prevents
   double-hold in this case.

5. **PerformanceObserver bootstrap diagnostic has a timing subtlety.** If Cookyay
   itself is loaded asynchronously (e.g. `<script async>`), the window between
   HTML-parser-committed third-party scripts and the bootstrap is larger and the
   diagnostic becomes more important. The DOM scan is more reliable than PerformanceObserver
   alone in this case because DOM elements are committed before network requests
   complete.

---

## Recommendations

**Priority 1 — Must do to meet the acceptance bar:**

1. Extend `installAutoBlockProxy()` to also override `window.Image` using the same
   one-shot instance property pattern as the `createElement` path. This closes the
   `new Image()` gap.
2. Extend `HeldElement` (or create `HeldPixel`) to hold `HTMLImageElement` and add
   an `<img>` branch in the `blocking.ts` grant/inject path: `img.src = storedSrc`.
3. Require `requestPaths` (non-empty) on every pixel-class DB entry; enforce in
   the DB validation script.

**Priority 2 — Quality and correctness:**

4. Add a bootstrap-first diagnostic function (dev-only) that runs
   `performance.getEntriesByType('resource')` + DOM scan at the end of
   `installAutoBlockProxy()`, matching URLs against the DB and emitting a named
   warning for each hit.
5. Document `fetch`/`sendBeacon` beacons as an explicit honest limitation in
   `RELEASE.md` (parallel to v5's pixel and `document.write` entries).

**Priority 3 — Defence in depth:**

6. For `<img>` holds, optionally check element dimensions at hold time: if `width`
   and `height` are both greater than 4px, emit a debug warning ("held a large image
   — verify this is a tracking pixel, not a content image") rather than silently
   blocking. Does not change the block decision (path match already did that), but
   aids debugging.

---

## Open questions for the user

1. **`fetch`/`sendBeacon` scope:** Should v6 document these as a known gap (as
   recommended), or does the user want to attempt a `window.fetch` monkey-patch? The
   latter is significantly higher risk and complexity; the recommendation is to defer.
2. **`<img>` hold-and-fire timing:** When consent is granted, should the pixel fire
   synchronously in the grant handler, or is a slight async delay (rAF / microtask)
   acceptable? For analytics accuracy, synchronous is preferred.
3. **Pixel-class DB entries:** How many pixel/beacon endpoints should ship in v6's
   initial expansion? Is Meta Pixel + 4–5 others sufficient, or is a broader sweep
   expected before release?
4. **Bootstrap diagnostic trigger:** Should the warning appear in `debug: true` mode
   only, or for any non-production build (e.g. any `localhost` origin)? The latter
   is more discoverable for developers who don't know about the `debug` flag.

---

## Out of scope

- `document.write` legacy ad injection — explicitly deferred by goals.md §What's
  deferred to later versions.
- `fetch`/`sendBeacon` interception — requires Service Worker or `window.fetch`
  monkey-patch; high risk, narrow payoff at v6 scale; not in goals.md.
- `srcset` interception — no known major tracker uses srcset for pixel firing; low
  priority.
- Auto-block on by default — remains opt-in; unchanged from v5.
- Any consent UI, i18n, or hosted infrastructure changes — out of scope for v6.
## Update — 2026-06-11 — Author decisions

Open questions A–D resolved by the author (all confirm the recommended defaults; no `/pm:amend` needed — scope and schema unchanged):

- **A. DB expansion (→ Meta Pixel + ~5 majors).** Add `<img>`-pixel `requestPaths` entries for Meta, LinkedIn, Pinterest, Snapchat, TikTok, Reddit (~6 services). Trivially under the 20 KB budget.
- **B. `<img>` modeling (→ reuse `requestPaths`, no new field).** Interception keys on host + `requestPaths` only (never host alone); no `imgPixel`/`kind` schema field, so the parity test and codegen are unchanged.
- **C. `fetch`/`sendBeacon` (→ document as honest limit).** DOM interception cannot see `fetch`/`sendBeacon` beacons; v6 documents this as a known gap in the §3.8 honest-parity story. No `window.fetch` patch in v6 (deferred).
- **D. Diagnostic trigger (→ `debug:true` only).** The bootstrap-first warning fires only when `config.debug` is set; the diagnostic code is still DCE-stripped from production builds to cost zero bytes.
- **E–G (safe defaults adopted by the planner):** pixel fires synchronously in the grant handler on consent (E); held pixels rely on no-src (typically 1×1/`display:none`) (F); diagnostic in a new `autoblock-diagnostic.ts`, apex-domain prefilter for the hot path, `<img>` proxy intercepts both `img.src=` and `setAttribute('src',…)` (G).
