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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {z} from 'zod';

import {toWebComponentImplementation} from './to_web_component_implementation.js';

describe('toWebComponentImplementation', () => {
  class MockElement {
    static readonly tagName = 'a2ui-mock';
  }
  const element = MockElement as unknown as CustomElementConstructor & {readonly tagName: string};

  it('combines the api with the element and its static tag name', () => {
    const api = {name: 'Mock', schema: z.object({text: z.string()})};

    const impl = toWebComponentImplementation(element, api);

    assert.strictEqual(impl.name, 'Mock');
    assert.strictEqual(impl.schema, api.schema);
    assert.strictEqual(impl.tagName, 'a2ui-mock');
    assert.strictEqual(impl.element, element);
  });

  it('shares one element across apis of different versions', () => {
    const oldApi = {name: 'Mock', schema: z.object({text: z.string()})};
    const newApi = {name: 'Mock', schema: z.object({text: z.string(), note: z.string()})};

    const oldImpl = toWebComponentImplementation(element, oldApi);
    const newImpl = toWebComponentImplementation(element, newApi);

    assert.strictEqual(oldImpl.element, newImpl.element);
    assert.strictEqual(oldImpl.tagName, newImpl.tagName);
    assert.strictEqual(oldImpl.schema, oldApi.schema);
    assert.strictEqual(newImpl.schema, newApi.schema);
  });
});
