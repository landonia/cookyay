---
id: "020"
title: Production dogfood + manual real-site scan
status: pending
assignee: ""
branch: ""
claimed_at: ""
pr_url: ""
completed_at: ""
jira_key: ""
depends_on: ["016", "018"]
prd_refs:
  - "goals.md §Acceptance bar"
  - "prd.md §6 Success metrics"
arch_refs: []
research_refs:
  - "research/test-strategist.md §Open questions 5 (Update)"
acceptance_criteria:
  - "Cookyay (published npm/CDN build, not a local copy) is live in production on at least one of the author's real sites with real declared scripts"
  - "@cookyay/scanner run manually against that site produces a usable config; common services are correctly classified; results (incl. misclassifications) recorded in a dogfood report committed to the repo"
  - "Manual screen-reader smoke test (VoiceOver) of banner + preferences on the production site recorded in the report"
  - "Any defects found are filed as issues; blockers fixed before this task closes"
created: 2026-06-06
---

## Task
Close the loop on the dogfooding bar: deploy the released build to one of the author's production sites, run the scanner against it (this stays manual — CI uses the hermetic fixture), do the manual screen-reader pass, and write the findings down. This is the v1 exit gate.

## Implementation notes
- Use the real CDN install path the docs recommend, exactly as a new user would — it validates the quickstart end-to-end.
- The dogfood report is also raw material for the comparison page's honesty claims.

## Out of scope
External-user adoption work, announcements/launch posts.

## Verifier notes
<!-- Empty at creation. Populated by /pm:verify if rejected. -->
