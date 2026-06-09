# @cookyay/scanner

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
