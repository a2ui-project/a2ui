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
