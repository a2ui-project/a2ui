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

const isCi = Boolean(process.env['CI']);

/**
 * The e2e suite drives the three live services of the sample: the MCP server
 * (`:8788`), the scripted agent (`:10008`, no model, deterministic replies)
 * and the Vite dev server of this chat host (`:5173`). Each is started here
 * unless it is already listening, which lets a developer keep `yarn dev`
 * running; CI (`community_code.yml`) builds the MCP server and syncs the
 * agent before `yarn test:e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: isCi ? 2 : 0,
  reporter: isCi ? [['list'], ['html', {open: 'never'}]] : 'list',
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
      command: 'yarn workspace a2ui-kanban-mcp-server start',
      port: 8788,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'KANBAN_AGENT=scripted uv run --directory ../agent python . --port 10008',
      url: 'http://localhost:10008/.well-known/agent-card.json',
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: 'yarn dev --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
