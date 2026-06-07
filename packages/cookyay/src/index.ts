export { VERSION } from './version.js'

export { INLINE_SNIPPET_JS, buildInlineSnippet } from './snippet.js'

export { grant, scanBlocked } from './blocking.js'
export type { BlockerOptions } from './blocking.js'

export type { CategoryId, ConsentRecord, CookiePayload, WriteOptions } from './consent/index.js'
export {
  CATEGORY_IDS,
  COOKIE_NAME,
  CURRENT_SCHEMA_VERSION,
  LS_KEY,
  buildConsentRecord,
  clearConsent,
  readConsent,
  writeConsent,
} from './consent/index.js'

// Config types and helpers
export type {
  CategoryConfig,
  ConfigWarning,
  CookieOptions,
  CookyayConfig,
  ServiceDeclaration,
  StringTable,
  ThemeOptions,
} from './config.js'
export { DEFAULT_STRINGS, resolveStrings, validateConfig } from './config.js'

// Event types
export type { ConsentEventDetail } from './events.js'

// Consent Mode v2 signal helpers (for advanced integrations / testing)
export type { ConsentModeSignals, ConsentSignalValue } from './consentmode.js'
export { applyConsentModeUpdate, buildConsentModeSignals } from './consentmode.js'

// Public JS API
export {
  _getConfig,
  _getStrings,
  _hasSeenThisSession,
  _recordConsent,
  _registerUI,
  _registerPreferencesUI,
  _registerGpcUI,
  _resetApi,
  getConsent,
  init,
  onConsent,
  openPreferences,
} from './api.js'

// Banner UI — side-effect import so _registerUI(mountBanner) runs at bundle load time.
// NOTE: do NOT set "sideEffects": false in package.json — tree-shakers would drop
// these imports and the banner/preferences would never register.
import './banner.js'

// Preferences modal — side-effect import so _registerPreferencesUI(mountPreferences) runs.
import './preferences.js'

// GPC policy + toast — side-effect import so _registerGpcUI(runGpc) runs.
import './gpc.js'

// Consent Mode v2 — side-effect import wires cookyay:consent → gtag update.
import './consentmode.js'
