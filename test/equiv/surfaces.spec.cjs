const { test, expect } = require('@playwright/test')

// The local stack seeds local-admin-key as a super-admin. That fixture is
// only usable against a loopback target; a non-local BASE_OLD/BASE_NEW must
// supply EQUIV_KEY explicitly, so a live run can never fall back to a
// privileged local credential.
const LOCAL_FIXTURE_ORIGINS = new Set([
  'http://localhost:8080',
  'http://localhost:5173',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:5173',
])

async function login(page) {
  const configured = test.info().project.use?.baseURL
  if (!configured) throw new Error('a project baseURL is required')
  const expectedOrigin = new URL(configured).origin
  await page.goto('/login')
  const origin = new URL(page.url()).origin
  // Refuse cross-origin redirects before the credential is typed.
  if (origin !== expectedOrigin) {
    throw new Error(`login left the configured base (${origin} != ${expectedOrigin})`)
  }
  // The seeded fixture needs an explicit opt-in and must stay on a default
  // local origin; every other target must supply EQUIV_KEY.
  const fixtureAllowed =
    process.env.EQUIV_LOCAL_FIXTURE === '1' && LOCAL_FIXTURE_ORIGINS.has(origin)
  const key = process.env.EQUIV_KEY || (fixtureAllowed ? 'local-admin-key' : '')
  if (!key) {
    throw new Error('EQUIV_KEY is required for non-local targets')
  }
  const input = page.locator('input[name="api_key"], input#api_key').first()
  await input.waitFor()
  await input.fill(key)
  await input.press('Enter')
  try {
    await page.waitForURL('**/dashboard', { timeout: 8_000 })
  } catch {
    await page
      .locator('form button[type="submit"], form input[type="submit"], button:has-text("Log In")')
      .first()
      .click()
    await page.waitForURL('**/dashboard', { timeout: 20_000 })
  }
}

async function shot(page, testInfo, name) {
  // Attach authenticated pages only for the local fixture run; a live run
  // produces no page captures at all.
  if (process.env.EQUIV_LOCAL_FIXTURE !== '1') return
  const body = await page.screenshot({ fullPage: true })
  await testInfo.attach(name, { body, contentType: 'image/png' })
}

test('login lands on the usage dashboard', async ({ page }, testInfo) => {
  await login(page)
  await expect(page.getByText(/Total Requests/i).first()).toBeVisible()
  await expect(page.getByText(/Recent Activity/i).first()).toBeVisible()
  await shot(page, testInfo, 'dashboard')
})

test('dashboard time filter responds', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: '7d', exact: true }).first().click()
  await page.waitForTimeout(1_500)
  await expect(page.getByText(/Total Requests/i).first()).toBeVisible()
})

test('manager org view renders', async ({ page }, testInfo) => {
  await login(page)
  await page.goto('/manager')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/view|usage/i)
  await expect(page.getByText(/budget/i).first()).toBeVisible()
  await shot(page, testInfo, 'manager')
})

test('admin tabs render read-only', async ({ page }, testInfo) => {
  await login(page)
  await page.goto('/admin')
  await expect(page.getByText('Safety Net', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Model pricing', { exact: true }).first()).toBeVisible()
  await shot(page, testInfo, 'admin')
})

test('pricing dialog opens', async ({ page }, testInfo) => {
  await login(page)
  await page.getByRole('button', { name: 'Pricing', exact: true }).first().click()
  await expect(page.getByText(/Model pricing/i).first()).toBeVisible()
  await shot(page, testInfo, 'pricing')
})

test('view-as confirmation opens', async ({ page }, testInfo) => {
  await login(page)
  await page
    .locator('a:has-text("My view as user"), button:has-text("My view as user")')
    .first()
    .click()
  await expect(page.getByText(/View personal usage as/i).first()).toBeVisible()
  await shot(page, testInfo, 'view-as')
})

test('keys surface renders', async ({ page }, testInfo) => {
  test.skip(test.info().project.name === 'old', 'local old UI redirects /management to /account')
  await login(page)
  await page.goto('/management')
  await expect(page.getByText(/My keys/i).first()).toBeVisible()
  await expect(page.getByText(/Create key/i).first()).toBeVisible()
  await shot(page, testInfo, 'keys')
})
