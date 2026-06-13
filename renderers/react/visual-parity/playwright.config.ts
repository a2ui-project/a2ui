/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {defineConfig, devices} from '@playwright/test';

/**
 * Playwright configuration for A2UI visual parity tests.
 *
 * These tests compare screenshots of the same components rendered by
 * both React and Lit renderers to ensure visual consistency.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [['html', {open: 'never'}], ['list']],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: {width: 1280, height: 720},
      },
    },
  ],

  // Start both React and Lit dev servers.
  // Invoke vite directly rather than via `yarn dev:*`: the yarn wrapper spawns
  // vite as a grandchild process that Playwright's teardown fails to kill,
  // leaving orphaned dev servers that keep `playwright test` (and the
  // consolidated `yarn test:all`) hanging until the job timeout. Running vite
  // directly lets Playwright terminate the server cleanly so the run exits.
  webServer: [
    {
      command: 'vite --config react/vite.config.ts --port 5001',
      url: 'http://localhost:5001',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      command: 'vite --config lit/vite.config.ts --port 5002',
      url: 'http://localhost:5002',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],

  expect: {
    toHaveScreenshot: {
      // Strict by default - individual tests override as needed
      maxDiffPixels: 0,
      threshold: 0.1,
    },
  },
});
