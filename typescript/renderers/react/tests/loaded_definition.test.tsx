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

import React from 'react';
import {describe, expect, it} from 'vitest';
import {Catalog} from '@a2ui/web_core';
import {createBasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  createBinderlessComponentImplementation,
  createComponentImplementation,
} from '../src/adapter';
import {validator} from './validator';

/** The `components` of a catalog document. */
function componentsOf(catalog: {toJson(): Record<string, unknown>}) {
  return catalog.toJson()['components'] as Record<string, Record<string, unknown>>;
}

describe('implementations of a loaded component', () => {
  const base = createBasicCatalog(validator);
  const text = base.components.get('Text')!;
  const expected = componentsOf(base)['Text']!;

  it('keep its definition with createComponentImplementation', () => {
    const impl = createComponentImplementation(text, () => <span />);
    const catalog = new Catalog(base.id, '0.9', [impl], []);
    expect(componentsOf(catalog)['Text']).toEqual(expected);
    expect(expected['allOf']).toBeDefined();
  });

  it('keep its definition with createBinderlessComponentImplementation', () => {
    const impl = createBinderlessComponentImplementation(text, () => <span />);
    const catalog = new Catalog(base.id, '0.9', [impl], []);
    expect(componentsOf(catalog)['Text']).toEqual(expected);
  });
});
