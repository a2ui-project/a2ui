#!/usr/bin/env node
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
 * Starts the demo: the agent (uv) and the client (Vite), and stops both on Ctrl+C.
 *
 *   node demo/start.mjs            # live: calls gemini-3.5-flash, needs GEMINI_API_KEY
 *   node demo/start.mjs --replay   # replays demo/e2e/recordings, no key needed
 *   node demo/start.mjs --host 0.0.0.0   # also reachable by machine name, e.g. from a laptop
 *
 * Builds the ReactApp packages first if their output is missing.
 */
import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {hostname} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const demoDir = dirname(fileURLToPath(import.meta.url));
const projectDir = join(demoDir, '..');
const replay = process.argv.includes('--replay');
const agentPort = process.env.DEMO_AGENT_PORT ?? '8787';
const clientPort = process.env.DEMO_CLIENT_PORT ?? '5317';
const hostFlag = process.argv.indexOf('--host');
const clientHost =
  hostFlag >= 0 ? process.argv[hostFlag + 1] : (process.env.DEMO_CLIENT_HOST ?? '127.0.0.1');
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(clientHost);
if (!clientHost || clientHost.startsWith('--')) {
  console.error('--host needs an address, for example --host 0.0.0.0');
  process.exit(2);
}

if (!replay && !process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set. Set it, or run with --replay for recorded answers.');
  process.exit(1);
}

const built = [
  'typescript/react_app/dist/sandbox/sandbox.html',
  'typescript/react_app_runtime/dist/v1/manifest.json',
];
if (!built.every(file => existsSync(join(projectDir, file)))) {
  console.log('Building the ReactApp packages (yarn build)…');
  const result = spawnSync('yarn', ['build'], {cwd: projectDir, stdio: 'inherit'});
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const agentArgs = ['run', 'react-app-demo-agent', '--port', agentPort];
if (replay) {
  agentArgs.push('--replay', join(demoDir, 'e2e', 'recordings'));
}

const children = [
  spawn('uv', agentArgs, {cwd: join(demoDir, 'agent'), stdio: 'inherit'}),
  spawn('yarn', ['dev'], {
    cwd: join(demoDir, 'client'),
    stdio: 'inherit',
    env: {
      ...process.env,
      DEMO_CLIENT_HOST: clientHost,
      DEMO_CLIENT_PORT: clientPort,
      DEMO_AGENT_URL: `http://127.0.0.1:${agentPort}`,
    },
  }),
];

// The agent stays on loopback; the browser reaches it through the client's /api proxy.
const anyInterface = clientHost === '0.0.0.0' || clientHost === '::';
const shownHost = loopback ? '127.0.0.1' : anyInterface ? hostname() : clientHost;
console.log(
  `\nMargin demo (${replay ? 'recorded answers' : 'live model'}): http://${shownHost}:${clientPort}/\n`,
);

const stop = () => {
  for (const child of children) {
    child.kill('SIGTERM');
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('exit', code => {
    if (code) {
      console.error(`A demo process exited with code ${code}; stopping.`);
    }
    stop();
    process.exitCode = code ?? 0;
  });
}
