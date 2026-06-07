---
id: "017"
title: npm packaging + Changesets release flow
status: in-progress
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["009", "010", "011"]
prd_refs:
  - "prd.md §3.7"
arch_refs:
  - "architecture.md §7 Identity & auth (OIDC publish)"
  - "architecture.md §9 Environments & deployment"
research_refs:
  - "research/integration-engineer.md §Recommendations 6, 8"
acceptance_criteria:
  - "Changesets configured for the monorepo; version PR flow produces tags; GitHub Actions publishes both packages to npm with provenance via OIDC (no long-lived tokens)"
  - "Published cookyay package loads correctly three ways: ESM import from a bundler, jsDelivr IIFE script tag, and jsDelivr /+esm — verified against a real publish (a 0.x or dist-tag release counts)"
  - "publint and attw pass on the published artifacts; the IIFE build exposes window.Cookyay; SRI integrity attributes documented with a pinned minor-version jsDelivr URL"
  - "Combined published artifacts remain under the 20KB min+gzip gate; bootstrap under 1KB"
created: 2026-06-06
---

## Task
Make distribution real: Changesets release flow, provenance-attested npm publishes for `cookyay` and `@cookyay/scanner`, and verification that the CDN consumption paths (the whole §3.7 promise) actually work against a live publish.

## Implementation notes
- First publish can be 0.1.0 under a `next` dist-tag to validate the pipeline before any announcement.
- README CDN examples: pin to minor version tag, never @latest (integration rec 6).

## Out of scope
Docs site content (018), the comparison page (019), GitHub Pages deploy.

## Re-execution notes — 2026-06-07

**Addressed from Verifier notes:**

1. **Verifier point 2 (NPM_TOKEN / OIDC fix):** Removed `NPM_TOKEN` and `NODE_AUTH_TOKEN` env vars entirely from `.github/workflows/release.yml`. Added an explicit `npm install -g npm@latest` step to ensure npm ≥ 11.5.1 (required for OIDC Trusted Publishing) is available on the `ubuntu-latest` runner (Node 20 ships npm 10.x which predates OIDC TP support). Auth is now purely `id-token: write` OIDC — no long-lived secrets.

2. **Verifier point 3 (README false claim):** The "Release flow" section previously stated "no long-lived npm tokens stored in CI" which was false given the prior `NPM_TOKEN` usage. Updated `README.md` to be accurate now that the workflow is token-free, and added step-by-step instructions for configuring the npm OIDC Trusted Publisher on npmjs.com for both packages (a one-time human action required before the first publish).

**Remaining as human-action blockers (see ## Blocker below):**

- Verifier point 1 (AC2 real publish) and verifier point 4 (AC1 "version PR produces tags") both require npm credentials and a GitHub-hosted repo with commits — neither is available to the automated executor. These are surfaced as blockers.

## Blocker

Two acceptance criteria sub-requirements cannot be satisfied by an automated executor and require human action:

**Blocker 1 — npm publish requires credentials (AC2)**

`npm view cookyay` and `npm view @cookyay/scanner` both return E404; the packages have never been published. The executor is not logged in to npm (`npm whoami` returns ENEEDAUTH). Completing AC2 requires a human to:

1. Register OIDC Trusted Publisher on npmjs.com for `cookyay` and `@cookyay/scanner` (Settings → Trusted Publishers → repo: `cookyay`, workflow: `release.yml`) — this is a one-time web UI action.
2. Push the repository to GitHub (currently no commits and no remote configured).
3. Add a changeset (`pnpm changeset`), commit, and push to `main`.
4. Merge the resulting "Version Packages" PR to trigger the publish via the release workflow.
5. After publish succeeds, verify all three load paths against the live `0.1.0` artifacts:
   - **Bundler ESM:** `import { init } from 'cookyay'` in a local vite/rollup build
   - **IIFE script tag:** `https://cdn.jsdelivr.net/npm/cookyay@0.1/dist/index.iife.js` — confirm `window.Cookyay` exists
   - **jsDelivr /+esm:** `import Cookyay from 'https://cdn.jsdelivr.net/npm/cookyay@0.1/+esm'` — confirm `Cookyay.init` is callable
6. Replace `sha384-REPLACE_WITH_SRI_FROM_JSDELIVR` in README.md with the actual SRI hash from `https://data.jsdelivr.com/v1/packages/npm/cookyay@0.1.0/integrity`.

**Blocker 2 — "version PR flow produces tags" requires a live GitHub run (AC1)**

The git repository has no commits and no remote. The Changesets GitHub Action has never run and no "Version Packages" PR or tag has ever been produced. Verifying this sub-criterion of AC1 requires completing Blocker 1 steps 2–4 above, then citing the Actions run URL as evidence.

**What is already done:**
- `.github/workflows/release.yml` is correctly wired for OIDC Trusted Publishing (no NPM_TOKEN; `id-token: write`; npm upgrade step for ≥ 11.5.1 support).
- `README.md` accurately documents the Trusted Publisher setup process.
- All local quality gates pass: 339/339 tests, publint exit 0 on both packages, attw clean, combined 9.2 kB gzipped (< 20 kB), bootstrap 493 B (< 1 kB).

## Implementation summary

**Files changed (this execution):**
- `.github/workflows/release.yml` — Removed `NPM_TOKEN` and `NODE_AUTH_TOKEN` env vars; added `npm install -g npm@latest` step to ensure npm ≥ 11.5.1 (OIDC Trusted Publishing requires ≥ 11.5.1; Node 20 ships npm 10.x); workflow now authenticates purely via OIDC (`id-token: write`), matching architecture.md §7 "no long-lived npm tokens"
- `README.md` — Updated "Release flow" section: the false claim "no long-lived npm tokens stored in CI" is now accurate (it is true); added step-by-step instructions for registering npm OIDC Trusted Publisher on npmjs.com for both packages (required before first publish); SRI placeholder retained pending actual publish

**Files changed (prior execution, still in place):**
- `.changeset/config.json` — Changesets initialised; `access: "public"`; `baseBranch: "main"`
- `package.json` (root) — `@changesets/cli` in devDependencies; `changeset`, `version`, `release` scripts
- `packages/cookyay/package.json` — `"sideEffects": true`; `"publishConfig": { "provenance": true }`
- `packages/scanner/package.json` — `"publishConfig": { "provenance": true }`

**Acceptance criteria check:**
- [ ] Changesets configured for the monorepo; version PR flow produces tags; GitHub Actions publishes both packages to npm with provenance via OIDC (no long-lived tokens) — PARTIAL: `.changeset/config.json` and `.github/workflows/release.yml` are correctly wired (no NPM_TOKEN; `id-token: write`; npm ≥ 11.5.1); long-lived token removed. However "version PR produces tags" cannot be verified without a live GitHub run — see Blocker 2.
- [ ] Published cookyay package loads correctly three ways: ESM import from a bundler, jsDelivr IIFE script tag, and jsDelivr /+esm — verified against a real publish — BLOCKED: packages are unpublished (404 on npm); human npm credentials required — see Blocker 1.
- [x] publint and attw pass on the published artifacts; the IIFE build exposes window.Cookyay; SRI integrity attributes documented with a pinned minor-version jsDelivr URL — `publint` exits 0 on both packages; `attw --pack --ignore-rules cjs-resolves-to-esm` exits 0 on both; IIFE assigns top-level `var Cookyay = (()=>{...})()` (= `window.Cookyay` in browser); README documents `@0.1` pinned jsDelivr URL with SRI placeholder and Trusted Publisher setup
- [x] Combined published artifacts remain under the 20KB min+gzip gate; bootstrap under 1KB — combined 9.2 kB gzipped (limit 20 kB); bootstrap 493 B (limit 1 kB) confirmed by `pnpm size`

**Tests:** `pnpm test` — 339 tests, all passing

**Notes for verifier:**
- The release.yml NPM_TOKEN issue from the prior rejection is resolved — the workflow now contains no long-lived token references at all.
- AC2 and the "version PR produces tags" half of AC1 are genuine human-action blockers requiring npm credentials and a live GitHub repo. These are documented in ## Blocker above with exact steps for the human to take.
- All local quality gates (tests, publint, attw, size) pass and are unchanged from the prior execution.

## Verifier notes — 2026-06-07 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Local quality gates all pass, but AC2's explicitly required real publish never happened (both packages 404 on npm), and the release workflow authenticates with a long-lived `NPM_TOKEN` secret, contradicting AC1's "via OIDC (no long-lived tokens)" and architecture.md §7.

**What needs to change:**
1. **Do the real publish (AC2).** `npm view cookyay` and `npm view @cookyay/scanner` both return E404 — nothing has ever been published. The criterion says "verified against a real publish (a 0.x or dist-tag release counts)" and the implementation notes pre-authorized a low-risk `0.1.0` + `next` dist-tag publish. Either: (a) publish via `pnpm changeset publish --tag next` (requires npm auth) or by pushing the repo to GitHub and exercising the release workflow, then verify all three load paths against the live artifacts — bundler ESM import, `https://cdn.jsdelivr.net/npm/cookyay@0.1/dist/index.iife.js` exposing `window.Cookyay`, and `.../npm/cookyay@0.1/+esm` — recording concrete evidence (URLs, observed behavior); or (b) if npm/GitHub credentials are unavailable to the executor, surface that as a human-action blocker and get the acceptance criterion amended via /pm:amend instead of checking the box. A checked criterion with a "Notes for verifier" caveat admitting it wasn't done is not acceptable.
2. **Make the publish actually token-less OIDC (AC1).** `.github/workflows/release.yml:50-51` injects `NPM_TOKEN: ${{ secrets.NPM_TOKEN }}` and `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` — that is a long-lived npm token stored in CI, which architecture.md §7 explicitly forbids ("no long-lived npm tokens"). `id-token: write` + `publishConfig.provenance: true` only gives provenance *attestation*; authentication here is still classic-token. Fix: configure npm Trusted Publishing for both packages (npmjs.com package settings → Trusted Publisher → this repo + `release.yml`), delete the two token env lines, and ensure the runner's npm CLI supports OIDC trusted publishing (≥ 11.5.1 — Node 20 bundles npm 10.x, so add an `npm install -g npm@latest` step or move to a newer Node). If token auth is intentionally retained as a pragmatic fallback, the architecture must be amended first — silent drift is not allowed.
3. **Fix the README claim to match reality.** `README.md` Release flow section states "no long-lived npm tokens stored in CI", which is currently false given release.yml. After fix 2 it becomes true; until then it is misleading documentation. Also, once a real publish exists, replace the `sha384-REPLACE_WITH_SRI_FROM_JSDELIVR` placeholders with the actual pinned hash (or keep the placeholder only if the publish is still pre-1.0 churn — but say so).
4. **Exercise (or honestly mark unverifiable) the "version PR flow produces tags" half of AC1.** The git repo has zero commits, so `release.yml` has never run and no Version Packages PR or tag has ever been produced. After pushing to GitHub, confirm the changesets action opens the version PR and tags on publish, and cite the run.

**Acceptance criteria check:**
- [ ] AC1 (Changesets + OIDC publish, no long-lived tokens) — PARTIAL: `.changeset/config.json` and `release.yml` exist and are sanely wired (`changesets/action@v1`, `pnpm release` builds before publish), but auth is via stored `NPM_TOKEN` secret (long-lived token — violates criterion text and architecture.md §7), and the tag-producing flow has never run (repo has no commits).
- [ ] AC2 (loads three ways, verified against a real publish) — FAIL: no publish exists; npm registry returns 404 for both `cookyay` and `@cookyay/scanner`; none of the three consumption paths were verified against live artifacts.
- [x] AC3 (publint/attw pass; IIFE exposes window.Cookyay; SRI documented) — PASS locally: `publint` exit 0 on both packages; `attw --pack --ignore-rules cjs-resolves-to-esm` clean on both; `dist/index.iife.js` assigns top-level `var Cookyay = (()=>{...})()`; README documents `@0.1`-pinned jsDelivr URL with `integrity` + `crossorigin` and the jsDelivr integrity API. (Note: "on the published artifacts" is only approximated via `--pack` until a real publish exists.)
- [x] AC4 (size gates) — PASS: `pnpm size` reports combined 9.2 kB gzipped (limit 20 kB) and bootstrap 493 B (limit 1 kB).

**Tests:** 339/339 passing (`pnpm test`, 11 files). publint/attw/size all green locally; pr.yml runs publint+attw+size in CI (research rec 8 satisfied).

**Notes for next executor:**
- Files to revisit: `.github/workflows/release.yml` (remove token env, npm ≥ 11.5.1 for trusted publishing), `README.md` (Release flow claim + SRI placeholders).
- The local artifact quality is solid — do not rework the packages' `package.json`, tsup outputs, or changeset config; the gap is purely the live-publish verification and the OIDC-vs-token mismatch.
- The release workflow publishes after only `pnpm -r build` (no tests/publint in the release job). Merge gating lives in pr.yml, which is acceptable, but consider adding `pnpm test` before `changeset publish` in the `release` script as cheap insurance (suggestion, not a reject reason).
- If publishing genuinely requires human npm credentials, the correct move is to report the blocker and amend AC2, not to self-certify it.
