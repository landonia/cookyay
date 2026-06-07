# Test Strategist — Research findings

## Summary

- Script blocking and re-execution require a real browser (Playwright); jsdom does not execute scripts injected by DOM mutation, cannot honour `type="text/plain"` semantics, and its cookie/localStorage behaviour diverges from spec in ways that directly affect §3.2 and §3.5.
- The Consent Mode v2 integration can be tested cheaply with a stub `window.dataLayer` array and unit assertions — no real Google scripts needed — keeping that layer fast and deterministic [prd.md §3.4].
- The CLI scanner needs its own isolated test harness: a minimal static fixture site served locally (e.g. `serve` or a tiny Express file-server) with synthetic third-party script stubs, verified against golden-file JSON output [prd.md §3.6].
- A solo-OSS CI budget is sustainable with a two-tier matrix: unit/component tests run on every push in Node (fast, free minutes); Playwright E2E + accessibility + bundle-size gate run only on PRs targeting `main`, keeping Chromium install costs bounded [goals.md §Acceptance bar].

## Findings

1. **jsdom cannot test prior script blocking** — jsdom does not execute `<script>` tags inserted via `innerHTML` or `document.createElement` and appended to the DOM after initial parse. The `type="text/plain"` → `type="text/javascript"` swap trick that every CMP (Complianz, CookieBot, Cookyay) relies on to re-execute blocked scripts depends on the browser's native script loader. jsdom silently ignores these insertions. Any test of §3.2 grant/revoke/re-execute flow that runs under jsdom will pass vacuously. [prd.md §3.2]

2. **Cookie and localStorage persistence tests need a real browser** — jsdom's `document.cookie` implementation uses `tough-cookie` internally, but runtime cookie mutation has known divergence bugs (e.g. jsdom#1698, jsdom#3781 re: removal semantics). The consent record stored per §3.5 (timestamp, policy version, choices) must be read back correctly after a page reload — that reload semantics test is meaningless in jsdom. [prd.md §3.5]

3. **dataLayer/Consent Mode assertions are safe as unit tests** — The gtag Consent Mode v2 contract is purely a matter of what gets pushed onto `window.dataLayer` and in what order (default before any tag fires, update on banner interaction). A stub `window.dataLayer = []` + a thin `gtag` shim is sufficient to assert both the `"consent", "default"` and `"consent", "update"` push shapes. This keeps §3.4 tests fast and dependency-free — no real Google scripts, no network, no flake. [prd.md §3.4]

4. **The type="text/plain" block pattern needs a Playwright fixture page** — A minimal HTML fixture with a `<script type="text/plain" data-category="analytics">window.__analyticsRan = true</script>` block is the standard test vehicle. Before consent: assert `window.__analyticsRan` is undefined and the script node still has `type="text/plain"`. After simulated consent click: assert `window.__analyticsRan === true` and the node type has been swapped. Playwright's `page.evaluate()` makes these assertions trivial; jsdom cannot. [prd.md §3.2]

5. **CLI scanner tests need a hermetic fixture site** — Testing the headless-Chrome scanner against live third-party URLs (GA4, Meta Pixel, YouTube embeds) is a flake vector: CDN availability, script content drift, rate limiting. The correct pattern is a static fixture site with synthetic inline `<script>` and `<iframe>` stubs that mimic the fingerprints (cookie names, request patterns) of real services, served locally via `playwright.config.ts` `webServer`. Golden-file output (`expected-config.json`) is checked in to the repo and diff'd on each run. [prd.md §3.6]

6. **Network non-determinism is the primary CI flake risk** — Any test that lets real third-party scripts load (Google, Meta, YouTube) will eventually time out or 404 in CI. Playwright's `page.route()` intercept/abort pattern should be the default for all E2E tests: allow only requests to `localhost`, abort everything else. The scanner integration test is the one place where selective route mocking is needed to simulate third-party fingerprints without actually fetching them. [prd.md §3.6, goals.md §Acceptance bar]

7. **Bundle-size gate via `size-limit`** — `size-limit` (npm: `size-limit`, GitHub Action: `andresz1/size-limit-action`) is the standard solution: it bundles with esbuild/rollup, gzips the output, and fails the CI step if the result exceeds the configured threshold. One config entry targeting the banner entry point with `limit: "20 kB"` is sufficient. This posts a size delta comment on every PR, which is useful for a library author. [prd.md §3.1, goals.md §Acceptance bar]

8. **Accessibility: axe-core + Playwright keyboard-nav smoke test** — `@axe-core/playwright` runs axe against the rendered banner in a real browser and returns structured violations. Complement with a keyboard-nav script: Tab to the banner, assert focus is trapped inside the modal, Space/Enter toggles categories, Escape closes without accepting. These two together cover the §3.1 accessibility requirement at a CI-reasonable cost (~10–15 s per run). [prd.md §3.1, goals.md §Acceptance bar]

9. **Vitest browser mode as a middle tier** — Vitest's browser mode (Playwright provider, stable as of mid-2025) runs component-level tests in a real Chromium without the overhead of full Playwright test suites. It's 2–4× slower than jsdom per test but far cheaper than full E2E. Suitable for unit-testing the banner's TypeScript logic (state machine, category toggle, consent record serialisation) where real DOM APIs matter but full page navigation does not. [prd.md §3.1, §3.5]

10. **GPC signal testing** — Global Privacy Control (`navigator.globalPrivacyControl`) is a non-standard property not present in jsdom. Testing the GPC auto-opt-out branch of §3.3 requires either a Playwright test that injects the property via `page.addInitScript` or a unit test that stubs `navigator.globalPrivacyControl = true` via a Vitest browser-mode page context. [prd.md §3.3]

## Gotchas

- **Vitest jsdom mode will give false confidence for §3.2.** If the test suite is scaffolded with jsdom as the default environment and script-blocking tests are written there, they will pass unconditionally (the re-execute code path is never exercised). Enforce the Playwright provider for any test file that touches script injection.
- **Playwright Chromium install size (~300 MB) bloats CI caches.** Use `npx playwright install chromium --with-deps` (not `--all`) and cache `~/.cache/ms-playwright` keyed on the Playwright version in `package.json`. Omit Firefox/WebKit from the CI matrix for v1; the banner must work everywhere but the test suite does not need to prove it on every run.
- **Golden-file drift for the scanner.** The golden `expected-config.json` will need updating whenever the built-in service fingerprint database changes. Use `--update-snapshots` (Vitest) or a dedicated `update-golden` npm script; document this in `CONTRIBUTING.md`.
- **`size-limit` measures the entry-point bundle, not the full distributed package.** Make sure the `path` in the size-limit config points to the compiled/minified banner output, not to `src/`. If the build step isn't run before the size check, the gate will measure stale artefacts.
- **axe-core does not catch all keyboard-nav issues.** axe tests ARIA attribute correctness, not actual focus order or trap behaviour. The keyboard-nav Playwright script is not optional.

## Recommendations

1. **Adopt a three-tier test pyramid:**
   - *Unit (Vitest, jsdom environment):* pure logic — consent record serialisation, category-toggle state machine, dataLayer push shapes, GPC flag detection (stubbed). Fast, runs on every push.
   - *Component/integration (Vitest browser mode, Chromium):* banner rendering, cookie read/write round-trips, script node type mutation. Medium speed, runs on every push.
   - *E2E (Playwright, Chromium only):* script blocking + re-execution fixture page, CLI scanner integration, accessibility smoke test (axe + keyboard nav), bundle-size gate. Runs on PRs to `main` only.

2. **Write the script-blocking fixture page first.** It is the highest-risk, hardest-to-get-right piece of the library. Treat it as a living acceptance test; it should be the first thing a new contributor can run to understand the contract.

3. **Stub all third-party network in E2E via `page.route()`.** Default-deny external requests. Only the scanner integration test needs route mocks that simulate third-party cookie/request fingerprints.

4. **Wire `size-limit` into CI from day one** with `"limit": "20 kB"` and a warning threshold at 15 KB to give early feedback before the hard limit is hit.

5. **Create a small service-fingerprint fixture library** (a JSON file of synthetic cookie names + request URL patterns for the top ~20 services) that both the scanner unit tests and the E2E scanner test consume. This prevents the two test layers from diverging on what "GA4 detected" means.

6. **Cache Playwright Chromium aggressively.** On the GitHub Actions free tier (public repo = unlimited minutes), the bottleneck is cache restore time, not minutes. Key the cache on `playwright-version` from `package.json` to avoid unnecessary re-downloads.

## Open questions for the user

1. **Monorepo or two separate packages?** The banner (`cookyay`) and the CLI scanner (`cookyay-scanner`) have very different dependency profiles and test strategies. If they ship as one npm package, the test matrix is simpler; if separate, the CI pipeline splits. Which is intended?

2. **What's the target browser matrix for the banner?** Evergreen-only (Chrome/Firefox/Safari current)? IE11 support? This determines whether Vitest browser mode (Chromium only) is sufficient for component tests or whether cross-browser Playwright runs are needed.

3. **Will the scanner's headless Chrome be Playwright-managed (the library) or a separate Puppeteer dependency?** If Playwright is already in devDeps for testing, reusing it for the scanner avoids a duplicate Chromium install, simplifies CI caching, and halves the scanner package's install footprint.

4. **English-only v1 or i18n hooks?** [prd.md §7 open question] — affects whether accessibility tests need to run with different locale fixtures (screen-reader announcement content varies by language).

5. **Is the author's test site accessible to CI?** The acceptance bar says "CLI scanner run against one of the author's real sites" [goals.md §Acceptance bar]. That test cannot run in ephemeral CI without credentials/VPN or a committed fixture that approximates it. Should the CI gate use only the hermetic fixture, with the real-site test staying manual?

## Out of scope

- **Cross-browser E2E matrix (Firefox, WebKit):** Not investigated in depth. For a zero-dependency vanilla TS library the browser compatibility surface is narrow; the test-strategist brief is focused on CI cost for a solo project, where Chromium-only is the pragmatic starting point.
- **Visual regression testing:** No screenshot/pixel-diff tooling evaluated. Banner theming is a CSS-level concern; a PR author review of screenshots is sufficient for v1.
- **Load/performance testing of the banner:** Sub-millisecond consent-check path is relevant but belongs to a performance-profiling pass, not the test pyramid.
- **Consent log audit trail testing:** §4 explicitly defers server-side consent logging; no server-side test infrastructure is needed for v1.

## Update — 2026-06-06
User decisions: **monorepo with two packages** — `cookyay` (zero-dep banner) and `@cookyay/scanner` (**Playwright-based**, shared Chromium with the test suite). Browser matrix: **evergreen only** (Vitest browser mode Chromium-only is sufficient for component tier). CI uses the **hermetic fixture site**; the real-site scan stays a manual acceptance step.
