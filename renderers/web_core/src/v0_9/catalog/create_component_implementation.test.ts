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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {z} from 'zod';
import {createComponentImplementation} from './create_component_implementation.js';
import type {ComponentApi} from './types.js';

describe('createComponentImplementation', () => {
  const sampleApi = {
    name: 'SampleWidget',
    schema: z.object({
      label: z.string(),
    }),
  } satisfies ComponentApi;

  class MockElement extends (typeof HTMLElement !== 'undefined' ? HTMLElement : Object) {}

  it('creates a WebComponentImplementation pairing ComponentApi with element and resolves tagName from getName', () => {
    const originalCustomElements = (globalThis as any).customElements;
    (globalThis as any).customElements = {
      getName: (cls: any) => (cls === MockElement ? 'custom-sample-widget' : undefined),
      get: (tag: string) => (tag === 'custom-sample-widget' ? MockElement : undefined),
      define: () => {},
    };

    try {
      const impl = createComponentImplementation(
        sampleApi,
        MockElement as CustomElementConstructor,
      );
      assert.strictEqual(impl.name, 'SampleWidget');
      assert.strictEqual(impl.schema, sampleApi.schema);
      assert.strictEqual(impl.tagName, 'custom-sample-widget');
    } finally {
      if (originalCustomElements !== undefined) {
        (globalThis as any).customElements = originalCustomElements;
      } else {
        delete (globalThis as any).customElements;
      }
    }
  });

  it('defaults tagName to a2ui-<lowercase> and auto-registers in customElements', () => {
    let definedTag = '';
    let definedClass: any = null;
    const originalCustomElements = (globalThis as any).customElements;
    (globalThis as any).customElements = {
      getName: () => undefined,
      get: () => undefined,
      define: (tag: string, cls: any) => {
        definedTag = tag;
        definedClass = cls;
      },
    };

    try {
      const impl = createComponentImplementation(
        sampleApi,
        MockElement as CustomElementConstructor,
      );

      assert.strictEqual(impl.tagName, 'a2ui-samplewidget');
      assert.strictEqual(definedTag, 'a2ui-samplewidget');
      assert.strictEqual(definedClass, MockElement);
    } finally {
      if (originalCustomElements !== undefined) {
        (globalThis as any).customElements = originalCustomElements;
      } else {
        delete (globalThis as any).customElements;
      }
    }
  });
});
