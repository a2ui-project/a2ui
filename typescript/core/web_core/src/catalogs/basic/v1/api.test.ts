/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'node:assert';
import {spawnSync} from 'node:child_process';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

// Loads a module in a fresh Node process with the 'browser' export condition
// and no DOM, which is how Metro (React Native) resolves packages.
function importWithoutDom(file: string) {
  const url = new URL(file, import.meta.url).href;
  return spawnSync(
    process.execPath,
    ['--conditions=browser', '--input-type=module', '-e', `await import(${JSON.stringify(url)});`],
    {encoding: 'utf8', cwd: fileURLToPath(new URL('.', import.meta.url))},
  );
}

describe('v1 basic catalog api entry', () => {
  it('loads without a DOM', () => {
    const result = importWithoutDom('./api.js');
    assert.strictEqual(result.status, 0, result.stderr);
  });

  it('exports the component APIs and functions', async () => {
    const api = await import('./api.js');
    assert.strictEqual(api.BASIC_COMPONENTS.length, 18);
    assert.ok(api.BASIC_COMPONENTS.includes(api.ButtonApi));
    assert.ok(api.BASIC_FUNCTIONS.length > 0);
  });
});
