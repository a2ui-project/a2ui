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
import {describe, it, before, beforeEach, after, afterEach} from 'node:test';
import {setupTestDom, teardownTestDom, asyncUpdate} from '../test/dom-setup.js';

import type {
  MessageProcessor,
  ComponentContext,
  Catalog,
  WebComponentImplementation,
  SurfaceModel,
} from '../index.js';
import type {TextApi as TextApiType} from '../basic_catalog/index.js';
import type {A2uiLitElement as A2uiLitElementType} from './a2ui-lit-element.js';
import type {A2uiController as A2uiControllerType} from './a2ui-controller.js';

interface TestMockHostElement extends HTMLElement {
  context: ComponentContext;
  testController: A2uiControllerType<typeof TextApiType>;
  addController(controller: unknown): void;
  requestUpdate(): void;
}

/**
 * These tests verify:
 * - Proper initialization and subscription to component model changes.
 * - Automatically triggering `requestUpdate()` on the host element when data properties change.
 * - Safely cleaning up subscriptions when the host is disconnected or the controller is disposed.
 */
describe('A2uiController', () => {
  let basicCatalog: Catalog<WebComponentImplementation>;
  let A2uiController: typeof A2uiControllerType;
  let TextApi: typeof TextApiType;
  let MessageProcessorClass: typeof MessageProcessor;
  let ComponentContextClass: typeof ComponentContext;
  let TestMockHostClass: CustomElementConstructor;

  function ensureCustomElement() {
    if (!customElements.get('test-mock-host')) {
      customElements.define('test-mock-host', TestMockHostClass);
    }
  }

  /**
   * Helper function to instantiate and append the `test-mock-host` custom element
   * defined in the `beforeAll()` hook below.
   */
  async function createMockHost(context: ComponentContext): Promise<TestMockHostElement> {
    ensureCustomElement();
    const mockHost = document.createElement('test-mock-host') as unknown as TestMockHostElement;
    document.body.appendChild(mockHost);

    // Initializing the context property triggers Lit's reactive execution cycle,
    // which in turn synchronously creates the controller instance via createController()
    // inside the custom element's update hooks.
    await asyncUpdate(mockHost, host => {
      host.context = context;
    });

    return mockHost;
  }

  before(async () => {
    setupTestDom();

    // Dynamically import component files *after* setting up JSDOM globals
    // to prevent LitElement from evaluating in an empty Node context and crashing.
    const {A2uiLitElement} = await import('./a2ui-lit-element.js');
    A2uiController = (await import('./a2ui-controller.js')).A2uiController;
    const webCore = await import('../index.js');
    MessageProcessorClass = webCore.MessageProcessor;
    ComponentContextClass = webCore.ComponentContext;
    const webCoreBasic = await import('../basic_catalog/index.js');
    basicCatalog = webCoreBasic.basicCatalog;
    TextApi = webCoreBasic.TextApi;

    /**
     * A real Lit element registered as `test-mock-host` in JSDOM.
     * Instances of this element are instantiated across the test suite
     * using the `createMockHost` helper function defined above.
     */
    class TestMockHost
      extends (A2uiLitElement as typeof A2uiLitElementType)<typeof TextApiType>
      implements TestMockHostElement
    {
      public testController!: A2uiControllerType<typeof TextApiType>;

      override createController() {
        // Automatically create and store the controller using the imported TextApi catalog.
        this.testController = new A2uiController(this, TextApi);
        return this.testController;
      }
    }
    TestMockHostClass = TestMockHost as unknown as CustomElementConstructor;
    ensureCustomElement();
  });

  after(teardownTestDom);

  let processor: MessageProcessor<WebComponentImplementation>;
  let surface: SurfaceModel<WebComponentImplementation>;
  let context: ComponentContext;

  beforeEach(() => {
    processor = new MessageProcessorClass([basicCatalog]);
    // Initialize the test surface and seed an initial text component
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'test-comp',
              component: 'Text',
              text: 'Initial',
            },
          ],
        },
      },
    ]);

    surface = processor.model.getSurface('test-surface')!;
    context = new ComponentContextClass(surface, 'test-comp');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should initialize with correct props and bind to context', async () => {
    ensureCustomElement();
    const mockHost = document.createElement('test-mock-host') as unknown as TestMockHostElement;
    document.body.appendChild(mockHost);

    let addControllerCalled = false;
    const origAddController = mockHost.addController.bind(mockHost);
    mockHost.addController = (controller: unknown) => {
      addControllerCalled = true;
      origAddController(controller);
    };

    await asyncUpdate(mockHost, host => {
      host.context = context;
    });

    const controller = mockHost.testController;
    assert.strictEqual(addControllerCalled, true);
    assert.strictEqual(controller.props.text, 'Initial');
  });

  it('should request update on host when data changes', async () => {
    const mockHost = await createMockHost(context);
    const controller = mockHost.testController;

    assert.strictEqual(controller.props.text, 'Initial');

    // Replace the text component with a path binding and populate the data model
    await asyncUpdate(processor, p =>
      p.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'test-surface',
            components: [
              {
                id: 'test-comp-2',
                component: 'Text',
                text: {path: '/myText'},
              },
            ],
          },
        },
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: 'test-surface',
            path: '/myText',
            value: 'Updated',
          },
        },
      ]),
    );

    // Simulate what happens when a component's ID changes or it gets recycled by
    // disposing the old controller and replacing the host context instance.
    controller.dispose();
    const context2 = new ComponentContextClass(surface, 'test-comp-2');

    const mockHost2 = await createMockHost(context2);
    const controller2 = mockHost2.testController;

    assert.strictEqual(controller2.props.text, 'Updated');

    let updateCount = 0;
    const origRequestUpdate = mockHost2.requestUpdate.bind(mockHost2);
    mockHost2.requestUpdate = () => {
      updateCount++;
      origRequestUpdate();
    };

    // Trigger another reactive update by advancing the bound data model property
    await asyncUpdate(processor, p =>
      p.processMessages([
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: 'test-surface',
            path: '/myText',
            value: 'Update2',
          },
        },
      ]),
    );

    assert.strictEqual(controller2.props.text, 'Update2');
    assert.ok(updateCount > 0);

    controller2.dispose();
  });

  it('should unsubscribe when host disconnected', async () => {
    const mockHost = await createMockHost(context);
    const controller = mockHost.testController;

    let updateCount = 0;
    mockHost.requestUpdate = () => {
      updateCount++;
    };

    controller.hostDisconnected();
    const initialCalls = updateCount;

    // Attempt to trigger a component update while the host is disconnected
    await asyncUpdate(processor, p =>
      p.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'test-surface',
            components: [
              {
                id: 'test-comp',
                component: 'Text',
                text: 'Another',
              },
            ],
          },
        },
      ]),
    );

    // Props should not update
    assert.notStrictEqual(controller.props.text, 'Another');
    // requestUpdate shouldn't be called again
    assert.strictEqual(updateCount, initialCalls);
  });
});
