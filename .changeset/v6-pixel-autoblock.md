---
'cookyay': minor
---

Runtime auto-blocking now covers tracking pixels (`<img>` and `new Image()`) alongside scripts and iframes. Detected pixels are intercepted and held inert until consent, then fired on grant via the injection path. Adds a debug-gated bootstrap-first diagnostic that warns when Cookyay isn't installed first (dead-code-eliminated from the production bundle) and pixel-class signatures in the bundled auto-block database. The `fetch`/`sendBeacon` transport gap is documented as a known limitation.
