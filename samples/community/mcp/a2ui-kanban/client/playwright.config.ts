/*
 * Copyright 2024 Google LLC
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

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
    },
  ],
  webServer: [
    {
      command: 'npm --prefix ../mcp-server start',
      port: 8788,
      reuseExistingServer: true,
    },
    {
      command: 'KANBAN_AGENT=scripted uv run --directory ../agent python . --port 10008',
      url: 'http://localhost:10008/.well-known/agent-card.json',
      reuseExistingServer: true,
    },
    {
      command: 'npm run dev -- --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
  ],
});
