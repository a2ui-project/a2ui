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
import {setupTestDom, teardownTestDom, asyncUpdate} from '../test/dom-setup.js';
import {nothing} from 'lit';

import {ComponentContext} from '../resolution/component-context.js';
import {NodeResolver} from '../resolution/node-resolver.js';
import {getValue, peekValue} from '../reactivity/signals.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {A2uiLitElement} from './a2ui-lit-element.js';
import {z} from 'zod';
import {Catalog, ComponentApi} from '../catalog/index.js';
import {basicCatalog} from '../catalogs/basic/v1/catalog.js';

const MockTextApi = {
  name: 'Text',
  schema: z.object({
    text: z.string().default(''),
  }),
};
const testCatalog = new Catalog<ComponentApi>('test-catalog', '1.0', [MockTextApi]);

/**
 * These tests ensure that:
 * - The element correctly instantiates an `A2uiController` when its ComponentContext is assigned.
 * - Changing the element's ComponentContext safely tears down the old controller and creates a new one.
 */
describe('A2uiLitElement', () => {
  let controllerCreatedCount = 0;
  let disposedCount = 0;

  // Tracks the return value of renderNode() in TestA2uiElement to verify rendering behavior in tests.
  let lastRenderResult: any = null;

  before(async () => {
    setupTestDom();

    // Create a mock subclass to intercept and track controller lifecycle events
    class TestA2uiElement extends A2uiLitElement<any> {
      override createController() {
        controllerCreatedCount++;
        return {
          dispose: () => {
            disposedCount++;
          },
        } as any;
      }

      override render() {
        lastRenderResult = this.renderNode('child_id');
        return lastRenderResult;
      }
    }

    customElements.define('test-a2ui-element', TestA2uiElement);
  });

  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surface: any;

  beforeEach(() => {
    controllerCreatedCount = 0;
    disposedCount = 0;
    processor = new MessageProcessor([testCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: testCatalog.id,
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'Root',
            },
            {
              id: 'child_id',
              component: 'Text',
              text: 'Child',
            },
          ],
        },
      },
      {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 'test-surface',
          value: {
            myData: 'hello',
            child_id: {myData: 'world'},
          },
        },
      },
    ]);

    surface = processor.model.getSurface('test-surface')!;
  });

  it('should default to Shadow DOM rendering (creates a ShadowRoot)', () => {
    const el = document.createElement('test-a2ui-element') as any;
    assert.notStrictEqual(el.createRenderRoot(), el);
    assert.ok(
      el.createRenderRoot() instanceof (globalThis as any).ShadowRoot ||
        el.createRenderRoot() !== el,
    );
  });

  it('should create controller when context is set', async () => {
    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    assert.strictEqual(controllerCreatedCount, 0);

    const context = new ComponentContext(surface, 'root');
    await asyncUpdate(el, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(controllerCreatedCount, 1);
    document.body.removeChild(el);
  });

  it('should dispose old controller and create new one when context changes', async () => {
    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    const context1 = new ComponentContext(surface, 'root');
    await asyncUpdate(el, (e: any) => {
      e.context = context1;
    });

    assert.strictEqual(controllerCreatedCount, 1);
    assert.strictEqual(disposedCount, 0);

    const context2 = new ComponentContext(surface, 'child_id');
    await asyncUpdate(el, (e: any) => {
      e.context = context2;
    });

    assert.strictEqual(disposedCount, 1);
    assert.strictEqual(controllerCreatedCount, 2);

    document.body.removeChild(el);
  });

  it('takes its context and its children from an assigned node', async () => {
    const nodeProcessor = new MessageProcessor([basicCatalog]);
    nodeProcessor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'node-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 'node-surface',
          components: [
            {id: 'root', component: 'Column', children: ['child_id', 'missing']},
            {id: 'child_id', component: 'Text', text: 'Child'},
          ],
        },
      },
    ]);
    const nodeSurface = nodeProcessor.model.getSurface('node-surface')!;
    const resolver = new NodeResolver(nodeSurface, basicCatalog);
    const root = getValue(resolver.rootNode)!;
    const [childNode, missingNode] = peekValue(root.props).children as any[];
    assert.strictEqual(childNode.componentId, 'child_id');
    assert.strictEqual(missingNode.isPlaceholder, true);

    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);
    await asyncUpdate(el, (e: any) => {
      e.node = root;
    });

    assert.strictEqual(el.context, root.context);
    assert.strictEqual(controllerCreatedCount, 1);
    // renderNode('child_id') hands the child element the child's own node.
    assert.ok(JSON.stringify(lastRenderResult).includes('a2ui-basic-text'));
    assert.strictEqual(lastRenderResult.values[0], childNode);
    assert.strictEqual(lastRenderResult.values[1], childNode.context);

    // Reassigning the same node changes nothing.
    await asyncUpdate(el, (e: any) => {
      e.node = root;
    });
    assert.strictEqual(controllerCreatedCount, 1);

    // A child that is still a placeholder renders nothing.
    assert.strictEqual((el as any).renderNode('missing'), nothing);

    document.body.removeChild(el);
    resolver.dispose();
  });

  it('should return nothing when component is removed from surface', async () => {
    const {nothing} = await import('lit');

    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'root');
    await asyncUpdate(el, (e: any) => {
      e.context = context;
    });

    surface.componentsModel.removeComponent('root');

    await asyncUpdate(el, (e: any) => {
      e.requestUpdate();
    });

    assert.strictEqual(lastRenderResult, nothing);

    document.body.removeChild(el);
  });

  it('should return nothing when surface is disposed', async () => {
    const {nothing} = await import('lit');

    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'root');
    await asyncUpdate(el, (e: any) => {
      e.context = context;
    });

    surface.dispose();

    await asyncUpdate(el, (e: any) => {
      e.requestUpdate();
    });

    assert.strictEqual(lastRenderResult, nothing);

    document.body.removeChild(el);
  });

  it('should automatically instantiate controller when api property is defined', async () => {
    class TestApiElement extends A2uiLitElement<typeof MockTextApi> {
      protected override readonly api = MockTextApi;
    }
    customElements.define('test-api-element', TestApiElement);

    const el = document.createElement('test-api-element') as TestApiElement;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'root');
    await asyncUpdate(el, (e: any) => {
      e.context = context;
    });

    assert.ok(el.controller);
    assert.strictEqual(el.controller?.props.text, 'Root');

    document.body.removeChild(el);
  });

  it('should safely skip update and render when context or controller is not set', async () => {
    let renderCalled = false;
    class TestUnboundElement extends A2uiLitElement<typeof MockTextApi> {
      protected override readonly api = MockTextApi;
      override render() {
        renderCalled = true;
        return this.controller.props.text;
      }
    }
    customElements.define('test-unbound-element', TestUnboundElement);

    const el = document.createElement('test-unbound-element') as TestUnboundElement;
    document.body.appendChild(el);

    // Wait for Lit's async update lifecycle
    await (el as any).updateComplete;

    assert.strictEqual(renderCalled, false);
    assert.strictEqual(el.controller, undefined);

    document.body.removeChild(el);
  });
});
