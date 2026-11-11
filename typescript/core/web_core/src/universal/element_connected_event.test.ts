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

import * as assert from 'node:assert';
import {after, before, describe, it} from 'node:test';

import type {ComponentContext} from '../resolution/component-context.js';
import type {ComponentNode} from '../resolution/component-node.js';
import {setupTestDom, teardownTestDom} from '../test/dom-setup.js';
import type {A2uiWebComponentElement} from './a2ui_web_component_element.js';
import {
  A2UI_ELEMENT_CONNECTED_EVENT,
  dispatchA2uiElementConnected,
} from './element_connected_event.js';

describe('dispatchA2uiElementConnected', () => {
  before(setupTestDom);
  after(teardownTestDom);

  const context = {} as ComponentContext;

  function recordEvents(): Event[] {
    const events: Event[] = [];
    document.body.addEventListener(A2UI_ELEMENT_CONNECTED_EVENT, event => events.push(event));
    return events;
  }

  function createElement(fields: Partial<A2uiWebComponentElement>): A2uiWebComponentElement {
    return Object.assign(document.createElement('div'), fields);
  }

  it('dispatches a bubbling, composed event once per element', () => {
    const events = recordEvents();
    const element = createElement({context});
    document.body.appendChild(element);

    dispatchA2uiElementConnected(element);
    dispatchA2uiElementConnected(element);
    element.remove();
    document.body.appendChild(element);
    dispatchA2uiElementConnected(element);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].target, element);
    assert.ok(events[0].bubbles);
    assert.ok(events[0].composed);
    element.remove();
  });

  it('accepts the context of the element node', () => {
    const events = recordEvents();
    const element = createElement({node: {context} as ComponentNode});
    document.body.appendChild(element);

    dispatchA2uiElementConnected(element);

    assert.deepStrictEqual(
      events.map(event => event.target),
      [element],
    );
    element.remove();
  });

  it('skips a disconnected element, and dispatches once it is connected', () => {
    const events = recordEvents();
    const element = createElement({context});

    dispatchA2uiElementConnected(element);
    assert.strictEqual(events.length, 0);

    document.body.appendChild(element);
    dispatchA2uiElementConnected(element);
    assert.strictEqual(events.length, 1);
    element.remove();
  });

  it('skips an element without a context, and dispatches once it has one', () => {
    const events = recordEvents();
    const element = createElement({});
    document.body.appendChild(element);

    dispatchA2uiElementConnected(element);
    assert.strictEqual(events.length, 0);

    element.context = context;
    dispatchA2uiElementConnected(element);
    assert.strictEqual(events.length, 1);
    element.remove();
  });
});
