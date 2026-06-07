export type { CategoryId, ConsentRecord, CookiePayload } from './types.js'
export { CATEGORY_IDS, CURRENT_SCHEMA_VERSION } from './types.js'
export {
  COOKIE_NAME,
  LS_KEY,
  buildConsentRecord,
  clearConsent,
  readConsent,
  writeConsent,
} from './storage.js'
export type { WriteOptions } from './storage.js'
