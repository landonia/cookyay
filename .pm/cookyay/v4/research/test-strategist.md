# Test-strategist — Research findings

## Summary

v4 adds a ~50-service signature database and a detection/classification pass to
`@cookyay/scanner` [goals.md §"What's new in v4"]. The existing test
infrastructure is well-suited: Vitest node-env unit tests already cover `db.ts`
lookups, `classifier.ts`, and `config-emitter.ts` in `classifier.test.ts`; a
golden-file E2E test in `scanner-classify.spec.ts` already asserts a byte-stable
`expected-config.json` against the hermetic fixture site. v4 needs (1) schema
validation and per-service matching unit tests added to the existing Vitest suite
as the DB grows, (2) a handful of new fixture pages serving signals of
representative third parties for hermetic detection e2e, (3) a new golden file
for the auto-detection path, and (4) careful management of Playwright CI cost
given two existing jobs that each install Chromium.

---

## Findings

### F1 — The signature DB already has a strong structural foundation [prd.md §3.6, goals.md §"maintainable DB"]

`db.ts` defines `ServiceDefinition` with typed required fields (`id`, `name`,
`category`, `cookies`, `localStorage`, `requestHosts`, `source`). The OCD
auto-generated file (`db-ocd.generated.ts`) holds 439 services; the hand-curated
block in `db.ts` holds 20 top-tier services. `fixtures/service-fingerprints.json`
already captures a parallel description of 20 services with `stubCookies`,
`stubScript`, and `stubIframeSrc` fields.

For v4 schema validation, a dedicated Vitest file (`db.test.ts`) should assert:
- All IDs are non-empty strings with no duplicates across `SERVICE_DB`.
- `category` is one of the four known values.
- Every entry with `source: 'curated'` has at least one of `cookies`,
  `localStorage`, or `requestHosts` populated (no signal-free curated entry).
- No curated entry overrides the `ocd-` ID prefix (ownership clarity for PRs).

This is cheap, fully in-process, and catches ~90% of community PR mistakes before
Playwright runs. Runtime: <100ms.

### F2 — Per-service matching unit tests fit cleanly into `classifier.test.ts` conventions [goals.md §"CI fixture covers DB + detection"]

`classifier.test.ts` drives `findServiceByCookie`, `findServiceByHost`, and
`findServiceByLocalStorage` directly with synthetic inputs — no Playwright, no
fixture server. The pattern established there (exact name, wildcard, null/unknown)
is the right template for adding v4 services.

For ~50 curated services, one `describe` block per service is overkill. Instead,
a data-driven table approach: export a `CURATED_SIGNAL_TABLE` fixture (one row per
service: `{ id, cookieSample, hostSample, localStorageSample }`) and iterate it
in a single `it.each` test that asserts each sample resolves to the correct
service ID and a confidence of `'high'` (cookie/localStorage) or `'medium'`
(host). This scales to 50+ services with ~30 lines of test code and a single
table to maintain. False-positive guards (like the existing `t.co` regression
tests for `twitter-pixel`) should be added as explicit named tests when a new
ID's request-host patterns are short/ambiguous.

### F3 — Hermetic fixture coverage for auto-detection [goals.md §Acceptance bar, prd.md §3.6]

The current fixture site tests the *blocking* path (declared scripts with
`data-category`). v4 auto-detection requires fixtures that emit *observable
signals* without relying on real network — the scanner needs to see cookies,
request hosts, and scripts that match known service signatures.

Minimum viable fixture set (5–6 representative pages, one per signal type):

| Page | Signal emitted | Services exercised |
|---|---|---|
| `fixtures/detection/cookie-signals.html` | Sets `_ga`, `_fbp`, `_hjid` via `document.cookie` before crawl | ga4, meta-pixel, hotjar |
| `fixtures/detection/request-signals.html` | `<script src="http://www.google-analytics.com/...">` (served locally via fixture server redirect to an empty JS stub) | ga4 (host match) |
| `fixtures/detection/localstorage-signals.html` | Sets `ajs_user_id`, `_hjSessionId` via `localStorage.setItem` | segment, hotjar |
| `fixtures/detection/mixed-signals.html` | Combines cookie + request + localStorage signals for 3–4 services | Round-trip detection golden |
| `fixtures/detection/no-signals.html` | Completely clean page | Asserts zero classified services, empty `_unclassified` |

The fixture server (`fixtures/serve.mjs`) already handles static file serving and
is started by `playwright.config.ts` `webServer`. Request-host matching for
third-party hosts requires a different approach since the crawl checks
`req.firstParty` — the crawler marks a request as third-party when the host
differs from the page host. Since the fixture server is `localhost:4001`, any
script tag pointing at `www.google-analytics.com` would be a cross-origin request
blocked by the browser's network layer in the test environment. The correct
approach is to serve a redirect stub from the fixture server at a path like
`/fixtures/stubs/ga4-beacon` that the test HTML points to as a *relative* URL,
and instead rely on cookie and localStorage signals for most services. Host-match
testing is already covered by the Vitest unit tests in F2 and does not need a
real Playwright crawl.

### F4 — Golden file strategy for auto-detection config emit [goals.md §Acceptance bar]

The existing golden test in `scanner-classify.spec.ts` compares normalized
`emitConfig()` output for `fixtures/blocking/all.html` against
`e2e/expected-config.json`. v4 should add a second golden file
`e2e/expected-detection-config.json` targeting
`fixtures/detection/mixed-signals.html`. The same `normalizeConfig()` helper
(replaces `FIXTURE_BASE` and `scannedAt`) already handles non-determinism. The
golden file must be committed and regenerated deliberately (run `playwright test
--update-snapshots` equivalent via a manual update script) whenever DB entries
change intentionally. Reviewers updating the DB must regenerate the golden file
as part of the PR — enforce this via a comment in the golden JSON header.

### F5 — Playwright/Chromium flake and CI cost [architecture.md §9]

Current CI runs two Playwright jobs on PRs (`e2e` and `accessibility` in
`pr.yml`) that each install Chromium independently despite sharing the same cache
key `playwright-${{ runner.os }}-${{ steps.pw-ver.outputs.version }}`. They run
in parallel so the cache is usually warm on the second job but the install step
still runs. v4 detection e2e adds a third Playwright crawl per test. Budget
impact on GitHub Actions free tier (2000 min/month): each Playwright job
currently takes roughly 2–3 min; v4 adds <1 min of crawl time if the new fixture
pages are small. Total PR run stays under 10 min.

Flake risks specific to v4:
- **Cookie visibility timing**: setting `document.cookie` in a fixture page and
  then reading it during the Playwright crawl requires the crawl to wait for page
  load. The existing `crawler.ts` already waits for `networkidle`; this is
  sufficient.
- **`ensureBrowser()` cold-start in CI**: v3 added auto-provisioning; `pr.yml`
  already runs `playwright install chromium --with-deps` before the test step, so
  `ensureBrowser()` finds the binary present and is a no-op. No new risk.
- **Port conflicts**: `playwright.config.ts` uses `reuseExistingServer: !CI` so
  in CI a fresh server always starts on 4001. The detection fixture pages must
  use the same port.
- **retries: 0** is already set in `playwright.config.ts` — this is correct for
  a library this small. v4 should maintain this policy; flake means a real bug.

---

## Gotchas

- `findServiceByHost` uses exact + subdomain match (not `includes()`) — a
  deliberate false-positive guard added after the `t.co` regression
  [classifier.test.ts lines 119–135]. Any new curated service with a short
  domain fragment needs an explicit false-positive test.
- The OCD-generated file has 439 entries. Running all 439 through `findServiceByCookie`
  in a unit test table would be slow. Limit the data-driven table (F2) to the
  ~50 curated services; OCD coverage is tested implicitly by the existing
  `findServiceByCookie('__cf_bm')` Cloudflare test.
- `fixtures/service-fingerprints.json` and `db.ts` are currently kept in sync by
  convention, not by a test. As the DB grows to 50 services this divergence risk
  increases. A Vitest test that imports both and cross-checks IDs would catch
  drift for community PRs.
- Request-host signals require the crawler to observe a *completed* outgoing
  request. For the fixture site this means the stub script at the pointed-to URL
  must actually respond (even with an empty 200). A fixture serving `204 No
  Content` from `fixtures/serve.mjs` for a path like `/stubs/ga4-beacon.js` is
  sufficient.

---

## Recommendations

1. **Add `db.test.ts`** (Vitest node-env) with schema validation (no-dup IDs,
   valid categories, required fields) and a `it.each` data-driven table for all
   ~50 curated services. Keep it beside `classifier.test.ts`. Target: <200 lines.

2. **Add 4–5 fixture pages** under `fixtures/detection/` emitting cookie and
   localStorage signals for representative services (ga4, meta-pixel, hotjar,
   segment, intercom). Avoid real outbound URLs; rely on cookie/localStorage for
   signal-richness, and add one request-host fixture that uses a same-server
   redirect for the ga4 beacon URL so the host in `req.host` is
   `www.google-analytics.com` even though the response comes from localhost (this
   requires a reverse-proxy entry in `serve.mjs`, or simply skip request-host
   fixture coverage and rely on unit tests in F2).

3. **Add a second golden file** `e2e/expected-detection-config.json` for the
   detection path, driven by `fixtures/detection/mixed-signals.html`. Enforce
   golden regeneration in the PR checklist for DB changes.

4. **Cross-check `service-fingerprints.json` vs `db.ts`** in a Vitest test to
   prevent drift as the DB grows beyond v4's 50 services.

5. **Maintain `retries: 0`** and `workers: 2` on CI. Do not add new Playwright
   jobs for detection — fold the new detection tests into the existing `e2e` job
   in `pr.yml`.

---

## Open questions for the user

1. Should `fixtures/service-fingerprints.json` become the *authoritative source*
   for stub metadata (replacing the parallel definition in `db.ts`), or stay as a
   test-only descriptor? If authoritative, a build-time validation step is
   warranted.

2. For the ~30 curated services that will be added to reach ~50, should each have
   a corresponding `stubCookies` entry in `service-fingerprints.json` (enabling
   automatic fixture page generation), or is the data-driven Vitest table
   (F2/Recommendation 1) sufficient?

3. Is the acceptable CI runtime per PR still under 10 minutes? The current
   Playwright jobs take 2–3 min each; adding detection fixture crawls could push
   the `e2e` job to 4–5 min.

---

## Out of scope

- Browser-mode (Vitest browser) tests for the signature DB — the DB is pure Node
  logic and does not interact with the DOM.
- Testing the OCD-generated 439 services exhaustively — they are generated data
  and covered by schema validation + the existing Cloudflare smoke test.
- Real-network acceptance testing — per [goals.md §Acceptance bar] this remains a
  manual dogfood step against the author's real site.
- v5 runtime auto-block testing — explicitly deferred [goals.md §"deferred to
  later versions"].
