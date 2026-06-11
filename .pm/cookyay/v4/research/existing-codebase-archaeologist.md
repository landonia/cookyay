# Existing-codebase-archaeologist — Research findings

## Summary

- **The ~50-service signature database already ships in v3.** `db.ts` contains 20 hand-curated services and imports 439 more from `db-ocd.generated.ts` (Open Cookie Database, Apache-2.0). The classifier already performs detection on cookies, request hosts, localStorage keys, scripts (by host), and iframes (by host). v4's "bundled ~50-service signature database" and "detection/classification pass" are **already implemented** — the main gap is that the emitter (`config-emitter.ts`) does not yet emit standalone `script`/`iframe` *blocking declarations* for services identified only via request-host or cookie match (it emits `EmittedService` service entries without script `src` or iframe `src` attributes).
- **The banner contract is a plain JSON object** (`CookyayConfig` in `packages/cookyay/src/config.ts`): `{ policyVersion, categories: { analytics/marketing/functional/necessary: { label?, services: [{ name, cookies?, localStorage? }] } } }`. There is no `script`/`iframe` blocking field at the config level — blocking operates via `data-category` attributes in HTML markup, not via config. v4 cannot "emit ready-to-block script/iframe declarations" as config fields consumed by the banner without changing the banner contract.
- **The `toCookyayConfig()` helper strips `_meta` and scanner-only fields** before the config is passed to `Cookyay.init()`, and the E2E round-trip test already validates that generated configs block/unblock declared stubs. The integration point for v4 is extending `EmittedService` to carry suggested `scriptSrc`/`iframeSrc` blocking hints that site owners can apply to their HTML.
- **Test conventions are clear and well-established**: unit tests via Vitest (node env, no fixtures server), E2E via Playwright with a golden-file check (`e2e/expected-config.json`) that byte-compares normalized output. Adding services or detection signal requires updating the golden file.

---

## Findings

**1. Signature database is ~459 services, not ~50 [goals.md §What ships in v4, prd.md §7]**
`db.ts:67–304` defines 20 curated services; `db-ocd.generated.ts` adds 439 OCD-sourced services (6,633 lines). The curated entries cover exactly the top-20 named in the goals (GA4, Meta Pixel, YouTube, Hotjar, etc.) with cookies + requestHosts + localStorage. The OCD entries have cookies only (no requestHosts). v4's stated goal of "~50 services" is already exceeded by the existing v3 database.

**2. Detection pass already runs for all five signal types [prd.md §3.6]**
`classifier.ts:122–313` iterates every page's cookies, storage, requests, scripts, and iframes. Cookies hit `findServiceByCookie()`, third-party request hosts hit `findServiceByHost()`, localStorage keys hit `findServiceByLocalStorage()`, and script/iframe URLs have their hostname extracted for `findServiceByHost()`. First-party requests are explicitly skipped (`req.firstParty`). Unknown artifacts are never dropped — they land in `unclassified` with a review note.

**3. Confidence levels are already annotated [prd.md §3.6]**
`db.ts:337`: curated cookie match → `'high'`; OCD cookie match or any host match → `'medium'`. Each `EmittedService` in the output carries `_meta.confidence` + `_meta.matchedBy` + `_meta.serviceId`. The `matchedBy` enum is `'cookie' | 'request-host' | 'localStorage' | 'script-host' | 'iframe-host' | 'declared-category'` (`config-emitter.ts:33`).

**4. The banner does NOT consume script/iframe src from config [goals.md §The banner stays declarative]**
`CookyayConfig` (`packages/cookyay/src/config.ts:114`) has no `scriptSrc` or `iframeSrc` field. The declarative blocking (`blocking.ts`) is entirely markup-driven: `type="text/plain"` scripts and `data-src` iframes. The scanner's `EmittedService` already lists cookie names but has no way to communicate to the banner "block the script at URL X" — the banner has no such mechanism [prd.md Amendment 2026-06-06: blocking stays declarative in v1].

**5. The emitter does not yet produce per-service HTML snippets [goals.md §Emit pre-classified blocking declarations]**
`config-emitter.ts:26–86` defines `EmittedService` with `name`, `cookies[]`, `localStorage[]`, and `_meta`. There is no `suggestedScriptBlocking` or `suggestedIframeBlocking` field. For v4, site owners still need to manually add `type="text/plain" data-category="..."` to their HTML — the scanner only shows *which* services were detected and in which category, not *how* to block them in markup.

**6. `fixtures/service-fingerprints.json` mirrors the curated DB [goals.md §Acceptance bar]**
`fixtures/service-fingerprints.json` defines the same 20 services as `db.ts:67–296` with matching ids, categories, and cookie names. Fixture stub scripts only exist for `ga4` (`stubs/ga4.js`), `meta-pixel` (`stubs/pixel.js`), and `youtube` (`stubs/ytplayer.html`). Any new fixture scenarios for v4 detection testing must add stubs here and update the golden file at `e2e/expected-config.json`.

**7. Golden file test is the tightest contract [goals.md §Acceptance bar]**
`e2e/scanner-classify.spec.ts:54–69` does a byte-stable comparison against `e2e/expected-config.json` after normalizing the scannedAt timestamp and fixture base URL. Any change to detection logic, service IDs, confidence rules, or field names will break this test — it must be regenerated deliberately.

**8. TypeScript strict mode + ESM conventions [architecture.md §10]**
`tsconfig.base.json` sets `"strict": true`, `"verbatimModuleSyntax": true`. All imports use `.js` extensions (e.g. `import ... from './db.js'`). The `prebuild` script runs `ingest-ocd.mjs --offline` to regenerate `db-ocd.generated.ts` from cache before every build — contributors must run this or have a cached CSV; CI runs with the committed generated file.

**9. `findServiceByHost()` uses exact/subdomain match only — no substring [db.ts:351–373]**
The host-match logic is strict: `host === h || host.endsWith('.' + h)`. A prior substring-match bug admitted false positives (e.g. `t.co` in requestHosts matched `react.com`); regression tests cover this at `classifier.test.ts:119–135`. Any new requestHosts added for v4 must follow this same pattern and have regression coverage.

**10. Scanner package has no runtime dependency on `cookyay` package [config-emitter.ts:7–10]**
The scanner intentionally avoids importing from `packages/cookyay` to prevent circular deps and keep the scanner bundle clean. The `CookyayReadyConfig` interface in `config-emitter.ts:380` is a local re-statement of the shape, not an import. Any v4 extensions to `EmittedConfig` must remain self-contained in the scanner package.

---

## Gotchas

- **The golden file will break on any emitter or DB change.** Regenerate it with an intentional crawl of `all.html` after changes; check it in as a deliberate artifact update, not an accidental diff.
- **`prebuild` runs `ingest-ocd.mjs --offline`** — the `--offline` flag means CI uses the committed `db-ocd.generated.ts` file. Fresh OCD data requires deleting `.ocd-cache.csv` and running without `--offline`; the generated file must then be committed. If v4 adds a separate hand-curated signatures file, a similar `prebuild` step or commit convention is needed.
- **The emitted `EmittedService.cookies` field uses wildcard notation** for patterns (e.g. `_ga_*`) but `CookyayConfig.ServiceDeclaration.cookies` expects plain string names — `toCookyayConfig()` passes them through as-is (`config-emitter.ts:254,299`). The banner's cookie-clearing logic must be able to handle `*`-suffix strings, or v4 should normalize them before emission.
- **Host-only matches (e.g. a GA4 network request with no `_ga` cookie yet) produce a `medium`-confidence `EmittedService` with zero cookies listed.** The emitter still emits such entries (via the requests path, `config-emitter.ts:193–215`), which is correct behaviour but may confuse site owners who see a service entry with an empty `cookies` array.
- **The blocking fixture stubs are local paths** (`/fixtures/stubs/ga4.js`), not real CDN URLs. v4 detection tests that match by `requestHosts` (e.g. `googletagmanager.com`) cannot use the existing fixture stubs — new fixture HTML pages that load from synthetic hostnames (or use Playwright route interception) would be needed to exercise the request-host detection path in E2E tests.

---

## Recommendations

1. **Clarify the exact v4 deliverable before implementation.** The detection/classification pipeline is already complete (v3 ships it). The actual gap is: (a) the emitter does not surface *suggested blocking markup snippets* (`type="text/plain" data-category="..."`) alongside service entries, and (b) the fixture/test coverage for host-detected services (non-cookie path) is thin. Decide whether v4 adds suggested-markup output to `EmittedConfig` or stops at the existing service-entry emission.

2. **Add `suggestedScriptBlocking` and `suggestedIframeBlocking` arrays to `EmittedService` [goals.md §Emit pre-classified blocking declarations].** For each service detected via `script-host` or `iframe-host`, include the exact `<script type="text/plain" ...>` or `<iframe data-src="...">` snippet the site owner should add. This is purely additive to the existing `EmittedService` shape and does not touch the banner contract.

3. **Add a fixture HTML page that loads real external-looking scripts** (or uses Playwright `page.route()`) to exercise the request-host → service match path end-to-end. The current fixture (`all.html`) only tests the `declared-category` path. A new fixture with GA4/Meta Pixel CDN patterns mocked via route interception would provide coverage for the primary v4 detection mode.

4. **Bump `CLASSIFIER_VERSION` in `config-emitter.ts:88`** when the detection logic changes. The `_scanMeta.classifierVersion` field exists precisely for this; the E2E test asserts its value and will catch accidental omission.

5. **Do not add `requestHosts` entries that are short common tokens** (e.g. `co`, `io`). The regression tests at `classifier.test.ts:119–135` enforce this. Review all new `requestHosts` additions in db.ts for false-positive risk against the strict subdomain-match rule.

---

## Open questions for the user

1. **Does v4 need to emit HTML markup snippets, or is emitting service entries (with confidence + category) sufficient?** The goals say "ready-to-block script/iframe declarations" but the banner has no config-driven blocking — site owners must still edit HTML. Should `EmittedConfig` grow a `suggestedMarkup` field per service, or is the review-and-edit workflow acceptable?

2. **Should the ~50-service curated database grow beyond its current 20 entries for v4?** `db.ts` currently has exactly 20 curated entries; the 439 OCD entries cover the rest. If the v4 goal is specifically 50 curated (with requestHosts), approximately 30 more need to be hand-authored.

3. **Should the `fixtures/service-fingerprints.json` remain the fixture-coordination source of truth?** It currently mirrors the curated DB but is not programmatically generated from it. A drift risk exists if db.ts is extended without updating service-fingerprints.json.

---

## Out of scope

- **Banner runtime contract and `blocking.ts`** — v4 is scanner-side only; the banner blocking engine is explicitly unchanged [goals.md §The banner stays declarative].
- **`packages/cookyay/src/`** other than `config.ts` — the config shape is the only banner-side contract the scanner must satisfy; UI, GPC, Consent Mode internals are irrelevant to v4.
- **`db-ocd.generated.ts` content audit** — with 439 services across 6,633 lines, a full accuracy review is out of scope for this pass; the ingestion script and category mapping are correct and Apache-2.0 compatible.

## Update — 2026-06-10 (user resolutions)

- **Q1 (emit markup) → YES, emit copy-paste block markup.** v4's emitted config
  must produce ready-to-paste `type="text/plain" data-category="…"` snippets per
  detected service, not just annotated entries. This makes the emitter + a new
  DB script/iframe-URL field the bulk of v4's new work.
- **Q2 (grow curated set) → YES, reach ~50 curated services with `requestHosts`**
  (~30 to author), and add **path-level matching** (a `requestPaths` field).
- **Q3 (fixture source of truth)** deferred to `/pm:architect` / `/pm:plan` — the
  drift risk between `service-fingerprints.json` and the DB is real; prefer
  generating one from the other (see data-modeler + test-strategist).
