/*
 * Copyright 2025 Google LLC
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

import assert from 'node:assert';
import {describe, it, beforeEach, mock, after, before} from 'node:test';
import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';

import {A2uiController} from '../a2ui-controller.js';
import {MessageProcessor, ComponentContext} from '@a2ui/web_core/v0_9';
import {TextApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * These tests verify:
 * - Proper initialization and subscription to component model changes.
 * - Automatically triggering `requestUpdate()` on the host element when data properties change.
 * - Safely cleaning up subscriptions when the host is disconnected or the controller is disposed.
 */
describe('A2uiController', () => {
  let basicCatalog: any;

  /**
   * Helper function to instantiate and append the `test-mock-host` custom element
   * defined in the `before()` hook below.
   */
  async function createMockHost(context: ComponentContext) {
    const mockHost = document.createElement('test-mock-host') as any;
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
    const {A2uiLitElement} = await import('../a2ui-lit-element.js');
    basicCatalog = (await import('../catalogs/basic/index.js')).basicCatalog;

    /**
     * A real Lit element registered as `test-mock-host` in JSDOM.
     * Instances of this element are instantiated across the test suite
     * using the `createMockHost` helper function defined above.
     */
    class TestMockHost extends A2uiLitElement<any> {
      public testController: any;

      override createController() {
        // Automatically create and store the controller using the imported TextApi catalog.
        this.testController = new A2uiController(this, TextApi);
        return this.testController;
      }
    }
    customElements.define('test-mock-host', TestMockHost);
  });

  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surface: any;
  let context: ComponentContext;

  beforeEach(() => {
    processor = new MessageProcessor([basicCatalog]);
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
    context = new ComponentContext(surface, 'test-comp');
  });

  it('should initialize with correct props and bind to context', async () => {
    // For this specific test, we manually mount the DOM element without the helper
    // because we need to spy on `addController` BEFORE the context is evaluated.
    const mockHost = document.createElement('test-mock-host') as any;
    document.body.appendChild(mockHost);

    mock.method(mockHost, 'addController');

    await asyncUpdate(mockHost, host => {
      host.context = context;
    });

    const controller = mockHost.testController;

    assert.ok((mockHost.addController as any).mock.calls.length >= 1);
    assert.strictEqual(controller.props.text, 'Initial');
  });

  it('should request update on host when data changes', async () => {
    const mockHost = await createMockHost(context);
    const controller = mockHost.testController;

    // Map requestUpdate only *after* initial initialization to catch changes
    mock.method(mockHost, 'requestUpdate');

    assert.strictEqual(controller.props.text, 'Initial');

    // Changing the model should trigger an update
    // We bind to a literal string so changing the literal string in component model works or we change data mode.
    // Wait, literal string doesn't get updated easily by data model.
    // Let's bind path instead.
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
    const context2 = new ComponentContext(surface, 'test-comp-2');

    const mockHost2 = await createMockHost(context2);
    const controller2 = mockHost2.testController;

    mock.method(mockHost2, 'requestUpdate');

    assert.strictEqual(controller2.props.text, 'Updated');

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
    assert.ok((mockHost2.requestUpdate as any).mock.calls.length > 0);

    controller2.dispose();
  });

  it('should unsubscribe when host disconnected', async () => {
    const mockHost = await createMockHost(context);
    const controller = mockHost.testController;

    mock.method(mockHost, 'requestUpdate');

    controller.hostDisconnected();

    const initialCalls = (mockHost.requestUpdate as any).mock.calls.length;

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
    assert.strictEqual((mockHost.requestUpdate as any).mock.calls.length, initialCalls);
  });
});
