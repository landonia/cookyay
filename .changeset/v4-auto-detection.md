---
'@cookyay/scanner': minor
---

Auto-detection of known third-party scripts. The scanner now identifies third-party services on a site, classifies them with a two-signal confidence model, and emits host-deduped `suggestedBlocking[]` rules with paste-ready `type="text/plain"` script/iframe snippets. Ships a contributable `data/services.yaml` signature database (~50 curated services) with codegen + CI schema validation, path-level (`requestPaths`) matching, a generated `service-fingerprints.json`, five false-positive signature fixes, and hermetic detection-path test coverage.
