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
 * Long-running compile worker: one JSON request per line on stdin, one JSON response per line on
 * stdout, in order.
 *
 * Requests:
 *   {"id": 1, "op": "compile", "source": "...", "bindings": "...", "skipTypeCheck": false}
 *   {"id": 2, "op": "ping"}
 *
 * Responses carry the request `id` and either the `CompileResult` fields or `{"error": "..."}`.
 * The worker warms the language service at start, so the first real request is fast too.
 */

import {createInterface} from 'node:readline';

import {createReactAppCompiler} from './compiler.js';

const compiler = createReactAppCompiler();
const warmStarted = performance.now();
compiler.compile('export default function App() { return null; }\n');
const warmupMs = Math.round(performance.now() - warmStarted);

function respond(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

respond({id: 0, ready: true, warmupMs});

createInterface({input: process.stdin}).on('line', line => {
  if (!line.trim()) {
    return;
  }
  let request: Record<string, unknown>;
  try {
    request = JSON.parse(line) as Record<string, unknown>;
  } catch {
    respond({id: null, error: 'Invalid JSON request.'});
    return;
  }
  const id = request['id'];
  try {
    if (request['op'] === 'ping') {
      respond({id, ok: true});
      return;
    }
    if (request['op'] !== 'compile' || typeof request['source'] !== 'string') {
      respond({id, error: 'Expected {"op": "compile", "source": string}.'});
      return;
    }
    const result = compiler.compile(request['source'], {
      bindings: typeof request['bindings'] === 'string' ? request['bindings'] : undefined,
      skipTypeCheck: request['skipTypeCheck'] === true,
    });
    respond({id, ...result});
  } catch (error) {
    respond({id, error: error instanceof Error ? error.message : String(error)});
  }
});
