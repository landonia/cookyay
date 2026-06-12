import type { CategoryId } from './consent/index.js'

// ---------------------------------------------------------------------------
// Declared service/script shape
// ---------------------------------------------------------------------------

export interface ServiceDeclaration {
  /** Human-readable name shown in the preferences panel. */
  name: string
  /** Cookie names this service may write. */
  cookies?: string[]
  /** localStorage keys this service may write. */
  localStorage?: string[]
}

// ---------------------------------------------------------------------------
// Per-category config
// ---------------------------------------------------------------------------

export interface CategoryConfig {
  /** Override the category label in the preferences panel. */
  label?: string
  /** Declared third-party services/scripts in this category. */
  services?: ServiceDeclaration[]
}

// ---------------------------------------------------------------------------
// String table — every user-visible and ARIA string
// ---------------------------------------------------------------------------

export interface StringTable {
  // Banner first layer
  bannerTitle: string
  bannerDescription: string
  acceptAllLabel: string
  rejectAllLabel: string
  managePreferencesLabel: string
  // Preferences modal
  preferencesTitle: string
  savePreferencesLabel: string
  closeLabel: string
  // GPC toast
  gpcNoticeText: string
  // Withdrawal prompt
  withdrawalPromptText: string
  reloadLabel: string
  // Persistent re-open link
  reopenLabel: string
  // ARIA labels
  'aria-banner': string
  'aria-preferences-modal': string
  'aria-close': string
  'aria-accept-all': string
  'aria-reject-all': string
  'aria-manage-preferences': string
  'aria-save-preferences': string
  /** `{label}` is replaced with the category label at render time. */
  'aria-category-toggle': string
}

export const DEFAULT_STRINGS: StringTable = {
  bannerTitle: 'We use cookies',
  bannerDescription: 'This site uses cookies and similar technologies to improve your experience.',
  acceptAllLabel: 'Accept all',
  rejectAllLabel: 'Reject all',
  managePreferencesLabel: 'Manage preferences',
  preferencesTitle: 'Cookie preferences',
  savePreferencesLabel: 'Save preferences',
  closeLabel: 'Close',
  gpcNoticeText: 'Your privacy preference (Global Privacy Control) was detected and applied.',
  withdrawalPromptText:
    'Your preferences have been saved. Scripts that already ran this session keep running until you reload the page.',
  reloadLabel: 'Reload page',
  reopenLabel: 'Cookie settings',
  'aria-banner': 'Cookie consent banner',
  'aria-preferences-modal': 'Cookie preferences',
  'aria-close': 'Close',
  'aria-accept-all': 'Accept all cookies',
  'aria-reject-all': 'Reject all cookies',
  'aria-manage-preferences': 'Manage cookie preferences',
  'aria-save-preferences': 'Save cookie preferences',
  'aria-category-toggle': 'Toggle {label} cookies',
}

// ---------------------------------------------------------------------------
// Theme options
// ---------------------------------------------------------------------------

export interface ThemeOptions {
  primaryColor?: string
  backgroundColor?: string
  textColor?: string
  borderRadius?: string
  fontFamily?: string
  zIndex?: number
}

// ---------------------------------------------------------------------------
// Cookie write options
// ---------------------------------------------------------------------------

export interface CookieOptions {
  /** Restrict the consent cookie to a specific domain. */
  domain?: string
  /** Days until re-prompt. Default: 365. */
  expiryDays?: number
}

// ---------------------------------------------------------------------------
// Main config type
// ---------------------------------------------------------------------------

export interface CookyayConfig {
  /** Bump when cookie usage changes materially — triggers re-prompt for returning visitors. */
  policyVersion: string
  /** Per-category label and services declarations. */
  categories?: Partial<Record<CategoryId, CategoryConfig>>
  /** Override any user-visible or ARIA string. English defaults used for omitted keys. */
  strings?: Partial<StringTable>
  /** Visual theme overrides. */
  theme?: ThemeOptions
  /**
   * `true` renders the first-layer banner as a focus-trapped modal (blocks interaction).
   * Default: non-modal dialog (compliant posture; consent walls are prohibited under GDPR
   * unless a genuine no-tracking alternative is offered).
   */
  modal?: boolean
  /** Consent cookie write options (domain, expiry). */
  cookie?: CookieOptions
  /** Verbose init logging to console. */
  debug?: boolean
  /**
   * Set `false` to suppress the auto-injected persistent "Cookie settings" re-open link.
   * Default: true (auto-inject).
   */
  autoOpenLink?: boolean
  /**
   * Enable runtime auto-blocking of known third-party scripts and iframes.
   *
   * When `true`, the banner intercepts `document.createElement`/`setAttribute` calls
   * and blocks recognised third-party scripts/iframes (from the bundled ~50-service
   * signature DB) until the matching consent category is granted — even when those
   * scripts are NOT declared in your `categories` config.
   *
   * **Requires "Cookyay first in `<head>`"** — any `<script src>` placed in HTML
   * *before* the Cookyay bootstrap cannot be blocked. This is a hard install
   * requirement when `autoBlock: true`. [goals.md §Interception mechanism]
   *
   * **Google-owned services (GTM, GA4, reCAPTCHA) are never auto-blocked** —
   * the existing Consent Mode v2 integration degrades them instead. Blocking GTM
   * would suppress all CM v2 `update` signals. [prd.md §3.4, goals.md §Consent Mode v2]
   *
   * When `false` or omitted (the default), the signature DB and matcher
   * **tree-shake to zero bytes** in the bundle — existing installs are byte-for-byte
   * unaffected. Declared rules (the `categories` config) always win over auto-detected
   * ones regardless of this flag. [goals.md §Auto-block is opt-in, research/_index.md §Update]
   *
   * Default: `false`.
   */
  autoBlock?: boolean
  /**
   * Called after a consent withdrawal is detected (at least one previously-granted
   * non-necessary category has been revoked via the preferences modal).
   *
   * Receives the list of revoked CategoryIds. Use this to expire first-party cookies
   * written by your own code for those categories. Third-party script state cannot be
   * cleared programmatically — the "reload required" prompt tells visitors this honestly.
   *
   * The callback fires AFTER the new consent record is written and events are dispatched,
   * but BEFORE the "reload recommended" toast is shown.
   *
   * Example:
   * ```js
   * clearOnWithdraw(revoked) {
   *   if (revoked.includes('analytics')) {
   *     document.cookie = '_ga=; Max-Age=0; Path=/'
   *   }
   * }
   * ```
   */
  clearOnWithdraw?: (revoked: CategoryId[]) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the full string table with user overrides merged over English defaults. */
export function resolveStrings(overrides?: Partial<StringTable>): StringTable {
  return { ...DEFAULT_STRINGS, ...overrides }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ConfigWarning {
  /** Machine-readable code for programmatic handling. */
  code: string
  /** Human-readable message for console output. */
  message: string
  /** `true` for issues that prevent init from proceeding. */
  fatal?: boolean
}

const KNOWN_CATEGORIES = new Set<string>(['necessary', 'functional', 'analytics', 'marketing'])

/** Validate a config object and return any warnings (empty array = valid). */
export function validateConfig(config: CookyayConfig): ConfigWarning[] {
  const warnings: ConfigWarning[] = []

  if (!config.policyVersion || typeof config.policyVersion !== 'string') {
    warnings.push({
      code: 'MISSING_POLICY_VERSION',
      message: 'policyVersion is required and must be a non-empty string.',
      fatal: true,
    })
  }

  if (config.autoBlock !== undefined && typeof config.autoBlock !== 'boolean') {
    warnings.push({
      code: 'INVALID_AUTO_BLOCK',
      message: `autoBlock must be a boolean (true | false) — received ${JSON.stringify(config.autoBlock)}. Defaulting to false.`,
    })
  }

  if (config.categories) {
    for (const key of Object.keys(config.categories)) {
      if (!KNOWN_CATEGORIES.has(key)) {
        warnings.push({
          code: 'UNKNOWN_CATEGORY',
          message: `categories["${key}"] is not a known category (necessary | functional | analytics | marketing) — it will be ignored.`,
        })
      }
    }

    // Warn on categories with no declared services (empty toggle)
    for (const [key, cfg] of Object.entries(config.categories)) {
      if (
        KNOWN_CATEGORIES.has(key) &&
        key !== 'necessary' &&
        cfg &&
        (!cfg.services || cfg.services.length === 0)
      ) {
        warnings.push({
          code: 'EMPTY_CATEGORY',
          message: `categories["${key}"] has no declared services — visitors will see an empty toggle.`,
        })
      }
    }
  }

  return warnings
}
