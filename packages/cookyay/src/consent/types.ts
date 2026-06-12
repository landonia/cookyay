export type CategoryId = 'necessary' | 'functional' | 'analytics' | 'marketing'

export const CATEGORY_IDS: readonly CategoryId[] = [
  'necessary',
  'functional',
  'analytics',
  'marketing',
]

export const CURRENT_SCHEMA_VERSION = 1

export interface ConsentRecord {
  schemaVersion: number
  timestamp: string
  bannerVersion: string
  policyVersion: string
  categories: Record<CategoryId, boolean>
  gpc: boolean
}

// Short keys used in the cookie payload for compactness
export interface CookiePayload {
  sv: number
  t: number // Unix epoch seconds — authoritative consent timestamp
  pv: string
  bv: string
  c: { n: boolean; f: boolean; a: boolean; m: boolean }
  gpc: boolean
}
