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
import {describe, it, before, beforeEach, after} from 'node:test';
import {setupTestDom, teardownTestDom} from '../test/dom-setup.js';
import {nothing} from 'lit';
import {z} from 'zod';

import {ComponentContext} from '../rendering/component-context.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {renderA2uiNode} from './render-a2ui-node.js';
import {Catalog, type WebComponentImplementation} from './types.js';

describe('renderA2uiNode', () => {
  before(setupTestDom);
  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surface: any;
  let testCatalog: Catalog<WebComponentImplementation>;

  const mockButtonImpl: WebComponentImplementation = {
    name: 'Button',
    schema: z.object({text: z.string().optional()}),
    tagName: 'a2ui-mock-button',
  };

  const mockImplWithoutTag: WebComponentImplementation = {
    name: 'MissingTag',
    schema: z.object({}),
    tagName: '' as any,
  };

  beforeEach(() => {
    testCatalog = new Catalog<WebComponentImplementation>('test-catalog', [
      mockButtonImpl,
      mockImplWithoutTag,
    ]);

    processor = new MessageProcessor([testCatalog]);
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: 'test-catalog',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'btn1',
              component: 'Button',
              text: 'Click me',
            },
            {
              id: 'missing-tag-cmp',
              component: 'MissingTag',
            },
            {
              id: 'unknown-cmp',
              component: 'UnknownComponent',
            },
          ],
        },
      },
    ]);

    surface = processor.model.getSurface('test-surface')!;
  });

  it('renders a Lit TemplateResult with the registered component tagName and context', () => {
    const context = new ComponentContext(surface, 'btn1');
    const result = renderA2uiNode(context, testCatalog);

    assert.notStrictEqual(result, nothing);
    assert.ok(typeof result === 'object' && result !== null);
    // Verify Lit TemplateResult strings contain the tag name
    assert.ok(JSON.stringify(result).includes('a2ui-mock-button'));
  });

  it('returns nothing and logs a warning when component type is not in the catalog', () => {
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    try {
      const context = new ComponentContext(surface, 'unknown-cmp');
      const result = renderA2uiNode(context, testCatalog);
      assert.strictEqual(result, nothing);
      assert.strictEqual(warned, true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('returns nothing and logs a warning when implementation lacks a tagName', () => {
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    try {
      const context = new ComponentContext(surface, 'missing-tag-cmp');
      const result = renderA2uiNode(context, testCatalog);
      assert.strictEqual(result, nothing);
      assert.strictEqual(warned, true);
    } finally {
      console.warn = originalWarn;
    }
  });
});
