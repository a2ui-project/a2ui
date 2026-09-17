/*
 * Copyright 2024 Google LLC
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
import {describe, it, before, after} from 'node:test';
import type {LitElement} from 'lit';
import {setupTestDom, teardownTestDom, asyncUpdate} from '../test/dom-setup.js';
import {A2uiLitElement} from '../catalog/a2ui-lit-element.js';
import {basicCatalog} from './catalog.js';

describe('basicCatalog', () => {
  before(() => {
    // `dom-setup.js` must be imported before `./catalog.js` (see the imports above): the DOM
    // globals have to exist when the component modules evaluate their Lit class definitions,
    // which is also when they register their custom elements.
    setupTestDom();
  });

  after(teardownTestDom);

  for (const implementation of basicCatalog.components.values()) {
    it(`should register <${implementation.tagName}> for ${implementation.name}`, () => {
      // The catalog instantiates elements by `tagName`, so a decorator-only rename compiles
      // cleanly and then fails in the browser.
      assert.ok(
        document.createElement(implementation.tagName) instanceof A2uiLitElement,
        `${implementation.tagName} does not resolve to an A2uiLitElement`,
      );
      assert.ok(
        implementation.tagName.startsWith('a2ui-basic-'),
        `${implementation.tagName} is not namespaced to the basic catalog`,
      );
    });

    it(`should update <${implementation.tagName}> without a context`, async () => {
      const el = document.createElement(implementation.tagName);
      document.body.appendChild(el);
      try {
        // An element mounted before a context is attached — standalone custom element usage,
        // static hydration, or a direct test mount — must not throw on its first update.
        await asyncUpdate(el);

        // The cycle must be closed, not abandoned: a pending update would mean later
        // `requestUpdate()` calls are dropped and the element never renders once bound.
        assert.strictEqual((el as LitElement).isUpdatePending, false);
      } finally {
        el.remove();
      }
    });
  }
});
