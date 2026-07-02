import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './.playwright/results',
  reporter: [['list'], ['html', {outputFolder: './.playwright/report', open: 'never'}]],
  use: {
    baseURL: 'http://localhost:4200',
    headless: true,
    launchOptions: {
      executablePath: '/usr/bin/google-chrome',
    },
    actionTimeout: 2000,
  },
  webServer: {
    command: 'node scripts/closure-compiler/serve-dist.mjs',
    url: 'http://localhost:4200',
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath:
            '/usr/local/google/home/dit/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
        },
      },
    },
  ],
});
