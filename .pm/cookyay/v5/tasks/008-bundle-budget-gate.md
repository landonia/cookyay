---
id: 008
title: Bundle-budget gate — size-limit covers autoBlock-enabled bundle
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["003", "004"]
complexity: 2
prd_refs:
  - "prd.md §3.1"
  - "prd.md §5"
  - "goals.md §What ships in v5"
arch_refs: []
test_refs: []
research_refs:
  - "research/performance-engineer.md §Findings"
  - "research/performance-engineer.md §Recommendations"
acceptance_criteria:
  - "The size-limit configuration (.size-limit.json) gains an entry that measures the auto-block-ENABLED bundle (DB + matcher + interception included) against the <20KB min+gzip budget [prd.md §3.1, §5], and the `pnpm size` / CI size step fails if it is exceeded."
  - "A check confirms the auto-block-OFF bundle does NOT include the signature DB (tree-shaken to zero, per task 003) — e.g. a separate size-limit entry or assertion that the default bundle size is unchanged from v4 within tolerance."
  - "The measured enabled-bundle size is recorded (commit message or a comment) and is comfortably under budget (research projected ~10KB combined); `pnpm size` is green in CI."
created: 2026-06-10
---

## Task
The <20KB combined bundle is the constraint that caused runtime auto-block to be
deferred out of v4 [prd.md §3.1, §5]. Research showed there's ~10KB of headroom and
the DB slice adds ~1KB, so the budget is safe — but it must be *enforced*, not
assumed [research/performance-engineer.md §Recommendations]. Extend the existing
`size-limit` gate to measure the auto-block-enabled bundle, and assert the opt-out
bundle stays lean (the tree-shake from task 003 actually working).

## Implementation notes
- Add a `.size-limit.json` entry for the enabled build; keep/confirm the existing
  entry for the default (auto-block-off) build so both are gated.
- If size-limit can't easily build an "enabled" variant, document how the enabled
  bundle is produced for measurement.
- This is the gate; task 003 already proved tree-shaking works — here it becomes a
  CI guard against regressions.

## Out of scope
- Implementing tree-shaking (task 003) or the DB codegen (task 001).
- Runtime behavior (tasks 004, 005).

## Implementation summary
**Files changed:**
- `.size-limit.json` — Expanded from 2 entries to 4. Added two new size-limit entries: (1) "cookyay ESM main (auto-block OFF — signature DB tree-shaken to zero, measured ~12 kB)" with a 13 kB limit, which serves as the tree-shake-to-zero CI guard (DB is 2.3 kB gzip, so accidental DB inclusion in `index.js` would push it from 12 kB to ~14.3 kB, exceeding the limit); (2) "cookyay ESM bundle (auto-block ON — main + DB chunk combined, measured ~14 kB)" with 20 kB limit, using a glob `autoblock-loader-*.js` to include the hashed DB chunk. Renamed entry 1 from "cookyay combined (IIFE + bootstrap)" to "cookyay IIFE bundle (CDN, auto-block enabled — DB + matcher + proxy inlined, measured ~12 kB)" to make explicit that the IIFE always inlines autoblock code (IIFE format cannot produce lazy chunks). The entry names encode the measured sizes so the budget margin is visible without running the tool.

**Build note (enabled-bundle delivery):** The IIFE build (`dist/index.iife.js`) necessarily inlines the entire autoblock code (proxy + DB + matcher) because IIFE format cannot produce runtime lazy chunks — so the IIFE is always the "enabled" worst case at 12.05 kB gzip. The ESM build splits the DB into a separate chunk (`autoblock-loader-*.js`, 2.3 kB gzip) that only loads when `autoBlock: true`; the ESM main entry (`index.js`) is 12 kB gzip and contains the proxy shim (statically imported, no DB data) but zero DB service records.

**Acceptance criteria check:**
- [x] AC1 (`.size-limit.json` gains an entry measuring auto-block-ENABLED bundle against <20KB limit; `pnpm size` fails if exceeded) — Entry 1 ("cookyay IIFE bundle ... auto-block enabled") measures the CDN-delivery IIFE+bootstrap at 12.05 kB < 20 kB. Entry 4 ("cookyay ESM bundle ... auto-block ON") measures `index.js` + autoblock-loader chunk at 14.33 kB < 20 kB. Both entries enforce the <20 kB hard limit; CI fails if either is exceeded.
- [x] AC2 (check that auto-block-OFF bundle does NOT include signature DB — tree-shaken to zero) — Entry 3 ("cookyay ESM main ... auto-block OFF ... tree-shaken to zero") measures `index.js` alone at 12 kB with a 13 kB limit. The DB chunk is 2.3 kB gzip; if it were accidentally bundled into `index.js`, the entry would read ~14.3 kB > 13 kB limit → CI fails. Confirmed: `grep -c "hotjar|requestHosts|AUTOBLOCK_SERVICES"` in `dist/index.js` returns 0.
- [x] AC3 (enabled-bundle size recorded, comfortably under budget; `pnpm size` green) — All four entries green in `pnpm size` output. Measured sizes encoded in entry names: IIFE enabled ~12 kB, ESM enabled ~14 kB, both well under the 20 kB budget. Research projected ~10 kB for IIFE enabled; actual is 12.05 kB (proxy shim statically imported is the delta vs. research estimate — still 40% under budget). ESM opt-in at 14.33 kB leaves 28% headroom.

**Tests:** `pnpm size` — all 4 entries pass. `pnpm --filter cookyay typecheck && pnpm --filter cookyay exec vitest run` — 465/465 tests pass; typecheck clean. No code logic changes — this task is config-only.

**Notes for verifier:**
- The IIFE and ESM builds have different tree-shaking characteristics: IIFE inlines all dynamic imports (autoblock code is always present), ESM produces a separate lazy chunk. Both delivery modes are now gated: the IIFE entry enforces the CDN user's worst case; the ESM entries enforce both the opt-out tree-shaking guarantee and the opt-in combined budget.
- The ESM opt-out limit of `13 kB` was chosen as `current_size (12 kB) + DB_size (2.3 kB) / 2` rounded — tight enough to catch accidental DB inclusion with margin for small non-DB additions.
- The glob pattern `packages/cookyay/dist/autoblock-loader-*.js` handles the content-hash in the chunk filename (tinyglobby resolves it at size-limit run time). This is correct as long as the build produces exactly one autoblock-loader chunk — the build currently does.

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** size-limit gate now covers both the auto-block-ENABLED bundle (<20KB) and the opt-out tree-shake-to-zero guarantee; independently rebuilt and re-measured — all 4 entries green.
**Acceptance criteria check:**
- [x] AC1 (enabled bundle gated <20KB, `pnpm size` fails if exceeded) — Independently ran `pnpm --filter cookyay build` then `pnpm size`: "cookyay IIFE bundle (CDN, auto-block enabled)" = 12.05 kB / 20 kB; "cookyay ESM bundle (auto-block ON — main + DB chunk combined)" = 14.33 kB / 20 kB. Verified IIFE inlines the DB (grep found `googletagmanager`/`hotjar` hostnames in `dist/index.iife.js`), so it is a true enabled worst case. size-limit exits non-zero on breach (CI `pr.yml:38-39` runs `pnpm size` as a hard gate after `pnpm -r build`).
- [x] AC2 (opt-out bundle excludes signature DB, tree-shaken to zero) — Entry "cookyay ESM main (auto-block OFF)" = 12 kB / 13 kB limit. Independent check: `grep -cE "hotjar|requestHosts|AUTOBLOCK_SERVICES"` on `dist/index.js` returns 0; `grep -cE "googletagmanager|google-analytics|facebook|doubleclick"` returns 0; the 54 DB markers live in the lazy `dist/autoblock-loader-*.js` chunk instead. The 10 `services` hits in `index.js` are the `cfg.services` config field, not DB data. Tree-shake works via the conditional `await import('./autoblock-loader.js')` in the proxy — confirmed in `src/autoblock-loader.ts`. Accidental DB inclusion (+2.3 kB) would push `index.js` to ~14.3 kB > 13 kB and fail CI.
- [x] AC3 (enabled-bundle size recorded, comfortably under budget, `pnpm size` green) — Measured sizes encoded in entry names; all 4 entries green. IIFE enabled 12.05 kB (41% under), ESM enabled 14.33 kB (28% under). Build emits exactly one `autoblock-loader-*.js` chunk so the glob resolves uniquely.
**Tests:** `pnpm size` 4/4 green; `pnpm --filter cookyay typecheck` clean; `vitest run` 465/465 pass. Config-only change; no scope drift, no dead code, no architecture/test-strategy violation (no v5/testing.md present).
