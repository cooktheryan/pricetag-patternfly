const { test } = require('@playwright/test')

// The local stack seeds local-admin-key as a super-admin. The fixture needs
// an explicit opt-in and must stay on a default local origin; every other
// target must supply EQUIV_KEY.
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

module.exports = { login, shot }
