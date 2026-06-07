// README-ready inline snippet (~300 bytes, copy-paste into <head>).
// Fires all-denied Consent Mode v2 defaults for first-time visitors.
// Load bootstrap.js after this snippet to handle returning visitors
// (cookie read + per-signal update).
//
// Uses window.gtag= (not a function declaration) so the snippet works
// correctly when eval'd inside an ES module scope (function declarations
// in eval are block-scoped in strict mode and wouldn't escape to window).

/**
 * Generate the synchronous <head> bootstrap snippet.
 *
 * @param waitForUpdate - ms Google tags wait for a consent update before firing
 *   with the default (denied) state. Default: 500 (industry standard). Increase
 *   if your consent cookie read is async; decrease for first-time visitors on
 *   fast connections where 500ms is noticeable. Architecture §13.
 */
export function buildInlineSnippet(waitForUpdate = 500): string {
  return (
    'window.dataLayer=window.dataLayer||[];' +
    'window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};' +
    'window.__COOKYAY=window.__COOKYAY||{q:[],gpc:!!navigator.globalPrivacyControl};' +
    'window.gtag("consent","default",{' +
    'ad_storage:"denied",' +
    'analytics_storage:"denied",' +
    'ad_user_data:"denied",' +
    'ad_personalization:"denied",' +
    'functionality_storage:"denied",' +
    'personalization_storage:"denied",' +
    'security_storage:"denied",' +
    `wait_for_update:${waitForUpdate}` +
    '});'
  )
}

/** Pre-built snippet with the default wait_for_update (500 ms). */
export const INLINE_SNIPPET_JS = buildInlineSnippet()
