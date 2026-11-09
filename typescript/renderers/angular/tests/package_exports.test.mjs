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
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;

await import('@angular/compiler');

const root = await import('../dist/fesm2022/a2ui-angular.mjs');
const v09 = await import('../dist/fesm2022/a2ui-angular-v0_9.mjs');
const v08 = await import('../dist/fesm2022/a2ui-angular-v0_8.mjs');

describe('Angular package exports', () => {
  it('re-exports runtime exports in v0_9 with identical identity', () => {
    const commonExports = [
      'A2uiRendererService',
      'ComponentHostComponent',
      'SurfaceComponent',
      'provideA2Ui',
      'AngularCatalog',
      'createComponentImplementation',
      'toWebComponent',
      'UniversalOnlyComponent',
    ];

    for (const name of commonExports) {
      assert.ok(name in root, `Expected root to export ${name}`);
      assert.ok(name in v09, `Expected v0_9 to export ${name}`);
      assert.strictEqual(
        root[name],
        v09[name],
        `Expected ${name} to share identity between root and v0_9`,
      );
    }
  });

  it('isolates v0_8 from root runtime identity', () => {
    const runtimeExports = [
      'A2uiRendererService',
      'ComponentHostComponent',
      'SurfaceComponent',
      'AngularCatalog',
      'createComponentImplementation',
    ];

    for (const name of runtimeExports) {
      assert.ok(!(name in v08), `Expected v0_8 not to export runtime member ${name}`);
    }

    for (const key of Object.keys(v08)) {
      if (key in root) {
        assert.notStrictEqual(
          root[key],
          v08[key],
          `Expected v0_8 member ${key} not to share export identity with root`,
        );
      }
    }
  });
});
