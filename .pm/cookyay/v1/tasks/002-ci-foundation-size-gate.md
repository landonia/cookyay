---
id: "002"
title: CI foundation + size-limit gate
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001"]
prd_refs:
  - "goals.md §Acceptance bar"
  - "prd.md §5"
arch_refs:
  - "architecture.md §2 Scaling model"
  - "architecture.md §9 Environments & deployment"
research_refs:
  - "research/test-strategist.md §Recommendations 4, 6"
  - "research/performance-engineer.md §Recommendations 3"
acceptance_criteria:
  - "GitHub Actions workflow runs lint + typecheck + unit tests on every push"
  - "size-limit gate fails the build if the combined cookyay deliverables exceed 20KB min+gzip; warns at 17KB; bootstrap artifact has its own 1KB limit"
  - "Playwright browser install is cached keyed on the Playwright version"
  - "publint and @arethetypeswrong/cli run on PRs to main and pass for both packages"
created: 2026-06-06
---

## Task
Stand up the GitHub Actions pipeline per architecture.md §9 before any feature code lands: lint/typecheck/unit on push; size-limit, publint, and attw checks on PRs to main. The size budget must be enforced from the first commit — research is unanimous that retrofitting it later forces rewrites.

## Implementation notes
- Two size-limit entries: UI bundle (hard 20KB combined budget, 17KB warn via a soft-check step) and bootstrap (1KB).
- E2E job stub can be added now (runs on PRs to main, Chromium-only) and filled by task 013.
- Public repo → free unlimited Actions minutes; bottleneck is cache restore, not minutes.

## Out of scope
The E2E/a11y test content (013/014), release/publish workflow (017), docs deploy (018).

## Implementation summary
**Files changed:**
- `.github/workflows/ci.yml` — push CI: build + lint + typecheck + unit tests on every push; concurrency group cancels redundant runs
- `.github/workflows/pr.yml` — PR-only checks (3 jobs): `size-limit` (warn at 17KB via per-artifact gzip sum + hard gate via `pnpm size`), `publint-attw` (publint + attw on both packages), `e2e` (Playwright Chromium install with cache + stub run, filled by task 013)
- `.size-limit.json` — two entries: combined IIFE+bootstrap 20 kB hard limit with `"gzip": true`; bootstrap-only 1 kB hard limit with `"gzip": true`
- `package.json` (root) — added devDeps: `size-limit@^11.0.0`, `@size-limit/file@^11.0.0`, `publint@^0.3.0`, `@arethetypeswrong/cli@^0.18.0`; added `"size": "size-limit"` script
- `packages/cookyay/package.json` — added `"main": "./dist/index.js"` (fixes attw node10 resolution); moved `"types"` before `"import"` in exports map (required by publint — conditions are order-sensitive for TypeScript)
- `packages/scanner/package.json` — same two changes as cookyay

**Acceptance criteria check:**
- [x] GitHub Actions workflow runs lint + typecheck + unit tests on every push — `.github/workflows/ci.yml:11`: job `build-lint-test` on `on: push` (all branches) runs `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r build`, `pnpm test`
- [x] size-limit gate fails >20KB min+gzip combined, warns at 17KB, bootstrap 1KB — `.size-limit.json`: entry 1 path array `[index.iife.js, bootstrap.js]` limit 20kB `gzip: true`; entry 2 `bootstrap.js` limit 1kB `gzip: true`; `pr.yml` warns by summing per-file `gzip -9 -c … | wc -c` of both artifacts; `pnpm size` is the hard gate; output confirmed "gzipped" (not "brotlied")
- [x] Playwright install cached keyed on Playwright version — `pr.yml:89`: `actions/cache@v4` on `~/.cache/ms-playwright`, key `playwright-${{ runner.os }}-${{ steps.pw-ver.outputs.version }}` where version is read from `packages/scanner/package.json`
- [x] publint + attw on PRs to main, pass both packages — `pr.yml:39`: job `publint-attw` on `pull_request: branches: [main]`; independently verified: all four commands exit 0

**Tests:** `pnpm test` exit 0; `pnpm size` exit 0 (423B gzipped combined, 45B bootstrap gzipped)

**Notes for verifier:**
- `pnpm size` output now shows "gzipped" for both entries — verify this in the output, not "brotlied"
- `"gzip": true` is explicit in both `.size-limit.json` entries; `"brotli": false` is NOT used (that measures raw uncompressed size per verifier investigation)
- attw `--ignore-rules cjs-resolves-to-esm` is correct for ESM-only; architecture §10 "no CJS" is the documented justification
- The `"main"` field added to both packages resolves attw's node10 row; it points to the ESM file — there is no CJS artifact
- E2E stub `|| true` is still present (intentional stub; task 013 removes it when the real config lands — verifier's non-blocking note acknowledged)

## Re-execution notes — 2026-06-06

**Verifier gap 1 (gzip, not brotli):** Added `"gzip": true` to both entries in `.size-limit.json`. `@size-limit/file@11.2.0` defaults to brotli; `"gzip": true` switches to gzip and reports "X B gzipped" in output. Verified: `pnpm size` now shows "gzipped" for both entries. Correction to prior implementation's claim: brotli produces *smaller* output than gzip, so a brotli-measured gate is *looser* than a gzip gate for the same numeric limit — a bundle can be well over 20KB gzip while passing the brotli check. The gate is now gzip as specified.

**Verifier gap 2 (combined budget):** Changed the 20KB entry from `"path": "packages/cookyay/dist/index.iife.js"` (IIFE alone) to `"path": ["packages/cookyay/dist/index.iife.js", "packages/cookyay/dist/bootstrap.js"]` (combined). size-limit sums gzipped sizes of all files in a path array — verified locally.

**Verifier gap 3 (17KB warn step):** Updated the shell step in `pr.yml` to gzip both artifacts independently, sum the byte counts, and compare the total against 17 kB. Prior step only measured the IIFE.

## Verifier notes — 2026-06-06 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** The size gate does not enforce the acceptance criterion: it measures brotli (size-limit v11 default) against a 20KB limit, but the criterion and PRD budget are min+**gzip** — empirically demonstrated that a 33.3KB-gzipped file passes the current gate at 18.13KB brotlied. It also gates the IIFE alone, not the **combined** deliverables.
**What needs to change:**
1. **Gzip, not brotli.** `.size-limit.json` entries must add `"gzip": true`. Verified locally with `@size-limit/file@11.2.0`: default reports "brotlied"; `"gzip": true` reports "gzipped" and matches `gzip -9 | wc -c` byte-for-byte. Note: `"brotli": false` is NOT the fix — it measures the raw uncompressed size (verified: 91.19 kB for the same file).
2. **Combined budget.** The criterion (and prd.md Amendment 2026-06-06: "the <20KB budget applies to the combined deliverables") requires the 20KB limit to cover the combined deliverables, not the IIFE alone (current config admits 20KB IIFE + 1KB bootstrap = 21KB total). size-limit supports array paths in one entry — verified locally. Use: `"path": ["packages/cookyay/dist/index.iife.js", "packages/cookyay/dist/bootstrap.js"], "limit": "20 kB", "gzip": true`. Keep the separate bootstrap entry (1 kB, gzip: true).
3. **17KB warn step should measure the combined gzip total.** The shell warn in `pr.yml` currently gzips only `index.iife.js`. Sum both artifacts' gzipped sizes (e.g. `cat both | gzip` is wrong — gzip each separately and add the byte counts) and compare against 17408.
4. **Correct the false claim in the Implementation summary.** It states "brotli ≈ 80–85% of gzip size, so ... the brotli gate is marginally stricter" — this is inverted. Because brotli output is SMALLER, a 20KB-brotli limit is LOOSER than 20KB-gzip: bundles up to ~25KB gzipped would pass. The re-execution notes should state the corrected reasoning.
**Acceptance criteria check:**
- [x] GH Actions runs lint + typecheck + unit on every push — `ci.yml` `on: push` (all branches), steps run `pnpm -r lint` / `pnpm -r typecheck` / `pnpm -r build` / `pnpm test`; all four verified exit 0 locally
- [ ] size-limit gate fails >20KB min+gzip combined; warns 17KB; bootstrap 1KB — FAILS: gate measures brotli not gzip (demonstrated: 33,304-byte-gzip file passes at 18,125 bytes brotlied), and the 20KB entry covers only the IIFE, not combined deliverables
- [x] Playwright install cached keyed on Playwright version — `pr.yml` `e2e` job: `actions/cache@v4` on `~/.cache/ms-playwright`, key `playwright-${{ runner.os }}-${{ steps.pw-ver.outputs.version }}` read from scanner package.json, per research/test-strategist §Recommendations 6
- [x] publint + attw run on PRs to main and pass for both packages — `pr.yml` `publint-attw` job (on: pull_request → main); independently re-ran all four commands: exit 0. The `--ignore-rules cjs-resolves-to-esm` suppression is justified (ESM-only per architecture §10 "no CJS") and documented inline in the workflow
**Tests:** `pnpm test` exit 0; publint/attw exit 0 ×4; size gate logic FAILS spec (see above)
**Notes for next executor:** This is a config-only fix — touch `.size-limit.json` (add `"gzip": true` to both entries; make the 20KB entry's `path` an array of both artifacts) and the warn step in `.github/workflows/pr.yml` (sum per-file gzip sizes). Do not switch to `"brotli": false` (raw size). Re-verify with `pnpm size` (expect "gzipped" suffix in output, not "brotlied"). Everything else is green and verified — workflows, publint/attw wiring, Playwright cache, exports-map changes (`types` first, `main` added) are all correct; don't touch them. Non-blocking observations for later tasks: (a) the e2e stub's `|| true` must be removed in task 013 or real E2E failures will be masked; (b) the Playwright cache key uses the semver RANGE (`^1.50.0`) not the resolved version — consider keying on the lockfile-resolved version when 013 lands.

## Verifier notes — 2026-06-06 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** All four rejection points closed and independently re-proven — the gate now measures gzip (`"gzip": true`, output reads "gzipped"), the 20KB entry covers the combined deliverables via a path array (empirically verified: two distinct files summing to 26,115 bytes gzip fail the 20KB gate with exit 1), the 17KB warn step sums both artifacts' gzip sizes, and the inverted brotli claim is corrected in the re-execution notes.
**Acceptance criteria check:**
- [x] GH Actions runs lint + typecheck + unit on every push — `ci.yml` `on: push`, steps `pnpm -r lint`/`typecheck`/`build`/`test`; all re-run independently, exit 0
- [x] size-limit gate fails >20KB min+gzip combined; warns 17KB; bootstrap 1KB — `.size-limit.json` entry 1: path array `[index.iife.js, bootstrap.js]`, 20 kB, gzip: true; entry 2: bootstrap 1 kB, gzip: true. Proven to fail over-budget gzip content (26.11 kB gzipped → exit 1) and to sum distinct array paths byte-accurately (13,299 + 12,816 = 26,115). Warn step in `pr.yml:27-36` sums per-file `gzip -9` byte counts against 17408
- [x] Playwright install cached keyed on Playwright version — `pr.yml` e2e job, `actions/cache@v4` on `~/.cache/ms-playwright` keyed `playwright-${{ runner.os }}-${{ version from scanner package.json }}`
- [x] publint + attw on PRs to main, pass both packages — `pr.yml` `publint-attw` job on `pull_request → main`; all four commands independently re-run, exit 0; `cjs-resolves-to-esm` suppression documented inline and justified by architecture §10 (no CJS)
**Tests:** `pnpm test` exit 0; `pnpm size` exit 0 (423 B combined / 45 B bootstrap, both "gzipped"); publint ×2 and attw ×2 exit 0
