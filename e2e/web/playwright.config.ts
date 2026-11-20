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

/**
 * The live pairs: each project is one shell talking to one test agent in one inference
 * format. The agents and the shells are started as web servers, one process each, and every
 * test runs against all four projects.
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {defineConfig} from '@playwright/test';

import type {PairOptions} from './tests/fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const scenarioDirs = [path.join(repoRoot, 'conformance', 'e2e'), path.join(here, 'scenarios')];

/** The streaming pause, long enough for a page to be observed between frames. */
const CHUNK_DELAY_MS = 20;

/** How long the agents take to answer `lookupPrice`, so a page shows the pending binding. */
const RPC_DELAY_MS = 250;

const SHELL_PORT = 5174;
const PORTS = {
  python: {direct_json: 10101, express: 10102},
  typescript: {direct_json: 10201, express: 10202},
} as const;

function agentArgs(port: number, format: string): string {
  const dirs = scenarioDirs.map(dir => `--scenario-dir ${dir}`).join(' ');
  return (
    `--port ${port} --format ${format} ${dirs} ` +
    `--chunk-delay-ms ${CHUNK_DELAY_MS} --rpc-delay-ms ${RPC_DELAY_MS}`
  );
}

function pythonAgent(format: 'direct_json' | 'express') {
  const port = PORTS.python[format];
  return {
    command: `uv run --project ${repoRoot} python -m a2ui_e2e_agent ${agentArgs(port, format)}`,
    url: `http://localhost:${port}/.well-known/agent-card.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  };
}

function typescriptAgent(format: 'direct_json' | 'express') {
  const port = PORTS.typescript[format];
  const main = path.join(here, '..', 'agents', 'typescript', 'dist', 'src', 'main.js');
  return {
    command: `node ${main} ${agentArgs(port, format)}`,
    url: `http://localhost:${port}/.well-known/agent-card.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  };
}

function pair(
  agent: keyof typeof PORTS,
  shell: PairOptions['shell'],
  format: 'direct_json' | 'express',
): {name: string; use: PairOptions} {
  return {
    name: `${agent === 'python' ? 'py' : 'ts'}-${shell}-${format}`,
    use: {
      shell,
      format,
      agent,
      agentUrl: `http://localhost:${PORTS[agent][format]}/`,
      shellUrl: `http://localhost:${SHELL_PORT}/${shell}.html`,
    },
  };
}

export default defineConfig<PairOptions>({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
  timeout: 60_000,
  expect: {timeout: 15_000},
  use: {
    trace: 'on-first-retry',
    browserName: 'chromium',
  },
  projects: [
    pair('python', 'lit', 'direct_json'),
    pair('python', 'lit', 'express'),
    pair('typescript', 'react', 'direct_json'),
    pair('typescript', 'react', 'express'),
  ],
  webServer: [
    pythonAgent('direct_json'),
    pythonAgent('express'),
    typescriptAgent('direct_json'),
    typescriptAgent('express'),
    {
      command: `yarn vite preview --port ${SHELL_PORT} --strictPort`,
      url: `http://localhost:${SHELL_PORT}/lit.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
