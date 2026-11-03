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

/** Starts the scripted test agent: `node dist/src/main.js --port 10011 --format express`. */

import fs from 'fs';
import {parseArgs} from 'util';
import {pathToFileURL} from 'url';

import {createServer, DEFAULT_SCENARIO_DIR, FORMATS, type ServerConfig} from './server.js';

const USAGE = `Usage: a2ui-e2e-agent [options]

  --port <n>             The port to listen on (default 10011).
  --format <name>        The scenario format to stream: ${Object.keys(FORMATS).join(' | ')} (default direct_json).
  --scenario-dir <path>  The directory of e2e scenario YAML files (default ${DEFAULT_SCENARIO_DIR}).
  --chunk-delay-ms <n>   The pause before each streamed model chunk (default 0).
  --rpc-delay-ms <n>     How long the lookupPrice agent function takes to answer (default 0).
  --help                 Show this help.`;

function integer(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer, got '${value}'.`);
  }
  return parsed;
}

/** Parses the command line into a server config, or returns null when help was asked for. */
export function parseCommandLine(argv: readonly string[]): ServerConfig | null {
  const {values} = parseArgs({
    args: [...argv],
    options: {
      port: {type: 'string'},
      format: {type: 'string'},
      'scenario-dir': {type: 'string'},
      'chunk-delay-ms': {type: 'string'},
      'rpc-delay-ms': {type: 'string'},
      help: {type: 'boolean'},
    },
    strict: true,
  });
  if (values.help) return null;
  const format = values.format ?? 'direct_json';
  if (!(format in FORMATS)) {
    throw new Error(`--format must be one of ${Object.keys(FORMATS).join(', ')}, got '${format}'.`);
  }
  return {
    port: integer('port', values.port, 10011),
    format,
    scenarioDir: values['scenario-dir'] ?? DEFAULT_SCENARIO_DIR,
    chunkDelayMs: integer('chunk-delay-ms', values['chunk-delay-ms'], 0),
    rpcDelayMs: integer('rpc-delay-ms', values['rpc-delay-ms'], 0),
  };
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  let config: ServerConfig | null;
  try {
    config = parseCommandLine(argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (config === null) {
    console.log(USAGE);
    return;
  }
  const {app, format} = createServer(config);
  const port = config.port ?? 10011;
  app.listen(port, '0.0.0.0', () => {
    console.log(`A2UI E2E test agent (TypeScript) listening on http://localhost:${port}/`);
    console.log(`Format: ${format}`);
    console.log(`Scenarios: ${config.scenarioDir}`);
    console.log(`Request log: http://localhost:${port}/e2e/log`);
  });
}

// Serve only when run directly, so tests can import createServer.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
