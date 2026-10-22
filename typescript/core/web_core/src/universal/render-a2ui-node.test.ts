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
import {describe, it, beforeEach, after} from 'node:test';
import {setupTestDom, teardownTestDom} from '../test/dom-setup.js';
import {html, nothing, render} from 'lit';
import {z} from 'zod';

import {ComponentContext} from '../resolution/component-context.js';
import {NodeResolver} from '../resolution/node-resolver.js';
import {getValue} from '../reactivity/signals.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {renderA2uiNode} from './render-a2ui-node.js';
import {Catalog} from '../catalog/types.js';
import type {A2uiWebComponentElement} from './a2ui_web_component_element.js';
import type {WebComponentImplementation} from './web_component_implementation.js';

// The mock element below extends HTMLElement, so the DOM globals have to be in place before this
// module's class declarations are evaluated.
setupTestDom();

describe('renderA2uiNode', () => {
  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surface: any;
  let testCatalog: Catalog<WebComponentImplementation>;

  class MockButtonElement extends HTMLElement {}

  const mockButtonImpl: WebComponentImplementation = {
    name: 'Button',
    schema: z.object({text: z.string().optional()}),
    tagName: 'a2ui-mock-button',
    element: MockButtonElement,
  };

  const mockImplWithoutTag: WebComponentImplementation = {
    name: 'MissingTag',
    schema: z.object({}),
    tagName: '' as any,
    element: MockButtonElement,
  };

  beforeEach(() => {
    testCatalog = new Catalog<WebComponentImplementation>('test-catalog', '0.9', [
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
            {
              id: 'root',
              component: 'Button',
              text: 'Root',
            },
          ],
        },
      },
    ]);

    surface = processor.model.getSurface('test-surface')!;
  });

  it('defines the custom element on first render', () => {
    assert.strictEqual(customElements.get('a2ui-mock-button'), undefined);

    const context = new ComponentContext(surface, 'btn1');
    renderA2uiNode(context, testCatalog);

    assert.strictEqual(customElements.get('a2ui-mock-button'), MockButtonElement);
  });

  function renderInParent(container: HTMLElement, child: unknown) {
    render(html`<div>${child}</div>`, container);
    return container.firstElementChild!.firstElementChild as A2uiWebComponentElement;
  }

  it('renders the registered custom element with its context', () => {
    const context = new ComponentContext(surface, 'btn1');
    const element = renderInParent(
      document.createElement('div'),
      renderA2uiNode(context, testCatalog),
    );

    assert.ok(element instanceof MockButtonElement);
    assert.strictEqual(element.context, context);
  });

  it('keeps the element when the parent re-renders with a fresh context', () => {
    const container = document.createElement('div');
    const first = renderInParent(
      container,
      renderA2uiNode(new ComponentContext(surface, 'btn1'), testCatalog),
    );
    const nextContext = new ComponentContext(surface, 'btn1');
    const second = renderInParent(container, renderA2uiNode(nextContext, testCatalog));

    assert.strictEqual(second, first);
    assert.strictEqual(second.context, nextContext);
  });

  it('replaces the element when the tag at its position changes', () => {
    class MockOtherButtonElement extends HTMLElement {}
    const otherCatalog = new Catalog<WebComponentImplementation>('other-catalog', '0.9', [
      {...mockButtonImpl, tagName: 'a2ui-mock-other-button', element: MockOtherButtonElement},
    ]);
    const container = document.createElement('div');
    const context = new ComponentContext(surface, 'btn1');
    const first = renderInParent(container, renderA2uiNode(context, testCatalog));
    const second = renderInParent(container, renderA2uiNode(context, otherCatalog));

    assert.notStrictEqual(second, first);
    assert.ok(second instanceof MockOtherButtonElement);
    assert.strictEqual(second.context, context);
  });

  it('keeps a resolved node element across re-renders, setting its node and context', () => {
    const resolver = new NodeResolver(surface, testCatalog);
    const root = getValue(resolver.rootNode)!;
    const container = document.createElement('div');

    const first = renderInParent(container, renderA2uiNode(root));
    const second = renderInParent(container, renderA2uiNode(root));

    assert.strictEqual(customElements.get('a2ui-mock-button'), MockButtonElement);
    assert.strictEqual(second, first);
    assert.strictEqual(second.node, root);
    assert.strictEqual(second.context, root.context);

    const contextOnly = new ComponentContext(surface, 'root');
    const third = renderInParent(container, renderA2uiNode(contextOnly, testCatalog));
    assert.strictEqual(third, first);
    assert.strictEqual(third.node, undefined);
    assert.strictEqual(third.context, contextOnly);
    resolver.dispose();
  });

  it('returns nothing for a node whose implementation has no tagName', () => {
    const missingTagSurface = new MessageProcessor([testCatalog]);
    missingTagSurface.processMessages([
      {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: 'test-catalog'}},
      {
        version: 'v0.9',
        updateComponents: {surfaceId: 's', components: [{id: 'root', component: 'MissingTag'}]},
      },
    ]);
    const s = missingTagSurface.model.getSurface('s')!;
    const resolver = new NodeResolver(s, testCatalog);
    const root = getValue(resolver.rootNode)!;
    const originalWarn = console.warn;
    let warned = '';
    console.warn = (message: string) => {
      warned = message;
    };
    try {
      assert.strictEqual(renderA2uiNode(root), nothing);
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warned.includes('MissingTag'));
    resolver.dispose();
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
