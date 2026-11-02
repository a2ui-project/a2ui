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
import {after, afterEach, before, beforeEach, describe, it} from 'node:test';

// Must be imported before `lit` and `./a2ui-lit-element.js` so JSDOM globals
// (`window`, `document`, `HTMLElement`, `customElements`) exist at module evaluation time.
import {asyncUpdate, setupTestDom, teardownTestDom} from '../test/dom-setup.js';
import {css, html, nothing, render} from 'lit';
import {z} from 'zod';

import {Catalog, ComponentApi} from '../catalog/index.js';
import {basicCatalog} from '../catalogs/basic/v1/catalog.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {getValue, peekValue} from '../reactivity/signals.js';
import {ComponentContext} from '../resolution/component-context.js';
import {NodeResolver} from '../resolution/node-resolver.js';
import {CheckableSchema} from '../v0_9/schema/common-types.js';
import {A2uiLitElement} from './a2ui-lit-element.js';

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
        version: '1.0',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: testCatalog.id,
        },
      },
      {
        version: '1.0',
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
        version: '1.0',
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

  afterEach(() => {
    document.body.innerHTML = '';
    document.adoptedStyleSheets = [];
  });

  it('defaults to light DOM (createRenderRoot returns this)', () => {
    const el = document.createElement('test-a2ui-element') as any;
    assert.strictEqual(el.createRenderRoot(), el);
    assert.strictEqual(el.shadowRoot, null);
  });

  it('adopts scoped styles into the document by default', () => {
    class TestLightStyledElement extends A2uiLitElement<any> {
      static override styles = css`
        :host {
          display: block;
        }
        .title {
          color: blue;
        }
      `;
      override createController() {
        return {dispose: () => {}} as any;
      }
    }
    customElements.define('test-light-styled-element', TestLightStyledElement);

    const el = document.createElement('test-light-styled-element') as TestLightStyledElement;
    document.body.appendChild(el);

    assert.strictEqual(el.renderRoot, el);
    assert.strictEqual(el.shadowRoot, null);
    assert.ok((TestLightStyledElement as any)._processedCss?.includes('test-light-styled-element'));
    assert.ok((TestLightStyledElement as any)._adoptedRoots?.has(document));
    assert.strictEqual(document.adoptedStyleSheets.length, 1);
  });

  it('does not adopt its styles into the document when it renders into a ShadowRoot', () => {
    class TestShadowStyledElement extends A2uiLitElement<any> {
      static override styles = css`
        .title {
          color: red;
        }
      `;
      protected override createRenderRoot() {
        return this.attachShadow({mode: 'open'});
      }
      override createController() {
        return {dispose: () => {}} as any;
      }
    }
    customElements.define('test-shadow-styled-element', TestShadowStyledElement);

    const sheetsBefore = [...document.adoptedStyleSheets];
    const el = document.createElement('test-shadow-styled-element') as TestShadowStyledElement;
    document.body.appendChild(el);

    assert.ok(el.renderRoot instanceof (globalThis as any).ShadowRoot);
    assert.deepStrictEqual(document.adoptedStyleSheets, sheetsBefore);
    assert.strictEqual((TestShadowStyledElement as any)._processedCss, undefined);
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

  it('keeps its controller when assigned an equivalent context instance', async () => {
    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    const context1 = new ComponentContext(surface, 'root', '/items/0');
    await asyncUpdate(el, (e: any) => {
      e.context = context1;
    });
    assert.strictEqual(controllerCreatedCount, 1);
    assert.strictEqual(disposedCount, 0);

    // A fresh ComponentContext for the same surface, component, and data path
    // (as produced by a parent's renderNode on re-render) must not recreate
    // the controller.
    const context2 = new ComponentContext(surface, 'root', '/items/0');
    assert.notStrictEqual(context1, context2);
    await asyncUpdate(el, (e: any) => {
      e.context = context2;
    });

    assert.strictEqual(controllerCreatedCount, 1);
    assert.strictEqual(disposedCount, 0);
    assert.strictEqual((el as any)._controllerContext, context2);

    document.body.removeChild(el);
  });

  it('replaces its controller when assigned partial mock contexts without dataContext', async () => {
    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.context = {} as ComponentContext;
    });
    assert.strictEqual(controllerCreatedCount, 1);

    await asyncUpdate(el, (e: any) => {
      e.context = {} as ComponentContext;
    });
    assert.strictEqual(disposedCount, 1);
    assert.strictEqual(controllerCreatedCount, 2);

    document.body.removeChild(el);
  });

  it('replaces its controller when the context binds another data path', async () => {
    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.context = new ComponentContext(surface, 'root', '/items/0');
    });
    assert.strictEqual(controllerCreatedCount, 1);

    await asyncUpdate(el, (e: any) => {
      e.context = new ComponentContext(surface, 'root', '/items/1');
    });
    assert.strictEqual(disposedCount, 1);
    assert.strictEqual(controllerCreatedCount, 2);

    document.body.removeChild(el);
  });

  it('replaces its controller when the component model is recreated', async () => {
    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.context = new ComponentContext(surface, 'root');
    });
    assert.strictEqual(controllerCreatedCount, 1);

    // Removing and re-adding the component creates a new ComponentModel
    // instance with the same id.
    surface.componentsModel.removeComponent('root');
    processor.processMessages([
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [{id: 'root', component: 'Text', text: 'Recreated'}],
        },
      },
    ]);

    await asyncUpdate(el, (e: any) => {
      e.context = new ComponentContext(surface, 'root');
    });
    assert.strictEqual(disposedCount, 1);
    assert.strictEqual(controllerCreatedCount, 2);

    document.body.removeChild(el);
  });

  it('takes its context and its children from an assigned node', async () => {
    const nodeProcessor = new MessageProcessor([basicCatalog]);
    nodeProcessor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'node-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: '1.0',
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
    const childEl = el.querySelector('a2ui-basic-text');
    assert.strictEqual(childEl.node, childNode);
    await childEl.updateComplete;
    assert.strictEqual(childEl.context, childNode.context);

    // Reassigning the same node changes nothing.
    await asyncUpdate(el, (e: any) => {
      e.node = root;
    });
    assert.strictEqual(controllerCreatedCount, 1);

    // A child that is still a placeholder renders nothing.
    assert.strictEqual((el as any).renderNode('missing'), nothing);
    // Passing a ComponentNode directly to renderNode renders that node.
    const host = document.createElement('div');
    render((el as any).renderNode(childNode), host);
    const direct = host.querySelector('a2ui-basic-text') as any;
    assert.ok(direct, 'renderNode(childNode) should render the child element');
    assert.strictEqual(direct.node, childNode);

    // Replacing the assigned node with a different ComponentNode recreates the controller.
    await asyncUpdate(el, (e: any) => {
      e.node = childNode;
    });
    assert.strictEqual(disposedCount, 1);
    assert.strictEqual(controllerCreatedCount, 2);

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

  it('binds an element without an api to the api of the catalog it was rendered from', async () => {
    class VersionAgnosticElement extends A2uiLitElement<ComponentApi> {}
    customElements.define('test-version-agnostic-element', VersionAgnosticElement);

    const apiUsedIn = async (api: ComponentApi, catalogId: string) => {
      const catalog = new Catalog<ComponentApi>(catalogId, '1.0', [api]);
      const catalogProcessor = new MessageProcessor([catalog]);
      catalogProcessor.processMessages([
        {version: '1.0', createSurface: {surfaceId: 's', catalogId}},
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Label', text: 'Hi'}],
          },
        },
      ]);
      const el = document.createElement('test-version-agnostic-element') as VersionAgnosticElement;
      document.body.appendChild(el);
      await asyncUpdate(el, (e: any) => {
        e.context = new ComponentContext(catalogProcessor.model.getSurface('s')!, 'root');
      });
      assert.strictEqual((el.controller.props as any).text, 'Hi');
      const usedApi = (el as any).findCatalogApi();
      document.body.removeChild(el);
      return usedApi;
    };

    const oldApi = {name: 'Label', schema: z.object({text: z.string()})};
    const newApi = {
      name: 'Label',
      schema: z.object({text: z.string(), note: z.string().optional()}),
    };

    assert.strictEqual(await apiUsedIn(oldApi, 'old-catalog'), oldApi);
    assert.strictEqual(await apiUsedIn(newApi, 'new-catalog'), newApi);
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

  it('does not accumulate component subscriptions when a parent re-renders', async () => {
    const columnProcessor = new MessageProcessor([basicCatalog]);
    columnProcessor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'leak-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'leak-surface',
          components: [
            {id: 'root', component: 'Column', children: ['c1', 'c2']},
            {id: 'c1', component: 'Text', text: {'@path': '/label'}},
            {id: 'c2', component: 'Text', text: 'Static'},
          ],
        },
      },
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: 'leak-surface',
          value: {label: 'Initial'},
        },
      },
    ]);
    const columnSurface = columnProcessor.model.getSurface('leak-surface')!;

    for (const impl of basicCatalog.components.values()) {
      const {registerUniversalElement} = await import('./register_universal_element.js');
      registerUniversalElement(impl as any);
    }

    const rootEl = document.createElement('a2ui-basic-column') as any;
    document.body.appendChild(rootEl);
    await asyncUpdate(rootEl, (e: any) => {
      e.context = new ComponentContext(columnSurface, 'root');
    });

    const onCreatedListeners = (columnSurface.componentsModel.onCreated as any)
      .listeners as Set<unknown>;
    const baselineListeners = onCreatedListeners.size;
    assert.ok(baselineListeners >= 3);

    // Repeatedly update the data model and re-render the parent without a NodeResolver,
    // which causes Column.render() -> renderNode() to pass fresh ComponentContext
    // instances to each child on every pass.
    for (let i = 0; i < 10; i++) {
      await asyncUpdate(rootEl, (e: any) => {
        columnProcessor.processMessages([
          {
            version: '1.0',
            updateDataModel: {
              surfaceId: 'leak-surface',
              value: {label: `Tick ${i}`},
            },
          },
        ]);
        e.requestUpdate();
      });
    }

    assert.strictEqual(onCreatedListeners.size, baselineListeners);

    document.body.removeChild(rootEl);
    assert.strictEqual(onCreatedListeners.size, 0);
  });

  it('forwards accessibility and validation attributes to accessibilityTarget() and renders validation errors', async () => {
    const TargetInputApi = {
      name: 'TargetInput',
      schema: z.object({
        value: z.string().default(''),
        checks: CheckableSchema.shape.checks,
        accessibility: z
          .object({
            label: z.string().optional(),
            description: z.string().optional(),
            live: z.enum(['off', 'polite', 'assertive']).optional(),
            hidden: z.boolean().optional(),
          })
          .optional(),
      }),
    };

    class TestTargetInputElement extends A2uiLitElement<typeof TargetInputApi> {
      protected override readonly api = TargetInputApi;

      protected override accessibilityTarget(): Element | null {
        return this.querySelector('input');
      }

      override render() {
        return html`
          <input .value=${this.controller.props.value ?? ''} />
          ${this.renderValidationErrors()}
        `;
      }
    }

    if (!customElements.get('test-target-input-element')) {
      customElements.define('test-target-input-element', TestTargetInputElement);
    }

    const catalog = new Catalog<ComponentApi>('target-input-catalog', '1.0', [TargetInputApi]);
    const targetProcessor = new MessageProcessor([catalog]);
    targetProcessor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'target-surface',
          catalogId: catalog.id,
        },
      },
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'target-surface',
          components: [
            {
              id: 'root',
              component: 'TargetInput',
              value: 'bad',
              checks: [{condition: false, message: 'Must be valid'}],
              accessibility: {
                label: 'Email address',
                description: 'Enter your work email',
                live: 'polite',
                hidden: false,
              },
            },
          ],
        },
      },
    ]);

    const targetSurface = targetProcessor.model.getSurface('target-surface')!;
    const resolver = new NodeResolver(targetSurface, catalog);
    const rootNode = getValue(resolver.rootNode)!;

    const el = document.createElement('test-target-input-element') as TestTargetInputElement;
    document.body.appendChild(el);
    await asyncUpdate(el, (e: any) => {
      e.node = rootNode;
    });

    assert.strictEqual(el.getAttribute('aria-live'), 'polite');
    assert.strictEqual(el.getAttribute('aria-hidden'), 'false');
    assert.strictEqual(el.hasAttribute('role'), false);
    assert.strictEqual(el.hasAttribute('aria-label'), false);
    assert.strictEqual(el.hasAttribute('aria-description'), false);

    const input = el.querySelector('input')!;
    assert.ok(input);
    assert.strictEqual(input.getAttribute('aria-label'), 'Email address');
    assert.strictEqual(input.getAttribute('aria-description'), 'Enter your work email');
    assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
    assert.strictEqual(input.getAttribute('aria-describedby'), `${rootNode.id}-error`);

    const errorEl = el.querySelector('.a2ui-validation-errors');
    assert.ok(errorEl);
    assert.strictEqual(errorEl.id, `${rootNode.id}-error`);
    assert.strictEqual(errorEl.querySelector('.a2ui-error-message')?.textContent, 'Must be valid');

    targetProcessor.processMessages([
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'target-surface',
          components: [
            {
              id: 'root',
              component: 'TargetInput',
              value: 'ok',
              checks: [{condition: true, message: 'Must be valid'}],
              accessibility: undefined,
            },
          ],
        },
      },
    ]);
    await asyncUpdate(el, () => {});

    assert.strictEqual(el.hasAttribute('aria-live'), false);
    assert.strictEqual(el.hasAttribute('aria-hidden'), false);
    assert.strictEqual(input.hasAttribute('aria-label'), false);
    assert.strictEqual(input.hasAttribute('aria-description'), false);
    assert.strictEqual(input.hasAttribute('aria-invalid'), false);
    assert.strictEqual(input.hasAttribute('aria-describedby'), false);
    assert.strictEqual(el.querySelector('.a2ui-validation-errors'), null);

    el.remove();
    resolver.dispose();
  });

  it('falls back to role="group" and aria-label on the host when accessibilityTarget() is null, preserving any explicit host role', async () => {
    const GroupBoxApi = {
      name: 'GroupBox',
      schema: z.object({
        title: z.string().default(''),
        accessibility: z
          .object({
            label: z.string().optional(),
            description: z.string().optional(),
            live: z.enum(['off', 'polite', 'assertive']).optional(),
            hidden: z.boolean().optional(),
          })
          .optional(),
      }),
    };

    class TestGroupBoxElement extends A2uiLitElement<typeof GroupBoxApi> {
      protected override readonly api = GroupBoxApi;

      override render() {
        return html`<span>${this.controller.props.title}</span>`;
      }
    }

    if (!customElements.get('test-group-box-element')) {
      customElements.define('test-group-box-element', TestGroupBoxElement);
    }

    const catalog = new Catalog<ComponentApi>('group-box-catalog', '1.0', [GroupBoxApi]);
    const groupProcessor = new MessageProcessor([catalog]);
    groupProcessor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'group-surface',
          catalogId: catalog.id,
        },
      },
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'group-surface',
          components: [
            {
              id: 'box1',
              component: 'GroupBox',
              title: 'Summary',
              accessibility: {
                label: 'Order summary',
                description: 'Items and totals',
              },
            },
          ],
        },
      },
    ]);

    const groupSurface = groupProcessor.model.getSurface('group-surface')!;

    // 1. Default host without an explicit role gets role="group" and clears it when unset.
    const defaultHost = document.createElement('test-group-box-element') as TestGroupBoxElement;
    document.body.appendChild(defaultHost);
    await asyncUpdate(defaultHost, (e: any) => {
      e.context = new ComponentContext(groupSurface, 'box1');
    });

    assert.strictEqual(defaultHost.getAttribute('role'), 'group');
    assert.strictEqual(defaultHost.getAttribute('aria-label'), 'Order summary');
    assert.strictEqual(defaultHost.getAttribute('aria-description'), 'Items and totals');

    // 2. Host with an explicit role preserves that role when setting and clearing accessibility.
    const regionHost = document.createElement('test-group-box-element') as TestGroupBoxElement;
    regionHost.setAttribute('role', 'region');
    document.body.appendChild(regionHost);
    await asyncUpdate(regionHost, (e: any) => {
      e.context = new ComponentContext(groupSurface, 'box1');
    });

    assert.strictEqual(regionHost.getAttribute('role'), 'region');
    assert.strictEqual(regionHost.getAttribute('aria-label'), 'Order summary');
    assert.strictEqual(regionHost.getAttribute('aria-description'), 'Items and totals');

    groupProcessor.processMessages([
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'group-surface',
          components: [
            {
              id: 'box1',
              component: 'GroupBox',
              title: 'Summary',
              accessibility: undefined,
            },
          ],
        },
      },
    ]);
    await asyncUpdate(defaultHost, () => {});
    await asyncUpdate(regionHost, () => {});

    assert.strictEqual(defaultHost.hasAttribute('role'), false);
    assert.strictEqual(defaultHost.hasAttribute('aria-label'), false);
    assert.strictEqual(defaultHost.hasAttribute('aria-description'), false);

    assert.strictEqual(regionHost.getAttribute('role'), 'region');
    assert.strictEqual(regionHost.hasAttribute('aria-label'), false);
    assert.strictEqual(regionHost.hasAttribute('aria-description'), false);

    defaultHost.remove();
    regionHost.remove();
  });
});
