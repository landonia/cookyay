# cookyay

## 0.2.0

### Minor Changes

- 588bf59: Runtime auto-blocking now covers tracking pixels (`<img>` and `new Image()`) alongside scripts and iframes. Detected pixels are intercepted and held inert until consent, then fired on grant via the injection path. Adds a debug-gated bootstrap-first diagnostic that warns when Cookyay isn't installed first (dead-code-eliminated from the production bundle) and pixel-class signatures in the bundled auto-block database. The `fetch`/`sendBeacon` transport gap is documented as a known limitation.

## 0.1.2

### Patch Changes

- 89654c4: Fix: explicit consent choices saved while GPC is live are no longer overwritten on reload

  In GPC-enabled browsers (e.g. Brave, which sends Global Privacy Control by
  default), preferences saved via the Cookie settings modal were forgotten on
  every page load: the saved record carried `gpc:false`, so the GPC policy
  treated it as a stale pre-GPC grant and overwrote it with all-denied,
  re-showing the toast.

  `_recordConsent` now marks any record written while GPC is live as
  GPC-acknowledged (`gpc:true`), so explicit post-GPC choices persist across
  reloads and the confirmation toast shows exactly once. Records written
  without knowledge of the GPC signal are still overridden (CCPA §1798.135);
  explicit subsequent consent is honoured per CCPA §7025(c)(2).

## 0.1.1

### Patch Changes

- 77bfd0f: First CI-published release via OIDC Trusted Publishing (no long-lived npm tokens)
