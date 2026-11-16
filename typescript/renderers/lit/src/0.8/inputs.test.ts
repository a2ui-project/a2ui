/* eslint-disable @typescript-eslint/no-explicit-any */
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

import {setupTestDom, teardownTestDom, asyncUpdate} from '../tests/dom-setup.js';
import assert from 'node:assert';
import {describe, it, after, before, afterEach} from 'node:test';
import type {AnyComponentNode, Theme} from '@a2ui/web_core/types/types';
import * as v0_8 from './core.js';
import {themeContext} from './ui/context/theme.js';

const mockTheme = {
  components: {
    Button: {'test-button': true},
    CheckBox: {
      container: {'test-cb-container': true},
      element: {'test-cb-element': true},
      label: {'test-cb-label': true},
    },
    DateTimeInput: {
      container: {'test-dt-container': true},
      element: {'test-dt-element': true},
      label: {'test-dt-label': true},
    },
    MultipleChoice: {
      container: {},
      element: {},
      label: {},
    },
    Slider: {
      container: {'test-slider-container': true},
      element: {'test-slider-element': true},
      label: {'test-slider-label': true},
    },
    TextField: {
      container: {'test-tf-container': true},
      element: {'test-tf-element': true},
      label: {'test-tf-label': true},
    },
    Text: {
      all: {},
      h1: {},
      h2: {},
      h3: {},
      h4: {},
      h5: {},
      caption: {},
      body: {},
    },
  },
  markdown: {
    p: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    ul: [],
    ol: [],
    li: [],
    a: [],
    strong: [],
    em: [],
  },
} as unknown as Theme;

function createProcessorWithData(contents: any[]) {
  const processor = new v0_8.Data.A2uiMessageProcessor();
  processor.processMessages([
    {
      beginRendering: {
        surfaceId: '@default',
        root: 'root',
      },
    },
    {
      dataModelUpdate: {
        surfaceId: '@default',
        path: '/',
        contents,
      },
    },
  ]);
  return processor;
}

describe('0.8 Input Components', () => {
  const mountedElements: HTMLElement[] = [];
  const onContextRequest = (event: Event) => {
    const ctxEvent = event as any;
    if (ctxEvent.context === themeContext && typeof ctxEvent.callback === 'function') {
      event.stopPropagation();
      ctxEvent.callback(mockTheme);
    }
  };

  before(async () => {
    setupTestDom();
    (global as any).CustomEvent = (window as any).CustomEvent;
    if (!(global as any).HTMLInputElement) {
      (global as any).HTMLInputElement = (window as any).HTMLInputElement;
    }
    Object.setPrototypeOf(v0_8.Events.StateEvent, (window as any).CustomEvent);
    Object.setPrototypeOf(v0_8.Events.StateEvent.prototype, (window as any).CustomEvent.prototype);
    Object.setPrototypeOf(v0_8.WebEvents.A2UIValidationEvent, (window as any).CustomEvent);
    Object.setPrototypeOf(
      v0_8.WebEvents.A2UIValidationEvent.prototype,
      (window as any).CustomEvent.prototype,
    );
    document.body.addEventListener('context-request', onContextRequest);
    await import('./ui/ui.js');
  });

  afterEach(() => {
    while (mountedElements.length > 0) {
      mountedElements.pop()?.remove();
    }
  });

  after(() => {
    document.body.removeEventListener('context-request', onContextRequest);
    teardownTestDom();
  });

  it('Button renders child slot and dispatches a2ui.action on click', async () => {
    const el = document.createElement('a2ui-button') as any;
    el.id = 'submit-btn';
    el.theme = mockTheme;
    el.dataContextPath = '/form';
    const compNode = {
      id: 'submit-btn',
      type: 'Button',
      dataContextPath: '/form',
      properties: {},
    } as unknown as AnyComponentNode;
    el.component = compNode;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.action = {name: 'submitForm', context: []};
      e.childComponents = [
        {
          id: 'btn-label',
          type: 'Text',
          dataContextPath: '/form',
          properties: {text: {literalString: 'Submit'}},
        },
      ];
    });

    let capturedDetail: any = null;
    el.addEventListener('a2uiaction', (evt: Event) => {
      capturedDetail = (evt as CustomEvent).detail;
    });

    const button = el.shadowRoot?.querySelector('button') as HTMLButtonElement;
    assert.ok(button);
    button.click();

    assert.ok(capturedDetail);
    assert.strictEqual(capturedDetail.eventType, 'a2ui.action');
    assert.strictEqual(capturedDetail.action.name, 'submitForm');
    assert.strictEqual(capturedDetail.sourceComponentId, 'submit-btn');
    assert.strictEqual(capturedDetail.dataContextPath, '/form');
  });

  it('CheckBox renders bound value and writes back on input', async () => {
    const processor = createProcessorWithData([{key: 'agreed', valueBoolean: false}]);
    const compNode = {
      id: 'cb-1',
      type: 'CheckBox',
      dataContextPath: '/',
      properties: {},
    } as unknown as AnyComponentNode;

    const el = document.createElement('a2ui-checkbox') as any;
    el.theme = mockTheme;
    el.processor = processor;
    el.surfaceId = '@default';
    el.component = compNode;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.label = {literalString: 'Accept terms'};
      e.value = {path: '/agreed'};
    });

    const input = el.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const label = el.shadowRoot?.querySelector('label');
    assert.ok(input);
    assert.strictEqual(input.checked, false);
    assert.strictEqual(label?.textContent?.trim(), 'Accept terms');

    input.checked = true;
    input.dispatchEvent(new window.Event('input', {bubbles: true}));

    assert.strictEqual(processor.getData(compNode, '/agreed', '@default'), true);
  });

  it('DateTimeInput formats bound date value and writes back on input', async () => {
    const processor = createProcessorWithData([
      {key: 'tripDate', valueString: '2025-06-15T12:00:00'},
    ]);
    const compNode = {
      id: 'dt-1',
      type: 'DateTimeInput',
      dataContextPath: '/',
      properties: {},
    } as unknown as AnyComponentNode;

    const el = document.createElement('a2ui-datetimeinput') as any;
    el.theme = mockTheme;
    el.processor = processor;
    el.surfaceId = '@default';
    el.component = compNode;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.enableDate = true;
      e.enableTime = false;
      e.value = {path: '/tripDate'};
    });

    const input = el.shadowRoot?.querySelector('input') as HTMLInputElement;
    assert.ok(input);
    assert.strictEqual(input.type, 'date');
    assert.strictEqual(input.value, '2025-06-15');

    input.value = '2025-07-04';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));

    assert.strictEqual(processor.getData(compNode, '/tripDate', '@default'), '2025-07-04');
  });

  it('MultipleChoice renders options and writes toggled selections back to the model', async () => {
    const processor = createProcessorWithData([
      {
        key: 'tags',
        valueMap: [{key: '0', valueString: 'news'}],
      },
    ]);
    const compNode = {
      id: 'mc-1',
      type: 'MultipleChoice',
      dataContextPath: '/',
      properties: {},
    } as unknown as AnyComponentNode;
    processor.setData(compNode, '/tags', ['news'], '@default');

    const el = document.createElement('a2ui-multiplechoice') as any;
    el.theme = mockTheme;
    el.processor = processor;
    el.surfaceId = '@default';
    el.component = compNode;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.variant = 'chips';
      e.options = [
        {label: {literalString: 'News'}, value: 'news'},
        {label: {literalString: 'Sports'}, value: 'sports'},
      ];
      e.selections = {path: '/tags'};
    });

    const chips = Array.from(el.shadowRoot?.querySelectorAll('.chip') ?? []) as HTMLElement[];
    assert.strictEqual(chips.length, 2);
    assert.ok(chips[0].classList.contains('selected'));
    assert.ok(!chips[1].classList.contains('selected'));

    chips[1].click();
    await el.updateComplete;

    assert.deepStrictEqual(processor.getData(compNode, '/tags', '@default'), ['news', 'sports']);

    chips[0].click();
    await el.updateComplete;

    assert.deepStrictEqual(processor.getData(compNode, '/tags', '@default'), ['sports']);
  });

  it('Slider renders range input and writes back on input', async () => {
    const processor = createProcessorWithData([{key: 'volume', valueNumber: 25}]);
    const compNode = {
      id: 'slider-1',
      type: 'Slider',
      dataContextPath: '/',
      properties: {},
    } as unknown as AnyComponentNode;

    const el = document.createElement('a2ui-slider') as any;
    el.theme = mockTheme;
    el.processor = processor;
    el.surfaceId = '@default';
    el.component = compNode;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.label = {literalString: 'Volume'};
      e.minValue = 0;
      e.maxValue = 100;
      e.value = {path: '/volume'};
    });

    const input = el.shadowRoot?.querySelector('input[type="range"]') as HTMLInputElement;
    assert.ok(input);
    assert.strictEqual(String(input.value), '25');
    assert.strictEqual(input.getAttribute('min'), '0');
    assert.strictEqual(input.getAttribute('max'), '100');

    input.value = '70';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));

    assert.strictEqual(processor.getData(compNode, '/volume', '@default'), '70');
  });

  it('TextField renders bound text, applies safe validationRegexp, and writes back on input', async () => {
    const processor = createProcessorWithData([{key: 'username', valueString: 'alice'}]);
    const compNode = {
      id: 'tf-1',
      type: 'TextField',
      dataContextPath: '/',
      properties: {},
    } as unknown as AnyComponentNode;

    const el = document.createElement('a2ui-textfield') as any;
    el.id = 'tf-1';
    el.theme = mockTheme;
    el.processor = processor;
    el.surfaceId = '@default';
    el.component = compNode;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.label = {literalString: 'Username'};
      e.text = {path: '/username'};
      e.validationRegexp = '^[a-z]+$';
    });

    const input = el.shadowRoot?.querySelector('input') as HTMLInputElement;
    const label = el.shadowRoot?.querySelector('label');
    assert.ok(input);
    assert.strictEqual(label?.textContent?.trim(), 'Username');
    assert.strictEqual(input.value, 'alice');
    assert.strictEqual(input.getAttribute('pattern'), '^[a-z]+$');

    let validationEventDetail: any = null;
    el.addEventListener('a2ui-validation-input', (evt: Event) => {
      validationEventDetail = (evt as CustomEvent).detail;
    });

    input.value = 'bob';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));

    assert.strictEqual(processor.getData(compNode, '/username', '@default'), 'bob');
    assert.ok(validationEventDetail);
    assert.strictEqual(validationEventDetail.componentId, 'tf-1');
    assert.strictEqual(validationEventDetail.value, 'bob');
  });
});
