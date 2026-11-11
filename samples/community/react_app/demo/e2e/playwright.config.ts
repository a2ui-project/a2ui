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

/**
 * Playwright config of the demo e2e tests. Two modes:
 * - recorded (default): the agent replays e2e/recordings/, so runs are deterministic and need no
 *   API key;
 * - live (DEMO_E2E_MODE=live): the agent calls gemini-3.5-flash and saves every response to
 *   results/live-recordings.json, which can be promoted to recordings/.
 * Both start their own agent and client on ports that don't clash with `node demo/start.mjs`.
 */
import {defineConfig, devices} from '@playwright/test';

const live = process.env['DEMO_E2E_MODE'] === 'live';
const AGENT_PORT = Number(process.env['DEMO_E2E_AGENT_PORT'] ?? 8797);
const CLIENT_PORT = Number(process.env['DEMO_E2E_CLIENT_PORT'] ?? 5397);
process.env['DEMO_E2E_RUN_ID'] ??= new Date().toISOString();

// DEMO_E2E_RECORDINGS replays another directory, for example to rerun a failed live response.
const recordings = process.env['DEMO_E2E_RECORDINGS'] ?? '../e2e/recordings';
const agentArgs = live
  ? '--record ../e2e/results/live-recordings.json --log-file ../e2e/results/agent-live.log'
  : `--replay ${recordings} --log-file ../e2e/results/agent-recorded.log`;

export default defineConfig({
  testDir: './tests',
  timeout: live ? 240_000 : 90_000,
  expect: {timeout: live ? 20_000 : 10_000},
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', {open: 'never'}]],
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    viewport: {width: 1280, height: 900},
    video: {mode: 'on', size: {width: 1280, height: 900}},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 900}}},
  ],
  webServer: [
    {
      command: `uv run react-app-demo-agent --port ${AGENT_PORT} ${agentArgs}`,
      cwd: '../agent',
      url: `http://127.0.0.1:${AGENT_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      // The agent logs JSON lines to results/agent-*.log.
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: 'yarn dev',
      cwd: '../client',
      url: `http://127.0.0.1:${CLIENT_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DEMO_CLIENT_PORT: String(CLIENT_PORT),
        DEMO_AGENT_URL: `http://127.0.0.1:${AGENT_PORT}`,
      },
    },
  ],
});
