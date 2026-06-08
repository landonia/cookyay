---
id: "020"
title: Production dogfood + manual real-site scan
status: in-progress
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

## Blocker

**Blocked on GitHub Pages not being enabled for this repository.**

All four acceptance criteria require a live production URL. As of 2026-06-07:

1. `curl https://api.github.com/repos/landonia/cookyay` returns `"has_pages": false` — GitHub Pages is not enabled.
2. `https://landonia.github.io/cookyay/` returns HTTP 404 (redirects to `https://landonia.com/cookyay/` which is also 404).
3. The `.github/workflows/pages.yml` workflow is correctly configured and ready to deploy — it just hasn't been triggered because Pages is disabled.

**What was done in this execution:**
- Updated `docs/index.html` to pin to `cookyay@0.1.1` (the latest npm release) in all 4 occurrence sites (live `<script>` tag, quickstart code block, CDN reference code block, footer link). The SRI hash is unchanged (`sha384-N+QKf1l1ObmRy4UzdajIdsJuSFcEYaFLCTGDEnXTGaEmtrN/q2LJkv0uNvXtBlAv`) because 0.1.0 and 0.1.1 are byte-for-byte identical builds.
- Updated `README.md` to pin to `cookyay@0.1.1` in 3 occurrence sites (IIFE install example, integrity API URL, quickstart Part 2 script tag).
- Created `docs/dogfood-report.md` — structured report scaffold with sections for deployment status, scanner findings, VoiceOver smoke test results, defects log, quickstart timing, and comparison-page honesty notes. All sections are pre-populated with the test procedures and table headers; findings are marked PENDING.

**To unblock this task, the author must:**

1. **Enable GitHub Pages:** Go to https://github.com/landonia/cookyay/settings/pages → Source: **GitHub Actions** → Save.
2. **Deploy the docs site:** Push to `main` or manually trigger the "Deploy docs to GitHub Pages" workflow. Verify `https://landonia.github.io/cookyay/` returns HTTP 200.
3. **(Recommended) Declare real services:** Update `Cookyay.init()` in `docs/index.html` (around line 1080) to include at least one real analytics service (e.g., GA4 if the site will use it) instead of the synthetic `_example_ga`. This satisfies criterion 1's "real declared scripts" requirement.
4. **Run the scanner:** `npx @cookyay/scanner@0.1.1 https://landonia.github.io/cookyay/ --depth 1 --config-out docs/dogfood-scanner-config.json`
5. **Do the VoiceOver pass:** Follow the 13-step procedure in `docs/dogfood-report.md §3`.
6. **Fill in `docs/dogfood-report.md`:** Scanner findings, VoiceOver results, defects, quickstart timing.
7. **File issues** for any defects found and fix blockers before closing the task.

## Verifier notes
<!-- Empty at creation. Populated by /pm:verify if rejected. -->
