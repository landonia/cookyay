---
"@cookyay/scanner": patch
---

Auto-provision Chromium on first run. A cold `npx @cookyay/scanner scan <url>`
previously failed with `browserType.launch: Executable doesn't exist` because
the `playwright` package was installed but the Chromium binary was never
downloaded. The scanner now detects the missing binary before launching, prints
a one-time message (`Chromium not found — downloading (~150MB, one time)...`),
downloads only the Chromium headless shell, then continues the scan in the same
invocation. Subsequent runs are a silent no-op. If the automatic download fails
(offline, disk full, locked-down CI), a branded error names the manual fallback
(`npx playwright install chromium`) instead of leaking a raw Playwright stack.
