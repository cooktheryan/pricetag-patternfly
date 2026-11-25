const { defineConfig, devices } = require('@playwright/test')

// Dual-target equivalence suite:
//   BASE_OLD  the legacy gateway UI (default: the local standalone stack)
//   BASE_NEW  the PatternFly SPA (default: the Vite dev server)
// Live runs should set BASE_OLD=https://32.198.91.108:8443 and BASE_NEW to
// the Route, with EQUIV_KEY pointing at a read-only key.
const localRun = process.env.EQUIV_LOCAL_FIXTURE === '1'

module.exports = defineConfig({
  testDir: './test/equiv',
  outputDir: './test-results/artifacts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/equiv-report', open: 'never' }],
  ],
  use: {
    ignoreHTTPSErrors: true,
    // Artifacts that can contain authenticated pages are local-only. A live
    // run (EQUIV_KEY without EQUIV_LOCAL_FIXTURE=1) produces no screenshots;
    // tracing is always off because it would capture the login POST body.
    screenshot: localRun ? 'only-on-failure' : 'off',
    trace: 'off',
  },
  projects: [
    {
      name: 'old',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_OLD || 'http://localhost:8080',
      },
    },
    {
      name: 'new',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_NEW || 'http://localhost:5173',
      },
    },
  ],
})
