/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {defineConfig, devices} from '@playwright/test';

/**
 * Starts the agent and the client on their own ports so the suite doesn't
 * clash with dev servers. `yarn test:e2e` runs the agent in scripted mode;
 * `yarn test:e2e:live` runs it against Gemini and needs GEMINI_API_KEY.
 */
const live = process.env.LINER_NOTES_E2E === 'live';
const apiPort = 8101;
const webPort = 5181;

export default defineConfig({
  testDir: './e2e',
  testMatch: live ? 'live.spec.ts' : 'scripted.spec.ts',
  timeout: live ? 120_000 : 30_000,
  workers: live ? 3 : undefined,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    viewport: {width: 1400, height: 1000},
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: [
    {
      command: `uv run uvicorn liner_notes.server:app --port ${apiPort}`,
      cwd: '../agent',
      url: `http://localhost:${apiPort}/api/info`,
      env: live ? {} : {LINER_NOTES_MODE: 'scripted'},
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'yarn vite',
      url: `http://localhost:${webPort}`,
      env: {LINER_NOTES_API_PORT: String(apiPort), LINER_NOTES_WEB_PORT: String(webPort)},
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
