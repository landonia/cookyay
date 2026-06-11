---
id: 004
title: Add path-level (requestPaths) matching in classifier.ts
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["001"]
complexity: 3
prd_refs:
  - "prd.md §3.6"
  - "goals.md §What ships in v4"
arch_refs:
  - "architecture.md §Amendments 2026-06-10 — v4 architecture decisions (change 1)"
  - "architecture.md §Amendments 2026-06-10 — Open question for /pm:plan"
test_refs: []
research_refs:
  - "research/domain-expert-trackers.md §Findings"
  - "research/domain-expert-trackers.md §Update — 2026-06-10 (Q3)"
acceptance_criteria:
  - "classifier.ts honors the requestPaths field on ServiceDefinition: a service matches when an observed request URL matches both its host pattern (where given) and a requestPaths entry."
  - "Path matching distinguishes e.g. facebook.com/tr (Meta Pixel) and www.google.com/recaptcha/ (reCAPTCHA) from unrelated requests to the same host."
  - "A service with requestHosts but no requestPaths behaves exactly as today (no regression to existing 20 entries)."
  - "Vitest unit tests cover: path-match hit, path-mismatch miss on a shared host, and host-only fallback; classifier.test.ts patterns extended, all green."
created: 2026-06-10
---

## Task
Add path-granular matching so services that share a hostname with unrelated
traffic can be detected precisely [research/domain-expert-trackers.md Q3]. Several
high-value signatures — Meta Pixel's `facebook.com/tr` beacon, reCAPTCHA's
`www.google.com/recaptcha/` — are indistinguishable by host alone and are a source
of both misses and false positives. Implement `requestPaths` matching in
`classifier.ts` against the field added in 001.

## Implementation notes
- Resolve the architecture open question at execute time: prefer extending the
  existing host matcher to also test the URL path rather than a parallel matcher,
  if it keeps the code simple [architecture.md §Amendments — Open question].
- Decide and document path-match semantics (prefix vs glob) and keep it consistent
  with how `scriptUrlGlobs` are matched in 007.
- This unblocks the path-dependent fixes in 003 and the path-using services in 005.

## Out of scope
- Authoring the services that use requestPaths (005). Emitting block markup (007).

## Re-execution notes — 2026-06-10

**Verifier issues addressed:**

1. **Fixed match semantics to host-qualified AND.** Rewrote `findServiceByRequest` in `db.ts`. `requestPaths` entries are now `"host/path"` strings (e.g. `"facebook.com/tr"`, `"www.google.com/recaptcha/"`). The matching logic parses each entry into `entryHost` and `entryPath` at the first `/`, then requires: `host === entryHost || host.endsWith('.'+entryHost)` AND `pathname.startsWith(entryPath)`. Both conditions must hold simultaneously. `cdn.example.com/track.js` now returns null (was: meta-pixel). `other.com/recaptcha/foo` now returns null (was: recaptcha).

2. **Reconciled documentation.** `db.ts` JSDoc on `findServiceByRequest` now describes host-qualified AND semantics ("Both conditions must hold simultaneously"). `classifier.ts` comment (lines 198-201) already correctly implied AND semantics — the two are now consistent.

3. **reCAPTCHA `requestPaths` entry updated.** Changed from `["/recaptcha/"]` to `["www.google.com/recaptcha/"]` in both `data/services.yaml` and regenerated `db-curated.generated.ts`. The path is now anchored to `www.google.com` — `other.com/recaptcha/foo` does not match.

4. **Cross-host false-positive tests added.** Added 3 new tests to `findServiceByRequest` describe block:
   - `"does NOT match Meta Pixel for /tr path on an unrelated host"` — `cdn.example.com/track.js` → null
   - `"does NOT match Meta Pixel for /transactions path on an unrelated host"` — `cdn.example.com/transactions/list` → null
   - `"does NOT match reCAPTCHA for /recaptcha/ path on a non-Google host"` — `other.com/recaptcha/foo` → null

## Implementation summary
**Files changed:**
- `packages/scanner/src/db.ts` — Rewrote `findServiceByRequest` with host-qualified path matching. `requestPaths` entries are now `"host/path"` strings; the matcher parses each entry and requires both host (exact or subdomain) and pathname prefix to match. Updated `ServiceDefinition.requestPaths` JSDoc to document the new format and semantics. `findServiceByHost` unchanged.
- `packages/scanner/data/services.yaml` — Updated `meta-pixel` `requestPaths` from `[/tr]` to `[facebook.com/tr]`; updated `recaptcha` `requestPaths` from `[/recaptcha/]` to `[www.google.com/recaptcha/]`. Updated schema comment to document the `host/path` format. Updated authoring comment on `meta-pixel` entry.
- `packages/scanner/src/db-curated.generated.ts` — Regenerated via `node scripts/build-services-db.mjs`; `requestPaths` values now use `host/path` format.
- `packages/scanner/src/classifier.test.ts` — Added 3 cross-host false-positive guard tests to `findServiceByRequest` describe block; updated test description for the same-host path-mismatch test to clarify scope.

**Acceptance criteria check:**
- [x] classifier.ts honors requestPaths matching BOTH host and path — `findServiceByRequest` splits each `requestPaths` entry into host+path components and requires both; `db.ts` lines ~229-237
- [x] Path matching distinguishes `facebook.com/tr` (Meta Pixel) and `www.google.com/recaptcha/` (reCAPTCHA) from unrelated requests to the SAME host — tests: "does NOT match Meta Pixel for unrelated facebook.com request", "does NOT match reCAPTCHA for www.google.com without /recaptcha/ path"
- [x] Services with requestHosts but no requestPaths behave exactly as today — `findServiceByHost` unchanged; `findServiceByRequest` returns on host match before checking paths; all 46 prior db.test.ts tests pass
- [x] Vitest unit tests: path-match hit (facebook.com/tr, www.google.com/recaptcha/), path-mismatch miss on shared host (facebook.com/plugins/like.php, www.google.com/maps), cross-host false-positive guards (cdn.example.com/track.js, cdn.example.com/transactions/list, other.com/recaptcha/foo), host-only fallback (ga4, hotjar) — 118 tests, all green

**Tests:** `pnpm --filter @cookyay/scanner test` — 118 tests, all pass. Typecheck clean. ESLint clean.

**Notes for verifier:**
- `requestPaths` entries are now `"host/path"` strings (option b from verifier notes). This is the most explicit design: each entry is self-contained and clearly scoped to one host+path pair. No separate "path-host list" needed.
- `recaptcha` has no `requestHosts` entries — path matching alone (`www.google.com/recaptcha/`) is sufficient and avoids the false-positive of matching all `www.google.com` traffic. The host is embedded in the `requestPaths` entry.
- `meta-pixel` has `requestHosts: [connect.facebook.net]` (for the script host) plus `requestPaths: [facebook.com/tr]` (for the pixel beacon). Subdomain match: `www.facebook.com/tr` matches the `facebook.com/tr` entry (via `endsWith('.facebook.com')`).
- `findServiceByHost` (used for scripts/iframes in `classifier.ts`) is unchanged and does NOT interpret `requestPaths`.
- Path semantics (prefix match) are consistent with how `scriptUrlGlobs` will be authored in task 007 — both are described as URL-prefix patterns in the architecture.

## Verifier notes — 2026-06-10 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Path matching uses OR semantics with path prefixes tested against ANY host, producing real false positives (e.g. `cdn.example.com/track.js` → meta-pixel) and contradicting acceptance criterion 1's "both host AND path" requirement.

**What needs to change:**
1. **Fix the match semantics to be host-qualified for path entries.** Acceptance criterion 1 requires a service to match "when an observed request URL matches **both** its host pattern (where given) **and** a requestPaths entry." The implementation in `db.ts findServiceByRequest` (lines 207-237) is pure OR: condition 1 matches host alone (ignoring path), condition 2 matches `pathname.startsWith(p)` against EVERY service's requestPaths regardless of host. Confirmed false positives via probe: `findServiceByRequest('https://cdn.example.com/track.js','cdn.example.com')` → `meta-pixel`; `'https://cdn.example.com/transactions/list'` → `meta-pixel`; `'https://other.com/recaptcha/foo'` → `recaptcha`. The 3-char `/tr` prefix tested against all hosts is especially broad. Research intent is explicitly host-qualified — the gotcha (research/domain-expert-trackers.md line 55) says narrow Meta to `connect.facebook.net` AND `facebook.com/tr` (the beacon path ON facebook.com); architecture change 1 lists `requestPaths` as "Meta `facebook.com/tr`" (host-scoped). The fix: a path entry should only match when the request host is also a host the service legitimately serves. Two viable designs: (a) gate `requestPaths` by an accompanying host list (add the path-host, e.g. `facebook.com`/`www.google.com`, to a per-service path-host set and require host membership + path prefix), or (b) make requestPaths entries full host+path patterns (e.g. `www.facebook.com/tr`, `www.google.com/recaptcha/`) matched against `host + pathname`. Whichever you choose, document the semantics in the JSDoc and keep it consistent with how `scriptUrlGlobs` will be matched in 007.
2. **Reconcile the contradictory documentation.** The `db.ts` JSDoc on `findServiceByRequest` (lines 176-205) describes OR semantics ("Path entries are checked against any host"), while the `classifier.ts` comment (lines 198-201) claims path-services "are only matched when the URL path also matches" — implying host+path. They cannot both be right; pick the host-qualified behavior and make both comments agree.
3. **Re-verify the reCAPTCHA entry under the corrected semantics.** `recaptcha` currently has NO requestHosts and relies entirely on a global `/recaptcha/` path prefix. Under host-qualified semantics this needs its serving host(s) specified — research recommendation 7 says use requestHost `www.google.com` (narrow enough). Add the host so the path is anchored to it (matching `www.google.com/recaptcha/` but not `other.com/recaptcha/`).
4. **Add the missing cross-host false-positive tests.** Criterion 4's "path-mismatch miss on a shared host" is only tested within `www.facebook.com` (`/plugins/like.php`). Add tests proving a `/tr`-prefixed path on an UNRELATED host (e.g. `cdn.example.com/track.js`, `cdn.example.com/transactions/list`) does NOT match meta-pixel, and `/recaptcha/` on a non-Google host does NOT match recaptcha. These guard the actual regression.

**Acceptance criteria check:**
- [ ] classifier.ts honors requestPaths matching BOTH host and path — FAIL: matching is OR, not AND; path entries match across all hosts (`db.ts:207-237`).
- [~] Path matching distinguishes facebook.com/tr and www.google.com/recaptcha/ from unrelated requests to the SAME host — PARTIAL: distinguishes within the same host (tests pass), but misclassifies unrelated requests on OTHER hosts as the path-keyed service.
- [x] Services with requestHosts but no requestPaths behave as before — PASS: `findServiceByHost` unchanged; host-match path is first and returns immediately; 46 prior classifier tests green.
- [x] Vitest unit tests cover path-hit, path-mismatch miss (same host), host-only fallback — PASS for the cases written and all green; but the cross-host false-positive case is not covered (see change 4).

**Tests:** `pnpm --filter @cookyay/scanner test` → 115/115 pass. Typecheck clean, ESLint clean, `node scripts/build-services-db.mjs` produces no diff (no generated-file drift). The green suite does not catch the cross-host false positive — it is a coverage gap, not a passing behavior.

**Notes for next executor:**
- Core fix is in `packages/scanner/src/db.ts` `findServiceByRequest` (lines 207-237). The `findServiceByHost` function (used by scripts/iframes) is correct and should stay unchanged.
- Data entries to revisit: `data/services.yaml` (and regenerate `src/db-curated.generated.ts` via `node scripts/build-services-db.mjs`) — `meta-pixel` (requestHosts `connect.facebook.net`, requestPaths `/tr`) and `recaptcha` (no requestHosts, requestPaths `/recaptcha/`). Under host-qualified semantics, both need the path's serving host represented somehow.
- Reproduce the false positive quickly: `findServiceByRequest('https://cdn.example.com/track.js','cdn.example.com')` should return null after the fix; today it returns meta-pixel.
- Keep semantics consistent with the planned `scriptUrlGlobs` matching in task 007 (impl note in this task references it).

## Verifier notes — 2026-06-10 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Re-execution fixed the OR→host-qualified-AND semantics; all four prior rejection points resolved, previously-reported false positives independently confirmed gone, 118 tests green.
**Acceptance criteria check:**
- [x] classifier.ts honors requestPaths matching BOTH host and path — `db.ts:219-256` `findServiceByRequest` parses each `"host/path"` entry into host+path and requires `host===entryHost || host.endsWith('.'+entryHost)` AND `pathname.startsWith(entryPath)`. classifier.ts:202 now calls `findServiceByRequest` for third-party requests.
- [x] Distinguishes facebook.com/tr and www.google.com/recaptcha/ from unrelated requests to the same host — independently probed: `www.facebook.com/tr`→meta-pixel, `www.facebook.com/plugins/like.php`→null, `www.google.com/recaptcha/api.js`→recaptcha, `www.google.com/maps`→null. Cross-host false positives gone: `cdn.example.com/track.js`→null, `cdn.example.com/transactions/list`→null, `other.com/recaptcha/foo`→null (all were misclassified before the fix).
- [x] Services with requestHosts but no requestPaths behave as today — `findServiceByHost` unchanged; host branch returns first; ga4/hotjar host-only tests pass; all 46 db + 49 classifier tests green.
- [x] Vitest tests cover path-hit, path-mismatch (same host), cross-host false-positive guards, host-only fallback — present in `classifier.test.ts` `findServiceByRequest` describe block, all green.
**Tests:** `pnpm --filter @cookyay/scanner test` → 118/118 pass. Typecheck clean, ESLint clean, `build-services-db.mjs` rebuild is idempotent (stable md5, no drift). reCAPTCHA anchored to `www.google.com/recaptcha/` (no requestHosts); meta-pixel `connect.facebook.net` host + `facebook.com/tr` path — both match research recommendations 2 & 7. JSDoc on `findServiceByRequest`/`requestPaths` and the classifier.ts comment now consistently describe host-qualified AND semantics. The prd.md frontmatter version-pointer change (v3→v4) is a /pm:version artifact, not task-004 scope drift.
