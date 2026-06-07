# GTM + Cookyay — Consent Mode v2 integration guide

> **v1 status:** Cookyay v1 does not ship a GTM tag template (`.tpl`). A first-party
> `.tpl` that uses GTM's `updateConsentState()` Sandbox API is deferred to v2
> (architecture.md §12). This guide explains what v1 does out-of-the-box, why it is
> sufficient for most GTM sites, and how to diagnose or augment it.

## How v1 integrates with GTM

Cookyay uses Google's **Advanced Consent Mode** pattern:

1. **Bootstrap snippet (sync, `<head>`)** — fires `gtag('consent','default', {...all denied, wait_for_update: 500})` before any Google tag loads, so GTM/GA4 never processes hits without a consent state.
2. **UI bundle (deferred)** — when the visitor makes a choice (or GPC is honoured on load), fires `gtag('consent','update', {...mapped signals})` via the `cookyay:consent` custom event.

Google tags hold hit dispatch for up to `wait_for_update` ms and resume with the updated state as soon as the `update` call arrives. For returning visitors with a stored consent cookie this round-trip is near-instantaneous; for first-time visitors the 500 ms window is the industry-standard headroom.

This is the standard `gtag` integration path — no GTM-specific changes are required for most sites.

## The Sandbox API limitation

GTM Custom HTML tags push to the `dataLayer` queue, which means a `gtag('consent','update')` call inside a Custom HTML tag is processed *after* any GTM hits already in the queue at that moment. The correct fix is GTM's `updateConsentState()` Sandbox API (available only inside a Custom Tag Template `.tpl`), which processes the update synchronously.

Cookyay's UI bundle fires the `update` call directly from page-level JavaScript, **outside** GTM's queue, so it does **not** have this race condition. The workaround below is therefore redundant for the common case — it exists only as a diagnostic tool or for setups where the Cookyay bundle fires after GTM has already dispatched hits.

## Required: load-order setup

The only hard requirement is snippet ordering:

```html
<head>
  <!-- 1. Cookyay bootstrap — MUST be first in <head> -->
  <script>
    window.dataLayer=window.dataLayer||[];
    window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};
    window.__COOKYAY=window.__COOKYAY||{q:[],gpc:!!navigator.globalPrivacyControl};
    window.gtag("consent","default",{
      ad_storage:"denied",analytics_storage:"denied",
      ad_user_data:"denied",ad_personalization:"denied",
      functionality_storage:"denied",personalization_storage:"denied",
      security_storage:"denied",wait_for_update:500
    });
  </script>

  <!-- 2. GTM container snippet — after Cookyay bootstrap -->
  <script>(function(w,d,s,l,i){...})(window,document,'script','dataLayer','GTM-XXXX');</script>
</head>
```

If GA4/GTM loads before the Cookyay snippet, consent defaults are never registered — a silent GDPR violation. The README shows the correct `<head>` ordering with this warning.

To generate a snippet with a custom `wait_for_update` value:

```js
import { buildInlineSnippet } from 'cookyay'
const snippet = buildInlineSnippet(1000) // 1s for async consent cookie reads
```

## Optional: GTM Custom HTML tag for diagnostics

If you want to confirm consent updates are landing in GTM's dataLayer (e.g., for tag sequencing or trigger debugging), you can add a Custom HTML tag that listens for `cookyay:consent`. This is a **monitoring tag**, not a replacement for the bundle's own update call.

```html
<script>
(function () {
  // Diagnostic only — Cookyay's bundle already fires gtag('consent','update')
  // on this event. Do not fire a second update here unless you've removed the
  // Cookyay bundle's consentmode integration.
  document.addEventListener('cookyay:consent', function (e) {
    console.debug('[GTM debug] cookyay:consent received', e.detail.categories)
    // Optionally push to dataLayer for GTM trigger use:
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push({ event: 'cookyay_consent', consent: e.detail.categories })
  })
})();
</script>
```

Trigger: **All Pages** · Fire after the Cookyay tag.

## Signal map reference

| Banner category | Consent Mode v2 signals |
|---|---|
| necessary | `functionality_storage` + `security_storage` (always granted) |
| functional | `personalization_storage` |
| analytics | `analytics_storage` |
| marketing | `ad_storage` + `ad_user_data` + `ad_personalization` |

## v2 roadmap

A first-party GTM tag template (`.tpl`) using `updateConsentState()` is planned for v2. It will eliminate the residual dataLayer-queue window for GTM-managed pages and enable GTM Community Gallery distribution.
