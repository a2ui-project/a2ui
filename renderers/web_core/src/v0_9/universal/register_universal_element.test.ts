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

import {describe, it, after, beforeEach, afterEach} from 'node:test';
import * as assert from 'node:assert';
import {z} from 'zod';
import {setupTestDom, teardownTestDom} from '../test/dom-setup.js';
import {registerUniversalElement} from './register_universal_element.js';
import type {WebComponentImplementation} from './web_component_implementation.js';

// The mock classes below extend HTMLElement, so the DOM globals have to be in place before this
// module's class declarations are evaluated.
setupTestDom();

describe('registerUniversalElement', () => {
  class MockElementA extends HTMLElement {}
  class MockElementB extends HTMLElement {}

  let registry: Map<string, any>;
  let originalCustomElements: unknown;

  after(teardownTestDom);

  beforeEach(() => {
    originalCustomElements = (globalThis as any).customElements;
    registry = new Map();
    (globalThis as any).customElements = {
      get: (tag: string) => registry.get(tag),
      define: (tag: string, constructor: any) => {
        registry.set(tag, constructor);
      },
    };
  });

  afterEach(() => {
    if (originalCustomElements !== undefined) {
      (globalThis as any).customElements = originalCustomElements;
    } else {
      delete (globalThis as any).customElements;
    }
  });

  it('registers a custom element when not yet defined', () => {
    const comp: WebComponentImplementation = {
      name: 'Test',
      schema: z.object({}),
      tagName: 'a2ui-test',
      element: MockElementA,
    };

    registerUniversalElement(comp);
    assert.strictEqual(registry.get('a2ui-test'), MockElementA);
  });

  it('no-ops safely when already registered with the same constructor', () => {
    const comp: WebComponentImplementation = {
      name: 'Test',
      schema: z.object({}),
      tagName: 'a2ui-test',
      element: MockElementA,
    };

    registerUniversalElement(comp);
    assert.doesNotThrow(() => {
      registerUniversalElement(comp);
    });
    assert.strictEqual(registry.get('a2ui-test'), MockElementA);
  });

  it('throws an error when registered with a conflicting constructor', () => {
    const compA: WebComponentImplementation = {
      name: 'TestA',
      schema: z.object({}),
      tagName: 'a2ui-test',
      element: MockElementA,
    };
    const compB: WebComponentImplementation = {
      name: 'TestB',
      schema: z.object({}),
      tagName: 'a2ui-test',
      element: MockElementB,
    };

    registerUniversalElement(compA);
    assert.throws(() => {
      registerUniversalElement(compB);
    }, /Custom element tag name collision for "a2ui-test"/);
  });

  it('no-ops safely if customElements is undefined (e.g. non-browser environment)', () => {
    delete (globalThis as any).customElements;
    const comp: WebComponentImplementation = {
      name: 'Test',
      schema: z.object({}),
      tagName: 'a2ui-test',
      element: MockElementA,
    };

    assert.doesNotThrow(() => {
      registerUniversalElement(comp);
    });
  });
});
