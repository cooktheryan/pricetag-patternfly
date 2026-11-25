const { test, expect } = require('@playwright/test')
const { login, shot } = require('./helpers.cjs')

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
  await login(page)
  await page.goto('/management')
  await expect(page.getByText(/My keys/i).first()).toBeVisible()
  await expect(page.getByText(/Create key/i).first()).toBeVisible()
  await shot(page, testInfo, 'keys')
})
