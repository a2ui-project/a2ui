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

const HOST_PORT = Number(process.env['REACT_APP_FIXTURE_PORT'] ?? 47317);
const RUNTIME_PORT = HOST_PORT + 1;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${HOST_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: {
    command: 'node e2e/server.mjs',
    url: `http://127.0.0.1:${HOST_PORT}/`,
    reuseExistingServer: false,
    env: {HOST_PORT: String(HOST_PORT), RUNTIME_PORT: String(RUNTIME_PORT)},
  },
});
