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

import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';
import assert from 'node:assert';
import {describe, it, beforeEach, after, before} from 'node:test';
import type {A2uiSurface} from '../surface/a2ui-surface.js';
import {ComponentModel, MessageProcessor, isComponentNode} from '@a2ui/web_core/v0_9';

/**
 * These tests verify that the surface element:
 * - Renders nothing when no surface model is provided.
 * - Renders nothing while the root component is missing or cannot resolve.
 * - Renders the actual root component once it becomes available in the data model.
 * - Re-renders when the root component's model is replaced.
 */
describe('A2uiSurface', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();

    // Dynamically import component files *after* setting up JSDOM globals
    // to prevent LitElement from evaluating in an empty Node context and crashing.
    await import('../surface/a2ui-surface.js');
    basicCatalog = (await import('../v0_9/catalogs/basic/index.js')).basicCatalog;
  });
  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surfaceModel: any;

  beforeEach(() => {
    processor = new MessageProcessor([basicCatalog]);
    // Initialize the test surface
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: basicCatalog.id,
        },
      },
    ]);

    surfaceModel = processor.model.getSurface('test-surface')!;
  });

  it('should render nothing when surface is undefined', async () => {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    await asyncUpdate(el, e => document.body.appendChild(e as any));

    // Without surface, it should render nothing
    assert.strictEqual((el.renderRoot as HTMLElement).innerHTML, '<!---->');

    document.body.removeChild(el);
  });

  it('should render nothing when surface has no root component', async () => {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.surface = surfaceModel;
    });

    assert.strictEqual((el.renderRoot as HTMLElement).textContent, '');
    assert.strictEqual(el.renderRoot.children.length, 0);

    document.body.removeChild(el);
  });

  it('should render nothing when the root component has an unknown type', async () => {
    const codes: string[] = [];
    surfaceModel.onError.subscribe((e: {code: string}) => codes.push(e.code));
    surfaceModel.componentsModel.addComponent(
      new ComponentModel('root', 'Bogus', {}, basicCatalog),
    );
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.surface = surfaceModel;
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.strictEqual((el.renderRoot as HTMLElement).textContent, '');
    assert.strictEqual(el.renderRoot.children.length, 0);
    assert.ok(codes.includes('UNKNOWN_COMPONENT_TYPE'), 'reported: ' + codes.join(','));

    document.body.removeChild(el);
  });

  it('should render root component once it becomes available', async () => {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.surface = surfaceModel;
    });

    assert.strictEqual((el.renderRoot as HTMLElement).textContent, '');
    assert.strictEqual(el.renderRoot.children.length, 0);

    // Add root component
    await asyncUpdate(el, () => {
      processor.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'test-surface',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello JSDOM',
              },
            ],
          },
        },
      ]);
    });

    await el.updateComplete;

    // Wait for the child element (a2ui-text) to finish updating as well
    const childEl = el.renderRoot.querySelector('a2ui-basic-text') as any;
    if (childEl && childEl.updateComplete) {
      await childEl.updateComplete;
    }

    const html = (el.renderRoot as HTMLElement).innerHTML;
    const childHtml = childEl?.innerHTML;

    assert.ok(html?.includes('a2ui-basic-text'), 'Root should render: ' + html);
    assert.ok(childHtml?.includes('Hello JSDOM'), 'Actual child HTML: ' + childHtml);

    document.body.removeChild(el);
  });
  it('should re-render when the root component is replaced', async () => {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);
    await asyncUpdate(el, e => {
      e.surface = surfaceModel;
    });

    const updateRoot = (component: Record<string, unknown>) =>
      asyncUpdate(el, () => {
        processor.processMessages([
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 'test-surface',
              components: [{id: 'root', ...component}],
            },
          },
        ]);
      });

    await updateRoot({component: 'Text', text: 'Hello JSDOM'});
    assert.ok(el.renderRoot.querySelector('a2ui-basic-text'), 'Should render the Text root');

    // A new type replaces the root's model, deleting the old one and creating
    // a new one; the surface must render the new model.
    await updateRoot({component: 'Divider'});
    assert.ok(el.renderRoot.querySelector('a2ui-divider'), 'Should render the new root');
    assert.ok(!el.renderRoot.querySelector('a2ui-basic-text'), 'Old root should be gone');

    document.body.removeChild(el);
  });

  it('should accept a surface whose componentsModel has no event sources', async () => {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);

    // A partial test double of the kind pre-1.0 renderer tests pass in: it
    // can look up the root but has no `onCreated` or `onDeleted` to subscribe to.
    const partialSurface = {
      ...surfaceModel,
      componentsModel: {get: () => undefined},
    };
    await asyncUpdate(el, e => {
      e.surface = partialSurface as any;
    });
    // Subscribing didn't throw, and with no root there is nothing to show.
    assert.strictEqual((el.renderRoot as HTMLElement).textContent, '');
    assert.strictEqual(el.renderRoot.children.length, 0);

    await asyncUpdate(el, e => {
      e.surface = undefined;
    });

    document.body.removeChild(el);
  });

  it('should render in the Light DOM without a shadowRoot', async () => {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);

    await asyncUpdate(el, () => {
      el.surface = surfaceModel;
      processor.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'test-surface',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Light DOM child',
              },
            ],
          },
        },
      ]);
    });

    await el.updateComplete;
    assert.strictEqual(el.shadowRoot, null);
    const childEl = el.querySelector('a2ui-basic-text') as any;
    assert.ok(childEl);
    assert.ok(
      isComponentNode(childEl.node),
      'Root element should receive a resolved ComponentNode',
    );
    assert.strictEqual(childEl.node.componentId, 'root');

    document.body.removeChild(el);
  });

  it('should dispose the previous NodeResolver when swapping surface models', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [{id: 'root', component: 'Text', text: 'First Surface'}],
        },
      },
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'second-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'second-surface',
          components: [{id: 'root', component: 'Text', text: 'Second Surface'}],
        },
      },
    ]);

    const secondSurfaceModel = processor.model.getSurface('second-surface')!;
    const preMountListeners = (surfaceModel.componentsModel.onCreated as any).listeners.size;

    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);

    await asyncUpdate(el, s => {
      s.surface = surfaceModel;
    });
    assert.ok((surfaceModel.componentsModel.onCreated as any).listeners.size > preMountListeners);
    assert.strictEqual(el.rootNode?.context?.dataContext.surface, surfaceModel);

    await asyncUpdate(el, s => {
      s.surface = secondSurfaceModel;
    });

    assert.strictEqual(
      (surfaceModel.componentsModel.onCreated as any).listeners.size,
      preMountListeners,
    );
    assert.strictEqual(el.rootNode?.context?.dataContext.surface, secondSurfaceModel);
    const childEl = el.querySelector('a2ui-basic-text') as any;
    assert.ok(childEl);
    assert.strictEqual(childEl.node?.context?.dataContext.surface, secondSurfaceModel);

    document.body.removeChild(el);
  });
});
