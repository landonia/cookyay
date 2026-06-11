# Data-modeler — Research findings

## Summary

The existing `db.ts` already defines the v4 signature record schema in TypeScript (`ServiceDefinition`), with a proven generation pipeline (`ingest-ocd.mjs` → `db-ocd.generated.ts`). v4 should extend — not replace — this shape: add optional `scriptUrlGlobs` and `iframeSrcGlobs` fields for blocking-declaration hints, canonicalize the hand-curated entries into a separate YAML source file (`packages/scanner/data/services.yaml`) that feeds a build-time generator, and keep confidence as a computed value (never stored per-service). The emitted block-declaration schema (`EmittedService` + `_meta`) already carries all the fields v4 needs; the only gap is adding `scriptSrc` and `iframeSrc` arrays to `EmittedService` so the scanner can populate ready-to-block declaration URLs. Schema evolution is best handled by a `schemaVersion` field in the YAML + a Zod/JSON-Schema CI validator.

---

## Findings

### F1 — Existing `ServiceDefinition` is a strong baseline [prd.md §3.6, v4/goals.md "maintainable, contributable signature database"]

`db.ts` defines `ServiceDefinition` with `id`, `name`, `category`, `cookies[]`, `localStorage[]`, `requestHosts[]`, and `source`. This covers three of the four signal types. The missing signal types for v4 block-declaration generation are:
- `scriptUrlGlobs: string[]` — URL glob patterns for known script sources (e.g. `"*.googletagmanager.com/gtm.js*"`) used to emit `scriptSrc` hints.
- `iframeSrcGlobs: string[]` — URL glob patterns for known embed sources (e.g. `"*.youtube.com/embed/*"`).

Both should be optional (`?`) with default `[]`. Aliases (e.g. "GA4 is also known as GTM") are handled by the existing curated-entry ordering: a separate entry with a distinct `id` and a shared `requestHosts` entry is cleaner than a top-level `aliases` array.

### F2 — On-disk format: YAML source + generated TS module [v4/goals.md "structured, contributable data"; prd.md §7]

The current shape for OCD-derived entries is already generated TS. The hand-curated top-20 entries live as inline `curated({…})` calls in `db.ts`. For v4 (~50 services), this needs a contributor-facing format that:
- Is diff-friendly for PRs (one service per block, fields in a predictable order).
- Passes schema validation in CI without TypeScript compiler knowledge.
- Keeps the build pipeline simple and avoids a circular import.

**Recommendation:** YAML source at `packages/scanner/data/services.yaml` (or `data/services/` per-file). A lightweight `scripts/build-services-db.mjs` generator emits `src/db-curated.generated.ts` — mirroring the existing `ingest-ocd.mjs` → `db-ocd.generated.ts` pattern exactly. YAML is preferred over JSON for contributor experience (comments, multi-line strings for notes) and over raw TS-as-data because YAML can be validated with `ajv` + a JSON Schema independently of `tsc`. TypeScript-as-data (an object literal array) is an alternative only if all contributors are comfortable with TS syntax; YAML is safer for community contributions [prd.md §7].

### F3 — Confidence is computed, not stored [prd.md §3.6 "per-classification confidence annotations"]

The existing `findServiceByCookie`, `findServiceByHost`, `findServiceByLocalStorage` functions derive confidence at lookup time based on `source` ('curated' → 'high'; 'ocd' → 'medium'). This is correct and must not be persisted per-service in the DB. For v4:
- Cookie match on curated entry → `high`
- Request-host or localStorage match → `medium`
- Script/iframe URL glob match on curated entry → `medium` (host match only, no cookie evidence)
- No match, declared category only → `low`

These rules live in the lookup helpers; no schema change is needed for confidence storage.

### F4 — Emitted block-declaration schema needs `scriptSrc`/`iframeSrc` arrays [v4/goals.md "emit pre-classified blocking declarations"]

The current `EmittedService` in `config-emitter.ts` carries `name`, `cookies`, `localStorage`, and `_meta`. The banner's declarative blocking requires a `scriptSrc` or `iframeSrc` pattern per entry (it blocks `type="text/plain"` scripts and `data-src` iframes matching those patterns). For v4, `EmittedService` needs:

```ts
export interface EmittedService {
  name: string
  cookies: string[]
  localStorage?: string[]
  scriptSrc?: string[]   // NEW: URL patterns for script blocking hints
  iframeSrc?: string[]   // NEW: URL patterns for iframe blocking hints
  _meta: { confidence, matchedBy, serviceId, category, pages }
}
```

`_meta` should also gain `category: ServiceCategory` so reviewers see the full annotation without looking at the parent key. Both `scriptSrc` and `iframeSrc` are optional (many services are cookie-only); populated by the emitter when the matched `ServiceDefinition` has `scriptUrlGlobs` / `iframeSrcGlobs`.

### F5 — Schema evolution and contribution workflow [prd.md §7 "accept community contributions"; v4/goals.md acceptance bar]

- Add `schemaVersion: 1` as a top-level field in `services.yaml`. The generator validates this before emitting TS; a future schema change bumps the integer and triggers a migration note in the generator.
- CI validation script (runs in the existing `prebuild` step or a separate `lint:db` npm script): parse YAML → validate each entry against a JSON Schema (required fields: `id`, `name`, `category`, `cookies`; all array fields default to `[]`; `id` must match `/^[a-z0-9-]+$/`); assert no duplicate `id` values.
- The DB versions independently of the scanner package via the YAML file's `schemaVersion` field and a separate `DB_SCHEMA_VERSION` constant exported from `db.ts`. Package semver still gates npm releases; the schema version is for forward-compatibility signalling between contributors and the generator.

### F6 — Storage and packaging [architecture.md §10 monorepo layout]

The signature data should live at `packages/scanner/data/services.yaml` — inside the scanner package, not a shared package. Rationale: only `@cookyay/scanner` consumes it; the banner explicitly defers runtime auto-detection to v5+ [architecture.md §12]; a separate `@cookyay/signatures` package adds maintenance overhead with no v4 beneficiary. The generated `db-curated.generated.ts` stays in `packages/scanner/src/` and is bundled by `tsup` into `dist/` — it becomes part of the scanner's npm artifact, not a separately published data package.

---

## Gotchas

- **`db.ts` inline curated entries must be migrated.** The 20 hand-curated `curated({…})` calls in `db.ts` are currently code, not data. They must be moved to `services.yaml` and removed from `db.ts` before v4 ships, or the DB will have two authoritative sources that can diverge.
- **OCD deduplication.** `db-ocd.generated.ts` already contains an `ocd-amplitude` entry that overlaps with the curated `amplitude` entry. The first-match-wins lookup order prevents classification errors, but contributor documentation must warn that adding a curated entry for a service already in OCD requires checking for overlap.
- **`scriptUrlGlobs` without cookie evidence produces `medium` confidence at best.** A script URL match with no cookie/host corroboration should not be emitted with `high` confidence — reviewers could misread the annotation.
- **YAML file size.** 50 services × ~10 fields each is ~500 YAML lines — comfortably human-reviewable. At 200+ services this would need per-file splitting; not a v4 concern.
- **`iframeSrcGlobs` vs. `requestHosts`.** There is overlap: YouTube's `requestHosts` already includes `youtube.com` and a host match in `findServiceByHost` fires on iframe src URLs too (via `tryExtractHost` in `classifier.ts`). The `iframeSrcGlobs` field is additive for embed-URL specificity (e.g. `"https://www.youtube.com/embed/*"`), not a replacement.

---

## Recommendations

1. **Extend `ServiceDefinition`** with optional `scriptUrlGlobs?: string[]` and `iframeSrcGlobs?: string[]`.
2. **Add `scriptSrc?: string[]`, `iframeSrc?: string[]`, and `_meta.category`** to `EmittedService` in `config-emitter.ts`.
3. **Create `packages/scanner/data/services.yaml`** as the contributor-facing source for all curated entries. Migrate the 20 inline `curated({…})` calls from `db.ts` into it.
4. **Create `scripts/build-services-db.mjs`** mirroring `ingest-ocd.mjs`; emit `src/db-curated.generated.ts`; run as a `prebuild` step (alongside the existing OCD ingestion). Include JSON Schema validation and duplicate-id check.
5. **Export `DB_SCHEMA_VERSION = 1`** from `db.ts`; add `schemaVersion: 1` to `services.yaml`.
6. **Keep confidence computed** in lookup helpers; no per-record confidence storage in the DB.
7. **Do not create a separate `@cookyay/signatures` package** — the data lives in `packages/scanner` for v4; revisit only if the banner gains runtime detection in v5.

---

## Open questions for the user

1. **Single `services.yaml` vs. per-service files?** One flat file is simpler to validate and diff for ~50 entries, but per-file layout (one YAML file per service under `data/services/`) scales better for large community contributions and allows per-file attribution. Which do you prefer?
2. **Should `scriptUrlGlobs` drive actual blocking hints in the emitted config, or remain advisory?** The v4 goal says "emit ready-to-block declarations" — but the banner only blocks what the site owner has declared (type="text/plain"). Should the emitter populate `scriptSrc` with glob patterns that the site owner then copies into their HTML, or is a human-review-required note sufficient?
3. **Expand OCD ingestion to add `requestHosts`?** The OCD-derived entries currently have empty `requestHosts[]`. Would it be acceptable to augment the OCD CSV data with a hand-authored `requestHosts` supplement (a small JSON sidecar) for the top 20 OCD services, or should that be handled exclusively via curated entries?

---

## Out of scope

- Runtime auto-detection in the banner bundle (v5+ per architecture.md §12 and v4/goals.md "deferred to later versions").
- A hosted/API-accessible version of the signature database.
- IAB TCF vendor list alignment.
- Growing the database beyond ~50 services (community-driven, post-v4).
- A `@cookyay/signatures` npm package (no v4 consumer outside the scanner).

## Update — 2026-06-10 (user resolutions)

- **Q2 (scriptUrlGlobs drive blocking hints) → YES, emit real block markup.** The
  emitter must populate ready-to-paste `scriptSrc`/`iframeSrc` patterns (the
  `type="text/plain" data-category` snippets) — not just an advisory note. So
  `ServiceDefinition` grows `scriptUrlGlobs`/`iframeSrcGlobs` (+ a `requestPaths`
  field per the domain-expert resolution), and `EmittedService` carries the
  emitted markup.
- **Q1 (single `services.yaml` vs per-service files)** — left to `/pm:architect`
  / `/pm:plan`; single flat file is the default for ~50 entries unless the
  architect prefers per-file.
- **Q3 (augment OCD `requestHosts`)** — not required; the ~50 curated entries
  carry `requestHosts`, OCD stays cookie-name-only as today.
- Confidence stays **computed, not stored**, and upgraded to "two independent
  signals agree = high" (per domain-expert) [prd.md §3.6].
