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
import * as v08 from '@a2ui/lit/v0_8';
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

  it('isolates v0_8 from root runtime identity', () => {
    const runtimeExports = [
      'A2uiController',
      'A2uiLitElement',
      'A2uiSurface',
      'Context',
      'renderA2uiNode',
    ];

    for (const name of runtimeExports) {
      assert.ok(!(name in v08), `Expected v0_8 not to export runtime member ${name}`);
    }

    for (const key of Object.keys(v08)) {
      if (key in root) {
        assert.notStrictEqual(
          (root as Record<string, unknown>)[key],
          (v08 as Record<string, unknown>)[key],
          `Expected v0_8 member ${key} not to share export identity with root`,
        );
      }
    }
  });
});
