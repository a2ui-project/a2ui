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
import {describe, it} from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import yaml from 'js-yaml';
import {DataModel, DataSubscription} from './data-model.js';

function getSuitePath(relPath: string): string {
  let currentDir = path.dirname(url.fileURLToPath(import.meta.url));
  while (currentDir !== path.parse(currentDir).root) {
    const candidate = path.join(currentDir, 'agent_sdks', 'conformance', 'suites', relPath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    currentDir = path.dirname(currentDir);
  }
  throw new Error(`Could not find conformance suite ${relPath}`);
}

describe('DataModel Conformance Suite (YAML)', () => {
  const suitePath = getSuitePath('core/state/data_model.yaml');
  const suiteContent = fs.readFileSync(suitePath, 'utf8');
  const cases = yaml.load(suiteContent) as Array<any>;

  for (const testCase of cases) {
    it(testCase.name, () => {
      const dm = new DataModel(testCase.initial_data || {});
      const listeners = new Map<string, {sub: DataSubscription<any>; updates: any[]}>();

      for (let i = 0; i < (testCase.steps || []).length; i++) {
        const step = testCase.steps[i];
        const action = step.action;
        const expectError = step.expect_error;

        try {
          if (action === 'get') {
            if (expectError) {
              assert.throws(
                () => dm.get(step.path),
                new RegExp(expectError),
                `[${testCase.name} step ${i}] Expected get(${step.path}) to throw`,
              );
            } else {
              const result = dm.get(step.path);
              if (step.expect_undefined || step.expect_null) {
                assert.strictEqual(
                  result,
                  undefined,
                  `[${testCase.name} step ${i}] Expected undefined for ${step.path}`,
                );
              } else if ('expect' in step) {
                assert.deepStrictEqual(
                  result,
                  step.expect,
                  `[${testCase.name} step ${i}] Value mismatch for ${step.path}`,
                );
              }
            }
          } else if (action === 'set') {
            if (expectError) {
              assert.throws(
                () => {
                  if (step.remove) {
                    dm.set(step.path, undefined);
                  } else {
                    dm.set(step.path, step.value);
                  }
                },
                new RegExp(expectError),
                `[${testCase.name} step ${i}] Expected set(${step.path}) to throw`,
              );
            } else {
              if (step.remove) {
                dm.set(step.path, undefined);
              } else {
                dm.set(step.path, step.value);
              }
            }
          } else if (action === 'subscribe') {
            const updates: any[] = [];
            const cb = (val: any) => {
              updates.push(val === undefined ? undefined : JSON.parse(JSON.stringify(val)));
            };
            if (expectError) {
              assert.throws(
                () => dm.subscribe(step.path, cb),
                new RegExp(expectError),
                `[${testCase.name} step ${i}] Expected subscribe(${step.path}) to throw`,
              );
            } else {
              const sub = dm.subscribe(step.path, cb);
              listeners.set(step.listener_id, {sub, updates});
            }
          } else if (action === 'verify_subscription') {
            const entry = listeners.get(step.listener_id);
            assert.ok(entry, `Listener ${step.listener_id} was not registered`);
            const expectedUpdates = step.expect_updates || [];
            assert.deepStrictEqual(
              entry.updates,
              expectedUpdates,
              `[${testCase.name} step ${i}] Listener ${step.listener_id} updates mismatch`,
            );
          } else if (action === 'unsubscribe') {
            const entry = listeners.get(step.listener_id);
            assert.ok(entry, `Listener ${step.listener_id} was not registered`);
            entry.sub.unsubscribe();
          } else if (action === 'dispose') {
            dm.dispose();
          } else {
            assert.fail(`Unknown action: ${action}`);
          }
        } catch (e: any) {
          if (!expectError) {
            assert.fail(
              `[${testCase.name} step ${i}] Unexpected error during '${action}': ${e.message || e}`,
            );
          }
        }
      }
    });
  }
});
