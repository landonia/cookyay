# @cookyay/scanner

## 0.1.3

### Patch Changes

- 51271b7: Auto-provision Chromium on first run. A cold `npx @cookyay/scanner scan <url>`
  previously failed with `browserType.launch: Executable doesn't exist` because
  the `playwright` package was installed but the Chromium binary was never
  downloaded. The scanner now detects the missing binary before launching, prints
  a one-time message (`Chromium not found — downloading (~150MB, one time)...`),
  downloads only the Chromium headless shell, then continues the scan in the same
  invocation. Subsequent runs are a silent no-op. If the automatic download fails
  (offline, disk full, locked-down CI), a branded error names the manual fallback
  (`npx playwright install chromium`) instead of leaking a raw Playwright stack.

## 0.1.2

### Patch Changes

- 56f305b: Accept an optional leading `scan` subcommand. `npx @cookyay/scanner scan <url>`
  — the form shown in the README — previously failed with `Error: "scan" is not a
valid URL` because npx forwards `scan <url>` to the `cookyay-scan` bin and the
  literal `scan` token was parsed as the URL. The bare `npx @cookyay/scanner <url>`
  form is unchanged. README example also updated to include `--config-out` so it
  actually emits the config it describes.

## 0.1.1

### Patch Changes

- 77bfd0f: First CI-published release via OIDC Trusted Publishing (no long-lived npm tokens)
