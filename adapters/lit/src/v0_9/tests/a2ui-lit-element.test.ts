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

import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';
import assert from 'node:assert';
import {describe, it, beforeEach, after, before} from 'node:test';

import {ComponentContext, MessageProcessor} from '@a2ui/web_core/v0_9';

let controllerCreatedCount = 0;
let disposedCount = 0;

/**
 * These tests ensure that:
 * - The element correctly instantiates an `A2uiController` when its ComponentContext is assigned.
 * - Changing the element's ComponentContext safely tears down the old controller and creates a new one.
 */
describe('A2uiLitElement', () => {
  let basicCatalog: any;
  before(async () => {
    setupTestDom();

    // Dynamically import component files *after* setting up JSDOM globals
    // to prevent LitElement from evaluating in an empty Node context and crashing.
    const {A2uiLitElement} = await import('../a2ui-lit-element.js');
    basicCatalog = (await import('../catalogs/basic/index.js')).basicCatalog;

    // Create a mock subclass to intercept and track controller lifecycle events
    class TestA2uiElement extends A2uiLitElement<any> {
      createController() {
        controllerCreatedCount++;
        return {
          dispose: () => {
            disposedCount++;
          },
        } as any;
      }

      render() {
        return this.renderNode('child_id');
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
    processor = new MessageProcessor([basicCatalog]);
    // Initialize the test surface with a nested root/child component structure and bound respective data contexts
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
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/',
          value: {myData: 'hello'},
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/child_id',
          value: {myData: 'world'},
        },
      },
    ]);

    surface = processor.model.getSurface('test-surface')!;
  });

  it('should create controller when context is set', async () => {
    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    // initially context is undefined so no controller is created
    assert.strictEqual(controllerCreatedCount, 0);

    const context = new ComponentContext(surface, 'root');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    assert.strictEqual(controllerCreatedCount, 1);
    document.body.removeChild(el);
  });

  it('should dispose old controller and create new one when context changes', async () => {
    const el = document.createElement('test-a2ui-element') as any;
    document.body.appendChild(el);

    const context1 = new ComponentContext(surface, 'root');
    await asyncUpdate(el, e => {
      e.context = context1;
    });

    assert.strictEqual(controllerCreatedCount, 1);
    assert.strictEqual(disposedCount, 0);

    // change context
    const context2 = new ComponentContext(surface, 'child_id');
    await asyncUpdate(el, e => {
      e.context = context2;
    });

    // should have disposed the old and created a new one
    assert.strictEqual(disposedCount, 1);
    assert.strictEqual(controllerCreatedCount, 2);

    document.body.removeChild(el);
  });
});
