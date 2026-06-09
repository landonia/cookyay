---
id: 001
title: Accept `scan` subcommand in scanner CLI
status: done
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: []
complexity: 2
prd_refs:
  - "prd.md §3.6"
  - "goals.md §What ships in v2"
arch_refs:
  - "architecture.md §1 Deployment topology"
test_refs: []
research_refs: []
acceptance_criteria:
  - "`node dist/cli.js scan <url>` (and via npx, `npx @cookyay/scanner scan <url>`) no longer fails with `Error: \"scan\" is not a valid URL.` — it proceeds to the crawl"
  - "`node dist/cli.js <url>` (bare form, no verb) still works identically — same parsed args"
  - "A leading `scan` token is stripped only in the verb position; a `scan` value passed to a flag (e.g. `--output scan`) is not treated as a subcommand"
  - "Unit test asserts `parseArgs(['node','cookyay-scan','scan',url,...])` deep-equals the bare `parseArgs(['node','cookyay-scan',url,...])`; full scanner unit suite green (`pnpm --filter @cookyay/scanner test`)"
created: 2026-06-08
---

## Task
The scanner's only accepted invocation was `cookyay-scan <url>`, but the README
documents `npx @cookyay/scanner scan <url>`. Because the package's bin name
(`cookyay-scan`) differs from the package name, npx runs the single bin and
forwards `scan <url>` as argv; `parseArgs` then picked the literal `scan` token
as the URL and `new URL("scan")` threw `Error: "scan" is not a valid URL.` —
making the documented command the broken one [prd.md §3.6]. Make the CLI accept
an optional leading `scan` subcommand so both `scan <url>` and the bare `<url>`
forms work.

## Implementation notes
- `packages/scanner/src/index.ts` `parseArgs`: strip a leading `scan` token
  (`if (args[0] === 'scan') args = args.slice(1)`) before flag/URL parsing.
  Keep the strip confined to the leading position so non-verb `scan` values are
  untouched.
- Regression tests live in `packages/scanner/src/index.test.ts` under a
  `scan subcommand` describe block (3 cases: strips verb, `scan <url>` ≡ bare,
  non-leading `scan` untouched).
- Rebuild (`pnpm --filter @cookyay/scanner build`) so `dist/cli.js` reflects the
  change before manual verification.

## Out of scope
- Adding any other subcommands (no `crawl`, `classify`, etc. — `scan` is the only
  documented verb).
- Changing flag semantics or crawl behavior.

## Verifier notes — 2026-06-08 — ACCEPTED
**Verifier:** Senior QA / Tech Lead
**Summary:** Leading `scan` verb stripped in `parseArgs` exactly as specified; both invocation forms parse identically, non-leading `scan` untouched, full suite green.
**Acceptance criteria check:**
- [x] `scan <url>` no longer fails — `packages/scanner/src/index.ts:48` strips leading `scan`; rebuilt `dist/cli.js:7468` confirmed; `new URL("scan")` path no longer reached (smoke test: `scan https://example.com` parses url=`https://example.com`).
- [x] bare `<url>` still works identically — smoke test deep-equal of `scan <url> --depth 1` vs `<url> --depth 1` returned true.
- [x] leading-only strip; `--output scan` value preserved — verified `output=scan`, `url=https://example.com`; strip guarded by `args[0] === 'scan'`.
- [x] unit test asserts equality + suite green — `src/index.test.ts` `scan subcommand` block (3 cases); `pnpm --filter @cookyay/scanner test` → 53/53 pass.
**Tests:** 53/53 pass (`pnpm --filter @cookyay/scanner test`); `pnpm --filter @cookyay/scanner build` succeeds.
**Notes:** db-ocd.generated.ts diff is an auto-regenerated build timestamp (harmless); prd.md diff is the v2 version/status bump, not implementation drift. README/changeset edits are minor and consistent with goals.
