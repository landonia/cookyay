# Performance-engineer — Research findings

## Summary

- The v4 `cookyay` IIFE bundle is already lean at **8,760B gzip** (bootstrap 493B + IIFE 8,760B = **9,253B combined**, well under the 20KB limit), leaving **~11KB of gzip headroom** [prd.md §3.1, §5].
- The full 50-service signature DB (`services.yaml`) compiled to a compact host→category JSON map measures **2,387B raw / 752B gzip** — only **6.4% of available headroom** — making inline delivery in the IIFE bundle the dominant choice on all three dimensions: budget, latency, and correctness.
- The critical timing problem is structural, not budgetary: **parser-inserted `<script>` tags in HTML cannot be intercepted or blocked by JavaScript at all**, regardless of DB delivery mechanism. Auto-block via `document.createElement` proxying works only for dynamically-injected scripts (GTM-loaded tags), which is the most common real-world case.
- A lazily-loaded separate DB asset is ruled out because the fetch (100–300ms) completes *after* dynamic third-party scripts have already executed, negating the blocking purpose.

## Findings

1. **Current bundle is at 45% of budget.** `dist/bootstrap.js` is 1,024B raw / 493B gz; `dist/index.iife.js` is 31,746B raw / 8,760B gz; combined **9,253B gz (9.0KB)** against the 20KB (20,480B) budget [prd.md §3.1, §5]. Raw sizes are deliberately uncompressed (tsup produces readable ESM + minified IIFE); the gzip figure governs CDN delivery.

2. **Signature DB for 50 services compresses to 752B gzip.** The client needs only `requestHosts` (99 entries) and `requestPaths` (2 entries) mapped to single-char category codes (`a/f/m/n`). The compact JSON `{"h":{…},"p":[…]}` is 2,387B raw / 752B gz at gzip level 9. Matching logic (a `Map` lookup + 2-entry path scan) adds roughly 200B gz. Total inline DB cost: **~952B gz** [v5/goals.md §Signature-DB delivery, prd.md §5].

3. **Inline DB in the IIFE is safe and leaves 10KB headroom.** Adding 952B gz to the current 9,253B gz yields ~10,205B gz (10.0KB), with **~10,275B gz (10.0KB) still remaining** before the 20KB wall [prd.md §3.1 budget, v5/goals.md §Honor the <20KB budget]. Even if the banner UI grows in future versions, the DB imposes no meaningful pressure. There is no budget-driven case for a lazy-loaded asset.

4. **A lazily-loaded separate DB asset fails the timing requirement.** Third-party scripts injected dynamically (GTM container fires them immediately on load) typically execute within 0–50ms of the IIFE itself loading. A `fetch()` to a CDN-served DB file adds 100–300ms of round-trip before the DB is parsed and ready. Scripts will have already run. The lazy option is only viable if auto-block is accepted as best-effort-for-subsequent-navigation, not first-paint [v5/goals.md §Client-side signature recognition].

5. **Parser-inserted scripts are structurally un-interceptable.** Browser HTML parsers speculatively fetch and execute `<script src>` tags as they are streamed, before any JS can observe them. No JS hook (`MutationObserver`, `document.createElement` proxy, `beforescriptexecute` — non-standard) can block a `<script>` injected by the HTML parser itself. This is not a limitation of DB delivery; it is browser architecture. The existing declarative blocking mechanism (`type="text/plain"` + `data-category`) already handles parser-inserted scripts correctly, and v5 auto-block should document this boundary clearly [prd.md §3.2, v5/goals.md §Client-side signature recognition].

6. **`document.createElement` proxying covers the real-world dynamic-injection case.** The vast majority of analytics/marketing scripts in production are loaded by GTM or similar tag managers that call `document.createElement('script')` and set `el.src = …`. A property trap on `src` can intercept these synchronously, queue the element, and suppress insertion until consent is granted. The proxy must be armed in the **synchronous bootstrap snippet** (before GTM fires) using a minimal host-set seeded from `window.__COOKYAY`. Estimated bootstrap addition: ~350B gz for the proxy stub alone [prd.md §5 two-part bootstrap, v5/goals.md §Client-side signature recognition].

7. **A Set/Map of 99 hostnames is the correct data structure; no trie needed.** At 99 entries a `Map.has()` lookup is O(1) and ~0.001ms. A suffix-domain match (e.g. `foo.hotjar.com` matches `hotjar.com`) requires stripping subdomains — a single `hostname.split('.').slice(-2).join('.')` operation, still sub-millisecond. The 2-entry path list is trivially a linear scan. There is no performance case for a trie or regex at this scale [v5/goals.md §Acceptance bar].

8. **The bootstrap intercept stub requires the DB to be seeded synchronously.** The IIFE loads deferred (`defer` attribute), but the intercept proxy must fire before GTM. Two sub-options: (a) embed a redundant minimal host list (top ~30 hosts for high-traffic trackers) in the bootstrap itself — bootstrap grows by ~250B gz; (b) require auto-block to be opt-in and document that it only blocks scripts injected after the IIFE loads (simpler, covers GTM). Option (b) is simpler and covers the dominant case. Option (a) provides defense-in-depth for GTM-free sites that inline tracker scripts early [prd.md §5 <1KB snippet constraint, v5/goals.md §Auto-block opt-in via config].

## Gotchas

- **Bootstrap size creep.** The bootstrap is currently exactly 1,024B raw / 493B gz. Adding a full host list to it risks crossing the psychological <1KB threshold. The intercept proxy logic alone is ~500B gz; adding even the top-30 hosts (~200B gz) keeps the bootstrap well under 1KB raw in practice, but this should be verified at build time by the CI size gate.
- **`document.createElement` proxy interacts poorly with some third-party scripts.** Some scripts defensively cache `document.createElement` before libraries can proxy it. If GTM loads before Cookyay's bootstrap, the proxy is useless. The v5 install instructions must be explicit: bootstrap snippet **must** appear before any other `<script>` in `<head>`.
- **`new URL(src, location.href)` in the proxy will throw on relative paths.** The intercept must guard against relative `src` values (they are always first-party, never need blocking). A `try/catch` or a `/^https?:\/\//` prefix guard is required.
- **Codegen must strip fields unused at runtime.** The generated TS for the client DB should include only `requestHosts` and `requestPaths` (and `category`). Including cookie/localStorage patterns in the client bundle wastes bytes at no runtime benefit — those fields are scanner-only.

## Recommendations

1. **Deliver the DB inline in the IIFE bundle via codegen.** A build step (analogous to the existing `build-services-db.mjs` for the scanner) generates a `src/db-client.generated.ts` in the `cookyay` package containing `const HOST_DB: Record<string, CategoryCode> = {…}` and `const PATH_DB: [string, CategoryCode][] = […]`. The IIFE tree-shakes away unused runtime fields. Cost: ~952B gz, total bundle ~10.0KB gz.

2. **Arm a `document.createElement` proxy in the deferred IIFE, not the bootstrap.** Accept the trade-off: auto-block catches scripts injected dynamically *after* the IIFE loads (covers GTM-managed tags, which is the primary use case). This avoids bloating the bootstrap and avoids the proxy-caching race condition. Document clearly: "auto-block does not fire before the cookyay bundle loads; for scripts that must be blocked before first paint, use declarative blocking."

3. **Use a plain `Map` keyed by TLD+1 (eTLD+1 simplified).** Strip leading subdomains to the last two labels for matching. Do not use regex or trie — over-engineering for 99 entries.

4. **Gate the feature behind `autoBlock: true` in config.** When `false` (default), the DB is tree-shaken out of the bundle entirely (or the map is just never iterated). This preserves the existing bundle baseline for sites that do not opt in.

5. **Add a CI `size-limit` assertion at 17KB (soft warn) and hard-fail at 20KB.** The architecture.md already mentions a 17KB soft warn; this should be enforced for the IIFE specifically, with and without `autoBlock` code paths present.

## Open questions for the user

1. **Should the bootstrap grow to include a minimal host-set for pre-IIFE blocking?** This covers the narrow case where a site inlines GTM above the Cookyay IIFE. The cost is ~250B gz extra in the bootstrap. Is that case worth supporting, or is "move Cookyay above GTM" an acceptable install requirement?

2. **Should the client DB be tree-shaken (zero cost when `autoBlock: false`) or always present?** Always-present simplifies the build but costs ~750B gz for every user regardless of opt-in. Tree-shaking requires the DB import to be conditional on the config flag at the module level, which is slightly more complex.

3. **How should `requestPaths` matching interact with subdomains?** The current two path entries are `facebook.com/tr` and `www.google.com/recaptcha/`. Is an exact-host match (`www.google.com`) correct, or should path matching also accept subdomains of the path host?

## Out of scope

- Cookie/localStorage signal matching at runtime (scanner-only; adds no blocking value at runtime since blocking is URL-based).
- Regex or glob matching for `scriptUrlGlobs` / `iframeSrcGlobs` (those fields are empty in all 50 current services; can be deferred).
- Heuristic detection of services not in the curated DB [v5/goals.md §What's deferred to later versions].
- Service Worker `fetch` interception (would cover XHR/fetch network requests but requires opt-in HTTPS installation, incompatible with the plain-`<script>` install model).
- Any server-side or CDN-edge consent enforcement.
