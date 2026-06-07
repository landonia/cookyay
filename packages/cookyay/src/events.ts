import type { CategoryId, ConsentRecord } from './consent/index.js'
import { CURRENT_SCHEMA_VERSION } from './consent/index.js'

// ---------------------------------------------------------------------------
// Event payload type
// ---------------------------------------------------------------------------

export interface ConsentEventDetail {
  schemaVersion: number
  policyVersion: string
  timestamp: string
  categories: Record<CategoryId, boolean>
}

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

function buildDetail(record: ConsentRecord): ConsentEventDetail {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    policyVersion: record.policyVersion,
    timestamp: record.timestamp,
    categories: { ...record.categories },
  }
}

/**
 * Dispatch `cookyay:consent` on document.
 * Fired whenever a consent record is written (initial grant or update).
 */
export function dispatchConsentEvent(record: ConsentRecord): void {
  document.dispatchEvent(
    new CustomEvent<ConsentEventDetail>('cookyay:consent', {
      detail: buildDetail(record),
      bubbles: false,
    }),
  )
}

/**
 * Dispatch `cookyay:change` on document.
 * Fired only when category choices change from a previously stored record.
 */
export function dispatchChangeEvent(record: ConsentRecord): void {
  document.dispatchEvent(
    new CustomEvent<ConsentEventDetail>('cookyay:change', {
      detail: buildDetail(record),
      bubbles: false,
    }),
  )
}
