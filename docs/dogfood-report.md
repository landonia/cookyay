# Cookyay v1 Dogfood Report

**Date:** _TBD — pending production deployment_
**Version under test:** cookyay@0.1.1
**Production site:** https://landonia.github.io/cookyay/
**Scanner version:** @cookyay/scanner@0.1.1
**Tester:** Landon Wainwright

---

## Summary

> **Status: PENDING** — production deployment not yet live.
>
> GitHub Pages has not been enabled for this repository (`has_pages: false` as of 2026-06-07).
> All three manual acceptance steps below are blocked on the site being live.
>
> **To unblock:**
> 1. Go to the repository **Settings → Pages** on GitHub.
> 2. Under "Source," select **GitHub Actions**.
> 3. Re-run or push to `main` to trigger the Pages workflow (`.github/workflows/pages.yml`).
> 4. Verify the site is live at https://landonia.github.io/cookyay/
> 5. (Optional) Add a real GA4 or Plausible snippet to the `Cookyay.init()` call in
>    `docs/index.html` to demonstrate real declared-script blocking.
> 6. Run `@cookyay/scanner` (see §2 below).
> 7. Do the VoiceOver pass (see §3 below).
> 8. Fill in §2 and §3 with real findings, then remove this PENDING notice.

---

## 1. Production deployment

| Item | Value |
|------|-------|
| URL | https://landonia.github.io/cookyay/ |
| Install method | CDN (jsDelivr IIFE), pinned to `cookyay@0.1.1` with SRI |
| CDN URL | `https://cdn.jsdelivr.net/npm/cookyay@0.1.1/dist/index.iife.js` |
| SRI hash | `sha384-N+QKf1l1ObmRy4UzdajIdsJuSFcEYaFLCTGDEnXTGaEmtrN/q2LJkv0uNvXtBlAv` |
| `policyVersion` | `2026-01-01` |
| Categories enabled | `necessary`, `analytics` |
| Declared services | Example analytics service (cookie: `_example_ga`) |
| Bootstrap snippet | Inline verbatim copy of `dist/bootstrap.js` |
| Consent Mode v2 | Enabled via bootstrap (all-denied defaults before any tag fires) |
| GPC detection | Yes (bootstrap detects `navigator.globalPrivacyControl`, toast shown on first visit) |
| Auto re-open link | Yes (`autoOpenLink: true`, "Cookie settings" link in bottom-left) |

### Deployment checklist

- [ ] GitHub Pages enabled (Settings → Pages → Source: GitHub Actions)
- [ ] Workflow `.github/workflows/pages.yml` triggered and succeeded
- [ ] Site loads at https://landonia.github.io/cookyay/ with HTTP 200
- [ ] Cookyay banner appears on first visit (no existing consent cookie)
- [ ] Bootstrap snippet fires before any analytics tag (verified in Network tab)
- [ ] "Cookie settings" re-open link visible after banner dismissed

---

## 2. Scanner run

**Command:**
```bash
npx @cookyay/scanner@0.1.1 https://landonia.github.io/cookyay/ \
  --depth 1 \
  --config-out docs/dogfood-scanner-config.json \
  --output docs/dogfood-scanner-raw.json
```

> **PENDING** — run after production site is live. Paste scanner output below.

### Scanner findings

_To be filled in after running the scanner._

**Detected cookies:**

| Cookie name | Domain | Category | Confidence | Note |
|-------------|--------|----------|------------|------|
| `cookyay_consent` | `.landonia.github.io` | Necessary | — | Cookyay's own consent record |
| _(add rows)_ | | | | |

**Detected third-party requests:**

| Host | Resource type | Category | Confidence | Note |
|------|---------------|----------|------------|------|
| `cdn.jsdelivr.net` | Script | Necessary | — | Cookyay IIFE bundle (self-declared) |
| _(add rows)_ | | | | |

**Unclassified items:** _(list any `_unclassified` entries from emitted config here)_

**noscript warnings:** _(list any `_noscriptWarnings` here — expect none if the template is clean)_

**Config emit (summary):** _(paste the `toCookyayConfig()` output or key sections)_

**Misclassifications observed:**

| Item | Scanner said | Correct category | Fix |
|------|-------------|-----------------|-----|
| _(none expected — fill in if found)_ | | | |

**Issues filed:**
- _(link to GitHub issues for any misclassifications or scanner bugs)_

---

## 3. Screen-reader smoke test (VoiceOver)

**Environment:** macOS, Safari, VoiceOver (Cmd+F5 to enable)
**Tested at:** _(URL and date)_

> **PENDING** — run after production site is live.

### Test procedure

1. Open https://landonia.github.io/cookyay/ in Safari with a cleared consent cookie.
2. Enable VoiceOver (Cmd+F5).
3. Verify VoiceOver announces the banner dialog on page load.
4. Navigate through banner with Tab / arrow keys.
5. Verify "Accept all", "Reject all", and "Manage preferences" buttons are reachable and announced.
6. Open preferences modal ("Manage preferences").
7. Verify focus is trapped inside the modal.
8. Verify each toggle is announced as `role="switch"` with its state (on/off).
9. Press Escape — verify modal closes WITHOUT recording consent.
10. Accept all cookies via the banner.
11. Locate the "Cookie settings" re-open link (bottom-left).
12. Verify it's reachable by keyboard and opens the preferences modal.
13. Test withdrawal — change a toggle, save → verify "reload required" prompt appears and is announced.

### Results

| Step | Pass/Fail | Notes |
|------|-----------|-------|
| Banner dialog announced on load | _(PENDING)_ | |
| Tab navigation reaches all 3 banner buttons | _(PENDING)_ | |
| Preferences modal is focus-trapped | _(PENDING)_ | |
| Each toggle announced as switch with state | _(PENDING)_ | |
| Escape closes modal without recording consent | _(PENDING)_ | |
| "Cookie settings" re-open link keyboard-accessible | _(PENDING)_ | |
| Withdrawal "reload required" prompt announced | _(PENDING)_ | |

**VoiceOver issues found:** _(list any a11y defects here)_

**Issues filed:**
- _(link to GitHub issues for any accessibility defects)_

---

## 4. Defects found

_List all defects discovered during the dogfood, with links to filed GitHub issues._

| Issue | Severity | Status | GitHub issue |
|-------|----------|--------|--------------|
| _(none yet)_ | | | |

---

## 5. Quickstart validation

> One qualitative check: was the 15-minute quickstart bar met using the production CDN path?

_Self-timed walkthrough notes:_
- Part 1 (inline bootstrap snippet): ~___ min
- Part 2 (deferred IIFE tag): ~___ min
- `Cookyay.init()` call with categories: ~___ min
- Script/iframe blocking declarations: ~___ min
- Browser verification: ~___ min
- **Total: ~___ min** (target: < 15 min)

---

## 6. Comparison page honesty notes

_Observations from dogfooding that feed into `docs/compare.html` accuracy:_

- _(e.g., "The scanner correctly detected the Cookyay consent cookie as necessary-category")_
- _(e.g., "Scanner found 0 unclassified third-party requests on the docs site — expected for a minimal demo")_
- _(e.g., "VoiceOver passed all steps — a11y claim in compare.html is accurate")_

---

*This report was scaffolded by task 020 executor on 2026-06-07. Fill in §2–§5 after the production deployment is live, then remove the PENDING notice from §0.*
