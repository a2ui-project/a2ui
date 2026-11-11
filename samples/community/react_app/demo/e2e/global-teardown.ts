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
 * Collects the latency records the tests of this run wrote into results/latency-<mode>.json and
 * results/latency.json, and prints a table.
 */
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');
const CHECKPOINTS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

export default function globalTeardown(): void {
  const mode = process.env['DEMO_E2E_MODE'] === 'live' ? 'live' : 'recorded';
  const runId = String(process.env['DEMO_E2E_RUN_ID']);
  const dir = join(RESULTS_DIR, 'latency', mode);
  if (!existsSync(dir)) {
    return;
  }
  const stamp = runId.replace(/[:.]/g, '-');
  const records = readdirSync(dir)
    .filter(name => name.startsWith(stamp))
    .map(
      name =>
        JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
          useCase: string;
          checkpoints: Record<string, number>;
        },
    );
  if (records.length === 0) {
    return;
  }
  const summary = {mode, runId, records};
  writeFileSync(join(RESULTS_DIR, `latency-${mode}.json`), JSON.stringify(summary, null, 2));
  writeFileSync(join(RESULTS_DIR, 'latency.json'), JSON.stringify(summary, null, 2));
  console.log(`\nLatency (${mode}), ms after the request:`);
  console.log(['use case', ...CHECKPOINTS].join('\t'));
  for (const record of records) {
    console.log([record.useCase, ...CHECKPOINTS.map(c => record.checkpoints[c] ?? '-')].join('\t'));
  }
}
