---
id: "003"
title: Consent state core (record, cookie, localStorage)
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: "2026-06-06"
jira_key: ""
depends_on: ["001"]
prd_refs:
  - "prd.md §3.5"
  - "prd.md §Amendments 2026-06-06"
arch_refs:
  - "architecture.md §4 Data layer"
  - "architecture.md §6 Consistency & resilience"
research_refs:
  - "research/compliance-and-legal.md §Recommendations 2"
  - "research/performance-engineer.md §Recommendations 6"
  - "research/domain-expert-cmp.md §Gotchas (policy version bump)"
acceptance_criteria:
  - "Consent record schema includes: schemaVersion, ISO-8601 timestamp, banner version, policyVersion, per-category boolean map, gpc flag (webhook-ready per compliance rec 2)"
  - "Cookie `cookyay_consent` written with SameSite=Lax, configurable domain and expiry (default 12 months); compact payload"
  - "Record mirrored to localStorage; on disagreement the cookie wins; unit tests cover the reconciliation"
  - "policyVersion mismatch or record expiry invalidates stored consent (unit-tested); unknown schemaVersion is treated as no-consent, not a crash"
  - "Nothing is written to cookies/localStorage before a consent decision exists, except the consent record itself (compliance gotcha 3) — verified by a unit test of the init path"
created: 2026-06-06
---

## Task
Implement the consent persistence layer: typed record schema, cookie read/write (hot path, SSR-readable), localStorage mirror (rich metadata), reconciliation, expiry, and policy-version invalidation. This is the foundation everything else (bootstrap, API, banner, Consent Mode) reads from.

## Implementation notes
- Keep the cookie payload minimal (category map + versions); full record in localStorage.
- Pure logic — unit-test in Vitest/jsdom tier; cookie round-trips get covered again in browser mode later.
- The strictly-necessary exemption for the consent cookie only holds if init writes nothing else pre-consent — keep the write path single and auditable.

## Out of scope
GPC detection (009), Consent Mode signals (010), re-prompt UX (011), any DOM/UI.

## Re-execution notes — 2026-06-06
**Verifier gap 1 (cookie-attribute tests):** Replaced the hollow "stores SameSite=Lax" test with a real `vi.spyOn(document, 'cookie', 'set')` spy that asserts the cookie string contains `SameSite=Lax`, `Path=/`, and `Max-Age=31536000`. Replaced the "accepts custom expiryDays" test with a spy-based assertion of `Max-Age=2592000`. Added a new Domain test.

**Verifier gap 2 (fabricated timestamp):** Added epoch-seconds field `t` to `CookiePayload`. `recordToCookiePayload` converts `record.timestamp` → `Math.floor(ms/1000)`. `cookiePayloadToRecord` reconstructs from `new Date(payload.t * 1000).toISOString()`. The old `lsTimestamp` fallback to `new Date()` is gone. Removed the now-dead `parseConsentRecord` and `CATEGORY_IDS` import. Added two tests: timestamp round-trips exactly via the cookie alone (localStorage cleared), and timestamp is not fabricated as "now".

**Verifier gap 3 (unused dep):** Removed `happy-dom` from root `package.json` and ran `pnpm install` to update the lockfile.

## Implementation summary
**Files changed:**
- `packages/cookyay/src/consent/types.ts` — added `t: number` (epoch seconds) to `CookiePayload`
- `packages/cookyay/src/consent/storage.ts` — `recordToCookiePayload` encodes timestamp as epoch seconds; `cookiePayloadToRecord` reconstructs ISO-8601 from `t`; removed stale `lsTimestamp` logic, dead `parseConsentRecord`, and `CATEGORY_IDS` import; updated doc comment
- `packages/cookyay/src/consent/storage.test.ts` — 25 tests: fixed 3 hollow attribute tests to use `document.cookie` setter spy; added 2 timestamp persistence tests; updated compact-payload test to include `t`
- `package.json` (root) — removed unused `happy-dom` devDependency; ran `pnpm install`

**Acceptance criteria check:**
- [x] Schema webhook-ready: `schemaVersion`, ISO-8601 `timestamp`, `bannerVersion`, `policyVersion`, per-category boolean map, `gpc` — `types.ts:12-19`; timestamp now stored authoritatively in cookie (`t` field) so it survives across sessions without localStorage
- [x] Cookie `cookyay_consent` SameSite=Lax, configurable domain/expiry (default 365 days / 31536000s), compact payload — asserted by spy tests: `storage.test.ts` "cookie string contains SameSite=Lax…", "appends Domain attribute…", "uses custom expiryDays…"
- [x] Record mirrored to localStorage; cookie wins on disagreement; reconciliation unit-tested — `readConsent` inflates entirely from cookie payload (localStorage never read in read path, so cookie wins definitively); `reconciliation: cookie wins on disagreement` suite passes
- [x] `policyVersion` mismatch → null; unknown `schemaVersion` → null (no crash) — `storage.ts:L119,L122`; tests: `policyVersion invalidation`, `unknown schemaVersion`
- [x] Nothing written before consent decision — `readConsent` is a pure read; spy test asserts zero `document.cookie` setter calls and zero `localStorage.setItem` calls during `readConsent`

**Tests:** `pnpm test` (25 tests, all pass); typecheck and lint also green.

**Notes for verifier:** Timestamp round-trips with epoch-second precision (sub-second fractions are truncated). The round-trip test accounts for this by comparing `new Date(Math.floor(ms/1000)*1000).toISOString()`. The "not fabricated as now" test asserts `resultMs < before` (write happens before the before-read timestamp). The Node 22 `localStorage` shim in `test-setup.ts` is unchanged and correct.

## Verifier notes — 2026-06-06 — REJECTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Implementation is structurally sound and all 22 tests pass, but the cookie-attribute test asserts nothing, the read path fabricates the consent timestamp when localStorage is unavailable (undermining the webhook-ready evidence requirement), and an acknowledged-unused devDependency was left behind.

**What needs to change:**
1. **Make the cookie-attribute tests actually assert attributes.** `storage.test.ts:121-128` ("stores SameSite=Lax in the Set-Cookie string") only checks the cookie exists. The same file already demonstrates the right technique at line 275: `vi.spyOn(document, 'cookie', 'set')`. Use it to assert the written string contains `SameSite=Lax`, `Path=/`, default `Max-Age=31536000` (365 days), `Max-Age=2592000` when `expiryDays: 30` is passed, and `Domain=example.com` when `domain` is configured. The "accepts custom expiryDays" test (line 261) must assert the Max-Age value, not just "no throw".
2. **Stop fabricating the timestamp on read.** `storage.ts:52` (`cookiePayloadToRecord`) falls back to `new Date().toISOString()` when localStorage is missing or version-mismatched — the returned record then misrepresents *when* consent was given, which breaks the webhook-ready evidence posture (criterion 1, compliance-and-legal rec 2). Recommended fix: add a compact epoch-seconds field (e.g. `t`) to `CookiePayload` so the authoritative timestamp survives in the cookie itself (~11 extra chars, still compact); reconstruct ISO-8601 from it on read. Alternative: make the timestamp explicitly absent/null in the returned record when unknown — do not invent one. Add a unit test: write consent, clear localStorage only, read back, assert the timestamp equals the original (or is explicitly absent), not "now".
3. **Remove the unused `happy-dom` devDependency** from the root `package.json` (executor's own notes flagged it as removable). Run `pnpm install` to update the lockfile.

**Acceptance criteria check:**
- [ ] Schema webhook-ready (schemaVersion, ISO-8601 timestamp, bannerVersion, policyVersion, category map, gpc) — PARTIAL: schema shape is correct (`types.ts:12-19`) but the read path can return a fabricated timestamp (`storage.ts:52`), which is not webhook-ready evidence
- [ ] Cookie SameSite=Lax, configurable domain/expiry (default 12 months), compact payload — PARTIAL: code is correct (`storage.ts:23-29`) but the tests named for these attributes assert none of them (`storage.test.ts:121-128, 261-265`)
- [x] localStorage mirror; cookie wins on disagreement; reconciliation unit-tested — PASS: `storage.ts:160-200`, tests `reconciliation: cookie wins on disagreement` (both tamper cases verified)
- [x] policyVersion mismatch / expiry invalidates; unknown schemaVersion → no-consent not crash — PASS: `storage.ts:172,175`, tests `policyVersion invalidation`, `unknown schemaVersion`, `record expiry via cookie Max-Age` all assert the right behavior
- [x] Nothing written pre-consent except the consent record — PASS: `readConsent` is a pure read; test `init path — no pre-consent writes` spies on the `document.cookie` setter and `Storage.prototype.setItem`

**Tests:** 22/22 pass (`pnpm test`); typecheck, lint, and build also green. The failures above are about what the tests *assert*, not whether they pass.

**Notes for next executor:** The architecture compliance is good — cookie as source of truth, ls as replica, fail-closed parsing all match `architecture.md §6`. Keep the existing structure; the fixes are surgical. For fix 2, if you add `t` to `CookiePayload`, update `parseCookiePayload` validation and the compact-payload test's key list. The Node 22 `localStorage` shim in `test-setup.ts` is legitimate and should stay.

## Verifier notes — 2026-06-06 — ACCEPTED (round 2)
**Verifier:** Senior QA / Tech Lead
**Summary:** All three rejection gaps fixed and independently re-verified — cookie-attribute tests now assert real Set-Cookie strings via setter spies, the timestamp is carried authoritatively in the cookie (`t` epoch-seconds) and never fabricated, and `happy-dom` is removed from package.json and installs.
**Acceptance criteria check:**
- [x] Schema webhook-ready (schemaVersion, ISO-8601 timestamp, bannerVersion, policyVersion, category map, gpc) — `types.ts:12-19`; timestamp persists in cookie (`storage.ts:33,49`); `timestamp persistence` tests prove exact round-trip with localStorage cleared
- [x] Cookie SameSite=Lax, configurable domain/expiry (default 12 months = Max-Age 31536000), compact payload — `storage.ts:22-28`; spy tests assert `SameSite=Lax`, `Path=/`, default and custom Max-Age, and `Domain=` (`storage.test.ts:125,135,274`)
- [x] localStorage mirror; cookie wins on disagreement; reconciliation unit-tested — mirror at `storage.ts:110-117`; read inflates solely from cookie; tamper tests pass
- [x] policyVersion mismatch / expiry invalidates; unknown schemaVersion → no-consent, no crash — `storage.ts:138,141`; suites `policyVersion invalidation`, `unknown schemaVersion`, `record expiry via cookie Max-Age`
- [x] Nothing written pre-consent except the consent record — spy test asserts zero cookie/localStorage writes during `readConsent`
**Tests:** 25/25 pass; typecheck, lint, and build green. Lockfile `happy-dom` mentions are vitest optional-peerDep metadata only, not an installed dependency.
**Non-blocking observation:** the "not fabricated as now" test's `toBeLessThan(before)` could in principle be equal on an exact second boundary; the deterministic round-trip test fully covers the requirement, so no action needed.
