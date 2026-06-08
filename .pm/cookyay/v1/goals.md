---
version: v1
status: shipped
created: 2026-06-06
---

# v1 — Goals

## What ships in v1
All PRD goals are in v1 — §3.1 banner, §3.2 script blocking, §3.3
strictest-everywhere posture (incl. GPC), §3.4 Consent Mode v2,
§3.5 client-side consent record, §3.6 CLI scanner, §3.7 npm/CDN
distribution, §3.8 comparison page.

## What's deferred to later versions
- Optional consent webhook (bring-your-own storage) — TBD
- No-code snippet generator UI — TBD
- CMS plugins (WordPress first) — TBD
- Built-in banner translations (if v1 ends up English-only) — TBD

## Acceptance bar
- A new site can go from zero to a working, styled consent banner with
  script blocking + Consent Mode v2 in under 15 minutes using only the
  README.
- The CLI scanner run against one of the author's real sites produces
  a usable config with correctly classified common services.
- Banner passes keyboard-only and screen-reader smoke tests.
- Bundle is verified <20KB min+gzip in CI.
- Deployed in production on at least one of the author's sites.
