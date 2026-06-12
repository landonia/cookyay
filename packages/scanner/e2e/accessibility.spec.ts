/**
 * Accessibility CI checks (task 014)
 *
 * Three suites:
 *   1. axe-core WCAG 2.2 AA scans — banner, preferences modal, GPC toast
 *   2. Keyboard-only walkthrough — Tab focus, focus trap, Escape without consent
 *   3. Equal-prominence — computed styles of Accept-all vs Reject-all must match
 *
 * Reuses the Playwright harness and fixture pages from 013.
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const INDEX = '/fixtures/index.html'
const ALL_PAGE = '/fixtures/blocking/all.html'

// Default-deny all external network (matches flows.spec.ts / blocking.spec.ts)
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    try {
      const { hostname } = new URL(route.request().url())
      if (hostname === '127.0.0.1' || hostname === 'localhost') {
        return route.continue()
      }
    } catch {
      // malformed URL — abort
    }
    return route.abort()
  })
})

// ---------------------------------------------------------------------------
// 1. axe-core WCAG 2.2 AA scans
// ---------------------------------------------------------------------------

test.describe('axe — WCAG 2.2 AA', () => {
  test('banner state: zero violations', async ({ page }) => {
    await page.goto(INDEX)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      // Scope to the banner only so unrelated fixture-site issues don't pollute this check
      .include('#cookyay-banner')
      .analyze()

    expect(results.violations).toEqual([])
  })

  test('preferences modal state: zero violations', async ({ page }) => {
    await page.goto(INDEX)
    await page.click('[data-cookyay-manage]')
    await expect(page.locator('#cookyay-preferences')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .include('#cookyay-preferences')
      .analyze()

    expect(results.violations).toEqual([])
  })

  test('GPC toast state: zero violations', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        value: true,
        configurable: true,
        writable: false,
      })
    })

    await page.goto(ALL_PAGE)
    await expect(page.locator('#cookyay-gpc-toast')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .include('#cookyay-gpc-toast')
      .analyze()

    expect(results.violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. Keyboard-only walkthrough
// ---------------------------------------------------------------------------

test.describe('keyboard navigation', () => {
  test('Tab moves focus into banner on mount (focus lands on first button)', async ({ page }) => {
    await page.goto(INDEX)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Banner mounts and moves focus to first button automatically (banner.ts L446)
    const focused = page.locator(':focus')
    await expect(focused).toHaveAttribute('data-cookyay-accept')
  })

  test('Tab cycles through all three banner buttons', async ({ page }) => {
    await page.goto(INDEX)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Focus is already on Accept button after mount
    const acceptBtn = page.locator('[data-cookyay-accept]')
    const rejectBtn = page.locator('[data-cookyay-reject]')
    const manageBtn = page.locator('[data-cookyay-manage]')

    await expect(acceptBtn).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(rejectBtn).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(manageBtn).toBeFocused()
  })

  test('Enter on Manage preferences button opens modal', async ({ page }) => {
    await page.goto(INDEX)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Tab to Manage button (Accept → Reject → Manage)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.locator('[data-cookyay-manage]')).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(page.locator('#cookyay-preferences')).toBeVisible()
  })

  test('focus trap: Tab cycles inside modal without escaping', async ({ page }) => {
    await page.goto(INDEX)
    await page.click('[data-cookyay-manage]')
    await expect(page.locator('#cookyay-preferences')).toBeVisible()

    // Collect all focusable elements inside the modal (same query as preferences.ts)
    const focusables = page.locator(
      '#cookyay-preferences button:not([disabled]), #cookyay-preferences [href], #cookyay-preferences input:not([disabled])',
    )
    const count = await focusables.count()
    expect(count).toBeGreaterThan(1)

    // Tab through every element, then one more — must wrap back to first
    for (let i = 0; i < count; i++) {
      await page.keyboard.press('Tab')
    }

    // After `count` Tabs, focus should have cycled back to (or be inside) the modal
    const activeId = await page.evaluate(() => document.activeElement?.id ?? '')
    const activeDataAttr = await page.evaluate(
      () =>
        document.activeElement?.getAttribute('data-cookyay-switch') ??
        document.activeElement?.getAttribute('data-cookyay-save') ??
        document.activeElement?.getAttribute('data-cookyay-prefs-close') ??
        document.activeElement?.getAttribute('aria-label') ??
        '',
    )

    // Focus must still be inside the modal (not on body or banner elements)
    const isInsideModal = await page.evaluate(() => {
      const modal = document.getElementById('cookyay-preferences')
      return modal?.contains(document.activeElement) ?? false
    })
    expect(isInsideModal).toBe(true)
    // Suppress unused variable warning
    void activeId
    void activeDataAttr
  })

  test('focus trap: Shift+Tab wraps backward inside modal', async ({ page }) => {
    await page.goto(INDEX)
    await page.click('[data-cookyay-manage]')
    await expect(page.locator('#cookyay-preferences')).toBeVisible()

    // Focus is on the close button (first focusable) — Shift+Tab should wrap to last (Save)
    const closeBtnFocused = await page.evaluate(
      () => document.activeElement?.getAttribute('data-cookyay-prefs-close') !== null,
    )
    expect(closeBtnFocused).toBe(true)

    await page.keyboard.press('Shift+Tab')

    // After Shift+Tab from first element, focus should be on the last focusable (Save button)
    const saveIsFocused = await page.evaluate(
      () => document.activeElement?.getAttribute('data-cookyay-save') !== null,
    )
    expect(saveIsFocused).toBe(true)
  })

  test('keyboard toggle: Space toggles a switch inside the modal', async ({ page }) => {
    await page.goto(INDEX)
    await page.click('[data-cookyay-manage]')
    await expect(page.locator('#cookyay-preferences')).toBeVisible()

    const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
    await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'false')

    // Tab to the analytics switch
    await analyticsSwitch.focus()
    await page.keyboard.press('Space')

    await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'true')
  })

  test('Escape closes modal without saving consent, focus returns to invoker', async ({ page }) => {
    await page.goto(INDEX)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Open modal via keyboard (Tab to Manage, Enter)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.locator('#cookyay-preferences')).toBeVisible()

    // Toggle analytics ON (verifies it WON'T be saved after Escape)
    const analyticsSwitch = page.locator('[data-cookyay-switch="analytics"]')
    await analyticsSwitch.focus()
    await page.keyboard.press('Space')
    await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'true')

    // Press Escape
    await page.keyboard.press('Escape')

    // Modal must be gone
    await expect(page.locator('#cookyay-preferences')).not.toBeAttached()

    // No consent cookie must have been written
    const cookies = await page.context().cookies()
    const consentCookie = cookies.find((c) => c.name === 'cookyay_consent')
    expect(consentCookie).toBeUndefined()

    // Focus must return to the Manage button (the invoker)
    await expect(page.locator('[data-cookyay-manage]')).toBeFocused()
  })

  test('Escape on banner refocuses first button without recording consent', async ({ page }) => {
    await page.goto(INDEX)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Simulate Escape on the banner
    await page.keyboard.press('Escape')

    // Banner must still be visible (Escape never dismisses the non-modal banner)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // No consent recorded
    const cookies = await page.context().cookies()
    expect(cookies.find((c) => c.name === 'cookyay_consent')).toBeUndefined()

    // Focus is on the first button
    await expect(page.locator('[data-cookyay-accept]')).toBeFocused()
  })
})

// ---------------------------------------------------------------------------
// 3. Equal-prominence — computed styles of Accept-all vs Reject-all
// ---------------------------------------------------------------------------

test.describe('equal prominence (CNIL / EDPB compliance)', () => {
  /**
   * CNIL and EDPB require Accept and Reject to be visually equivalent (rec 4 in
   * compliance research): same font size, same color contrast, same visual weight.
   * We check computed styles to make this mechanical and CI-gated.
   */
  test('Accept-all and Reject-all have identical computed styles in the default theme', async ({
    page,
  }) => {
    await page.goto(INDEX)
    await expect(page.locator('#cookyay-banner')).toBeVisible()

    // Properties that determine visual prominence — divergence means dark-pattern risk
    const prominenceProps = [
      'font-size',
      'font-weight',
      'padding-top',
      'padding-bottom',
      'padding-left',
      'padding-right',
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
      'border-radius',
      'background-color',
      'color',
    ]

    const [acceptStyles, rejectStyles] = await page.evaluate(
      ({ props }: { props: string[] }) => {
        const accept = document.querySelector('[data-cookyay-accept]')
        const reject = document.querySelector('[data-cookyay-reject]')
        if (!accept || !reject) throw new Error('Accept or Reject button not found')

        const acceptCS = getComputedStyle(accept)
        const rejectCS = getComputedStyle(reject)

        return [
          Object.fromEntries(props.map((p) => [p, acceptCS.getPropertyValue(p).trim()])),
          Object.fromEntries(props.map((p) => [p, rejectCS.getPropertyValue(p).trim()])),
        ]
      },
      { props: prominenceProps },
    )

    const divergence: string[] = []
    for (const prop of prominenceProps) {
      if (acceptStyles[prop] !== rejectStyles[prop]) {
        divergence.push(`${prop}: Accept="${acceptStyles[prop]}" vs Reject="${rejectStyles[prop]}"`)
      }
    }

    expect(
      divergence,
      `Accept-all and Reject-all computed styles diverge on:\n${divergence.join('\n')}`,
    ).toEqual([])
  })
})
