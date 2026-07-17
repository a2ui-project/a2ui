/*
 * Copyright 2026 Google LLC
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

import {setupTestDom, teardownTestDom, asyncUpdate} from '../dom-setup.js';
import assert from 'node:assert';
import {describe, it, beforeEach, afterEach, after, before} from 'node:test';
import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  ComponentApi,
  SurfaceModel,
  Subscription,
  A2uiClientAction,
} from '@a2ui/web_core/v0_9';
import type {A2uiBasicButtonElement} from '../../catalogs/basic/components/Button.js';

describe('Button Component', () => {
  // Note: basicCatalog and the component files must be imported dynamically inside before()
  // because setupTestDom() initializes global browser variables (window, document, customElements)
  // that need to exist when the modules are evaluated and components register themselves.
  let basicCatalog: Catalog<ComponentApi>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    // Ensure components are registered
    await import('../../catalogs/basic/components/Button.js');
    await import('../../catalogs/basic/components/Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel;
  let element: A2uiBasicButtonElement | null = null;
  let subscription: Subscription | null = null;

  beforeEach(() => {
    processor = new MessageProcessor([basicCatalog]);
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
              id: 'btn1',
              component: 'Button',
              child: 'txt1',
              action: {event: {name: 'submit_clicked'}},
            },
            {
              id: 'btn_disabled',
              component: 'Button',
              child: 'txt1',
              isValid: false,
              action: {event: {name: 'ignored'}},
            },
            {
              id: 'txt1',
              component: 'Text',
              text: 'Click Me',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  afterEach(() => {
    subscription?.unsubscribe();
    subscription = null;
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render and dispatch action on click', async () => {
    const el = document.createElement('a2ui-basic-button') as A2uiBasicButtonElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'btn1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const button = el.shadowRoot?.querySelector('button');
    assert.ok(button);
    assert.strictEqual(button.disabled, false);

    const dispatched = {action: null as A2uiClientAction | null};
    subscription = surface.onAction.subscribe((action: A2uiClientAction) => {
      dispatched.action = action;
    });

    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(dispatched.action);
    assert.strictEqual(dispatched.action.name, 'submit_clicked');
  });

  it('should be disabled when isValid is false', async () => {
    const el = document.createElement('a2ui-basic-button') as A2uiBasicButtonElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'btn_disabled');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const button = el.shadowRoot?.querySelector('button');
    assert.ok(button);
    assert.strictEqual(button.disabled, true);

    let dispatchedAction = false;
    subscription = surface.onAction.subscribe(() => {
      dispatchedAction = true;
    });

    button.click();
    assert.strictEqual(dispatchedAction, false);
  });
});
