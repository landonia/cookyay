---
id: "019"
title: Comparison page (§3.8)
status: pending
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["018"]
prd_refs:
  - "prd.md §3.8"
  - "prd.md §6 (success metric)"
arch_refs: []
research_refs:
  - "research/compliance-and-legal.md §Recommendations 1, 7"
  - "research/domain-expert-cmp.md §Summary (prior art)"
acceptance_criteria:
  - "A docs-site page compares Cookyay vs CookieYes feature-by-feature (banner, blocking, Consent Mode v2, GPC, scanner, consent log, geo-targeting, TCF, dashboards, pricing)"
  - "Contains an explicit 'what Cookyay cannot do' section: no server-side consent log, no IAB TCF, no geo-detection, no hosted dashboard, no legal guarantee (compliance rec 7)"
  - "Mentions the open-source neighbors honestly (vanilla-cookieconsent, Klaro) and what Cookyay adds (scanner, GPC, two-part bootstrap)"
  - "Every claim about Cookyay maps to a shipped v1 feature — no aspirational rows; reviewed against the released feature set"
created: 2026-06-06
---

## Task
Write the honest parity page that is the project's stated success metric: a developer should be able to read it and confidently decide whether they can drop their CookieYes subscription — including when the answer is no.

## Implementation notes
- Source CookieYes's current feature list/pricing at write time; date-stamp the comparison.
- Tone: factual, no marketing fluff — the honesty IS the differentiator (prd §6).

## Out of scope
Comparisons against every CMP (CookieYes is the named benchmark; others get one summary row at most), SEO work.

## Verifier notes
<!-- Empty at creation. Populated by /pm:verify if rejected. -->
