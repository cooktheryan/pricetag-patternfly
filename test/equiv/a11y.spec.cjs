const { test, expect } = require('@playwright/test')
const AxeBuilder = require('@axe-core/playwright').default
const { login } = require('./helpers.cjs')

function serious(violations) {
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id}: ${violation.help} [${violation.nodes
          .map((node) => node.target.join(' '))
          .join(' | ')}]`,
    )
}

test('login page has no serious accessibility violations', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'new', 'axe covers the SPA')
  await page.goto('/login')
  const results = await new AxeBuilder({ page }).analyze()
  expect(serious(results.violations)).toEqual([])
})

test('authenticated surfaces have no serious accessibility violations', async (
  { page },
  testInfo,
) => {
  test.skip(testInfo.project.name !== 'new', 'axe covers the SPA')
  await login(page)
  for (const path of ['/dashboard', '/manager', '/management', '/admin']) {
    await page.goto(path)
    await page.waitForTimeout(1_200)
    const results = await new AxeBuilder({ page }).analyze()
    const bad = serious(results.violations)
    expect(bad, `${path}: ${bad.join('; ')}`).toEqual([])
  }
})
