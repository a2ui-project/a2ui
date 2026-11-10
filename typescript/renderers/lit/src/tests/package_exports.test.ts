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

import assert from 'node:assert';
import {describe, it} from 'node:test';
/* eslint-disable no-restricted-imports */
import * as root from '@a2ui/lit';
import * as v09 from '@a2ui/lit/v0_9';
/* eslint-enable no-restricted-imports */

describe('Lit package exports', () => {
  it('re-exports runtime exports in v0_9 with identical identity', () => {
    const commonExports = [
      'A2uiController',
      'A2uiLitElement',
      'A2uiSurface',
      'Context',
      'renderA2uiNode',
    ] as const;

    for (const name of commonExports) {
      assert.ok(name in root, `Expected root to export ${name}`);
      assert.ok(name in v09, `Expected v0_9 to export ${name}`);
      assert.strictEqual(
        (root as Record<string, unknown>)[name],
        (v09 as Record<string, unknown>)[name],
        `Expected ${name} to share identity between root and v0_9`,
      );
    }
  });

  it('does not expose removed v0_8 exports or subpaths', async () => {
    assert.ok(!('v0_8' in root), 'Expected root not to export v0_8');

    for (const subpath of ['@a2ui/lit/0.8', '@a2ui/lit/v0_8', '@a2ui/lit/ui']) {
      await assert.rejects(() => import(subpath), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    }
  });
});
