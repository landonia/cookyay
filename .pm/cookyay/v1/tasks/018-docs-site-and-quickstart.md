---
id: "018"
title: Docs site + README quickstart (15-min bar)
status: pending
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["016", "017"]
prd_refs:
  - "goals.md §Acceptance bar (15-minute onboarding)"
  - "prd.md §3.7"
arch_refs:
  - "architecture.md §1 Deployment topology (GitHub Pages)"
  - "architecture.md §9 Environments & deployment"
research_refs:
  - "research/ux-researcher.md §Recommendations 8"
  - "research/compliance-and-legal.md §Recommendations 1"
  - "research/integration-engineer.md §Recommendations 1, 2"
acceptance_criteria:
  - "Docs site deploys to GitHub Pages from main and runs Cookyay itself (dogfooding — the banner is live on the docs)"
  - "Quickstart shows the exact two-part install (inline bootstrap snippet first in <head>, deferred UI bundle) with load-order called out as a breakage warning; a fresh reader reaches a working banner + blocking + Consent Mode in under 15 minutes (timed walkthrough by someone other than the implementer, or honest self-timing recorded in the PR)"
  - "Docs cover: config reference, string overrides/i18n, scanner usage, GTM Custom HTML workaround, withdrawal/re-prompt behavior, GPC behavior, SSR cookie reading"
  - "The client-side consent record limitation is documented verbatim-clear: 'for full GDPR Art. 7 accountability, forward consent events to your own backend' (compliance rec 1), plus the not-legal-advice disclaimer"
created: 2026-06-06
---

## Task
Ship the documentation that carries the 15-minute acceptance bar: GitHub Pages site that dogfoods the banner, a quickstart engineered around the two known breakage points (load order, Consent Mode defaults), full config reference, and the honest compliance-limitations section.

## Implementation notes
- Keep tooling minimal — static site generator or hand-rolled; it must not become a third package to maintain.
- The demo page doubles as a manual QA surface; consider embedding the fixture-style demo toggles.

## Out of scope
The CookieYes comparison page (019), blog/marketing content, translations of docs.

## Verifier notes
<!-- Empty at creation. Populated by /pm:verify if rejected. -->
