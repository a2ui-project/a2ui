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
import {describe, it, after, before, beforeEach, afterEach} from 'node:test';
import type {AnyComponentNode, Theme} from '@a2ui/web_core/types/types';
import * as v0_8 from './core.js';
import {themeContext} from './ui/context/theme.js';

const mockTheme = {
  components: {
    Button: {'test-button': true},
    Card: {},
    Column: {},
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
    Tabs: {
      container: {},
      element: {},
      controls: {
        all: {},
        selected: {},
      },
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

const readText = (el: any) => el.shadowRoot?.querySelector('section')?.textContent?.trim();

describe('0.8 Input Components', () => {
  const mountedElements: HTMLElement[] = [];
  let RootClass: any;
  let componentRegistry: any;

  const onContextRequest = (event: Event) => {
    const ctxEvent = event as any;
    if (ctxEvent.context === themeContext && typeof ctxEvent.callback === 'function') {
      event.stopPropagation();
      ctxEvent.callback(mockTheme);
    }
  };

  async function mountSurface(
    processor: any,
    components: any[],
    contents: any[],
    options: {enableCustomElements?: boolean} = {},
  ) {
    processor.processMessages([
      {
        beginRendering: {
          surfaceId: '@default',
          root: 'col',
        },
      },
      {
        surfaceUpdate: {
          surfaceId: '@default',
          components,
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

    const surfaceEl = document.createElement('a2ui-surface') as any;
    surfaceEl.theme = mockTheme;
    surfaceEl.processor = processor;
    surfaceEl.surfaceId = '@default';
    surfaceEl.enableCustomElements = options.enableCustomElements ?? false;
    surfaceEl.surface = processor.getSurfaces().get('@default') ?? null;
    mountedElements.push(surfaceEl);
    document.body.appendChild(surfaceEl);

    await surfaceEl.updateComplete;
    await Promise.resolve();
    const rootEl = surfaceEl.shadowRoot?.querySelector('a2ui-root') as any;
    assert.ok(rootEl);
    await rootEl.updateComplete;
    await Promise.resolve();
    const colEl = rootEl.querySelector('a2ui-column') as any;
    assert.ok(colEl);
    await colEl.updateComplete;
    await Promise.resolve();
    return {surfaceEl, rootEl, colEl};
  }

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
    const uiMod = await import('./ui/ui.js');
    RootClass = uiMod.Root;
    const regMod = await import('./ui/component-registry.js');
    componentRegistry = regMod.componentRegistry;
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

  describe('DateTimeInput timezone and native format handling', () => {
    let prevTz: string | undefined;

    beforeEach(() => {
      prevTz = process.env.TZ;
      process.env.TZ = 'America/Los_Angeles';
    });

    afterEach(() => {
      if (prevTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = prevTz;
      }
    });

    it('preserves native date, time, and datetime-local values across re-renders', async () => {
      const processor = createProcessorWithData([
        {key: 'tripDate', valueString: '2025-06-15T12:00:00'},
        {key: 'alarmTime', valueString: '14:30'},
        {key: 'meetingAt', valueString: '2025-08-01T09:15'},
      ]);
      const compNode = {
        id: 'dt-1',
        type: 'DateTimeInput',
        dataContextPath: '/',
        properties: {},
      } as unknown as AnyComponentNode;

      const dateEl = document.createElement('a2ui-datetimeinput') as any;
      dateEl.theme = mockTheme;
      dateEl.processor = processor;
      dateEl.surfaceId = '@default';
      dateEl.component = compNode;
      mountedElements.push(dateEl);
      document.body.appendChild(dateEl);

      await asyncUpdate(dateEl, (e: any) => {
        e.enableDate = true;
        e.enableTime = false;
        e.value = {path: '/tripDate'};
      });

      const dateInput = dateEl.shadowRoot?.querySelector('input') as HTMLInputElement;
      assert.ok(dateInput);
      assert.strictEqual(dateInput.type, 'date');
      assert.strictEqual(dateInput.value, '2025-06-15');

      dateInput.value = '2025-08-01';
      dateInput.dispatchEvent(new window.Event('input', {bubbles: true}));
      await dateEl.updateComplete;

      assert.strictEqual(processor.getData(compNode, '/tripDate', '@default'), '2025-08-01');
      assert.strictEqual(dateInput.value, '2025-08-01');

      const timeEl = document.createElement('a2ui-datetimeinput') as any;
      timeEl.theme = mockTheme;
      timeEl.processor = processor;
      timeEl.surfaceId = '@default';
      timeEl.component = compNode;
      mountedElements.push(timeEl);
      document.body.appendChild(timeEl);

      await asyncUpdate(timeEl, (e: any) => {
        e.enableDate = false;
        e.enableTime = true;
        e.value = {path: '/alarmTime'};
      });

      const timeInput = timeEl.shadowRoot?.querySelector('input') as HTMLInputElement;
      assert.strictEqual(timeInput.type, 'time');
      assert.strictEqual(timeInput.value, '14:30');

      timeInput.value = '15:45';
      timeInput.dispatchEvent(new window.Event('input', {bubbles: true}));
      await timeEl.updateComplete;

      assert.strictEqual(processor.getData(compNode, '/alarmTime', '@default'), '15:45');
      assert.strictEqual(timeInput.value, '15:45');

      const dtLocalEl = document.createElement('a2ui-datetimeinput') as any;
      dtLocalEl.theme = mockTheme;
      dtLocalEl.processor = processor;
      dtLocalEl.surfaceId = '@default';
      dtLocalEl.component = compNode;
      mountedElements.push(dtLocalEl);
      document.body.appendChild(dtLocalEl);

      await asyncUpdate(dtLocalEl, (e: any) => {
        e.enableDate = true;
        e.enableTime = true;
        e.value = {path: '/meetingAt'};
      });

      const dtLocalInput = dtLocalEl.shadowRoot?.querySelector('input') as HTMLInputElement;
      assert.strictEqual(dtLocalInput.type, 'datetime-local');
      assert.strictEqual(dtLocalInput.value, '2025-08-01T09:15');

      dtLocalInput.value = '2025-08-01T16:45';
      dtLocalInput.dispatchEvent(new window.Event('input', {bubbles: true}));
      await dtLocalEl.updateComplete;

      assert.strictEqual(processor.getData(compNode, '/meetingAt', '@default'), '2025-08-01T16:45');
      assert.strictEqual(dtLocalInput.value, '2025-08-01T16:45');
    });
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

  it('Slider renders range input and updates its span readout on input', async () => {
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
    const valueReadout = el.shadowRoot?.querySelector('span');
    assert.ok(input);
    assert.strictEqual(String(input.value), '25');
    assert.strictEqual(valueReadout?.textContent?.trim(), '25');
    assert.strictEqual(input.getAttribute('min'), '0');
    assert.strictEqual(input.getAttribute('max'), '100');

    input.value = '70';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
    await el.updateComplete;

    assert.strictEqual(processor.getData(compNode, '/volume', '@default'), '70');
    assert.strictEqual(el.shadowRoot?.querySelector('span')?.textContent?.trim(), '70');
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

  it('TextField re-renders bound sibling Text on the same surface', async () => {
    const processor = new v0_8.Data.A2uiMessageProcessor();
    const {colEl} = await mountSurface(
      processor,
      [
        {id: 'col', component: {Column: {children: {explicitList: ['tf', 'mirror']}}}},
        {
          id: 'tf',
          component: {TextField: {label: {literalString: 'Name'}, text: {path: '/username'}}},
        },
        {id: 'mirror', component: {Text: {text: {path: '/username'}}}},
      ],
      [{key: 'username', valueString: 'alice'}],
    );

    const tf = colEl.querySelector('#tf') as any;
    const mirror = colEl.querySelector('#mirror') as any;
    await Promise.all([tf.updateComplete, mirror.updateComplete]);
    assert.strictEqual(readText(mirror), 'alice');

    const input = tf.shadowRoot?.querySelector('input') as HTMLInputElement;
    input.value = 'charlie';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
    await mirror.updateComplete;
    assert.strictEqual(readText(mirror), 'charlie');
  });

  it('CheckBox re-renders bound sibling Text on the same surface', async () => {
    const processor = new v0_8.Data.A2uiMessageProcessor();
    const {colEl} = await mountSurface(
      processor,
      [
        {id: 'col', component: {Column: {children: {explicitList: ['cb', 'mirror']}}}},
        {
          id: 'cb',
          component: {CheckBox: {label: {literalString: 'Agree'}, value: {path: '/agreed'}}},
        },
        {id: 'mirror', component: {Text: {text: {path: '/agreed'}}}},
      ],
      [{key: 'agreed', valueBoolean: false}],
    );

    const cb = colEl.querySelector('#cb') as any;
    const mirror = colEl.querySelector('#mirror') as any;
    await Promise.all([cb.updateComplete, mirror.updateComplete]);
    assert.strictEqual(readText(mirror), 'false');

    const input = cb.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
    await mirror.updateComplete;
    assert.strictEqual(readText(mirror), 'true');
  });

  it('DateTimeInput re-renders bound sibling Text and preserves input value on the same surface', async () => {
    const processor = new v0_8.Data.A2uiMessageProcessor();
    const {colEl} = await mountSurface(
      processor,
      [
        {id: 'col', component: {Column: {children: {explicitList: ['dt', 'mirror']}}}},
        {
          id: 'dt',
          component: {
            DateTimeInput: {value: {path: '/tripDate'}, enableDate: true, enableTime: false},
          },
        },
        {id: 'mirror', component: {Text: {text: {path: '/tripDate'}}}},
      ],
      [{key: 'tripDate', valueString: '2025-06-15'}],
    );

    const dt = colEl.querySelector('#dt') as any;
    const mirror = colEl.querySelector('#mirror') as any;
    await Promise.all([dt.updateComplete, mirror.updateComplete]);
    assert.strictEqual(readText(mirror), '2025-06-15');

    const input = dt.shadowRoot?.querySelector('input') as HTMLInputElement;
    input.value = '2025-08-01';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
    await Promise.all([dt.updateComplete, mirror.updateComplete]);
    assert.strictEqual(input.value, '2025-08-01');
    assert.strictEqual(readText(mirror), '2025-08-01');
  });

  it('Slider re-renders bound sibling Text and its readout on the same surface', async () => {
    const processor = new v0_8.Data.A2uiMessageProcessor();
    const {colEl} = await mountSurface(
      processor,
      [
        {id: 'col', component: {Column: {children: {explicitList: ['sl', 'mirror']}}}},
        {
          id: 'sl',
          component: {
            Slider: {
              label: {literalString: 'Vol'},
              value: {path: '/volume'},
              minValue: 0,
              maxValue: 100,
            },
          },
        },
        {id: 'mirror', component: {Text: {text: {path: '/volume'}}}},
      ],
      [{key: 'volume', valueNumber: 25}],
    );

    const sl = colEl.querySelector('#sl') as any;
    const mirror = colEl.querySelector('#mirror') as any;
    await Promise.all([sl.updateComplete, mirror.updateComplete]);
    assert.strictEqual(readText(mirror), '25');

    const input = sl.shadowRoot?.querySelector('input[type="range"]') as HTMLInputElement;
    input.value = '88';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
    await Promise.all([sl.updateComplete, mirror.updateComplete]);
    assert.strictEqual(sl.shadowRoot?.querySelector('span')?.textContent?.trim(), '88');
    assert.strictEqual(readText(mirror), '88');
  });

  it('MultipleChoice re-renders bound sibling Text on the same surface', async () => {
    const processor = new v0_8.Data.A2uiMessageProcessor();
    const {colEl} = await mountSurface(
      processor,
      [
        {id: 'col', component: {Column: {children: {explicitList: ['mc', 'mirror']}}}},
        {
          id: 'mc',
          component: {
            MultipleChoice: {
              selections: {path: '/tags'},
              options: [
                {label: {literalString: 'News'}, value: 'news'},
                {label: {literalString: 'Sports'}, value: 'sports'},
              ],
            },
          },
        },
        {id: 'mirror', component: {Text: {text: {path: '/tags'}}}},
      ],
      [],
    );
    const rootComp = {
      id: 'mc',
      type: 'MultipleChoice',
      dataContextPath: '/',
      properties: {},
    } as any;
    processor.setData(rootComp, '/tags', ['news'], '@default');

    const mc = colEl.querySelector('#mc') as any;
    const mirror = colEl.querySelector('#mirror') as any;
    mc.variant = 'chips';
    mc.requestUpdate();
    mirror.requestUpdate();
    await Promise.all([mc.updateComplete, mirror.updateComplete]);
    assert.strictEqual(readText(mirror), 'news');

    const chips = Array.from(mc.shadowRoot?.querySelectorAll('.chip') ?? []) as HTMLElement[];
    chips[1].click();
    await Promise.all([mc.updateComplete, mirror.updateComplete]);
    assert.strictEqual(readText(mirror), 'news,sports');
  });

  it('notifies connected Root peers across plain wrappers and nested ShadowRoots without re-rendering Surface', async () => {
    const tagName = 'test-v08-custom-box';
    if (!customElements.get(tagName)) {
      class CustomBox extends RootClass {}
      customElements.define(tagName, CustomBox);
      componentRegistry.register('CustomBox', CustomBox, tagName);
    }

    const processor = new v0_8.Data.A2uiMessageProcessor();
    const {colEl} = await mountSurface(
      processor,
      [
        {
          id: 'col',
          component: {Column: {children: {explicitList: ['tf', 'tabs']}}},
        },
        {
          id: 'tf',
          component: {TextField: {label: {literalString: 'Name'}, text: {path: '/username'}}},
        },
        {
          id: 'tabs',
          component: {
            Tabs: {
              tabItems: [{title: {literalString: 'Tab 1'}, child: 'custom-1'}],
            },
          },
        },
        {
          id: 'custom-1',
          component: {CustomBox: {}},
        },
      ],
      [{key: 'username', valueString: 'alice'}],
      {enableCustomElements: true},
    );

    // Mount standalone peers outside <a2ui-surface> (inside a plain <div> and a nested ShadowRoot).
    const plainWrapper = document.createElement('div');
    const nestedHost = document.createElement('div');
    const nestedShadow = nestedHost.attachShadow({mode: 'open'});
    const standaloneMirror = document.createElement('a2ui-text') as any;
    standaloneMirror.theme = mockTheme;
    standaloneMirror.processor = processor;
    standaloneMirror.surfaceId = null; // Resolves to '@default'
    standaloneMirror.component = {
      id: 'standalone-mirror',
      type: 'Text',
      dataContextPath: '/',
      properties: {},
    };
    standaloneMirror.text = {path: '/username'};
    nestedShadow.appendChild(standaloneMirror);
    plainWrapper.appendChild(nestedHost);
    mountedElements.push(plainWrapper);
    document.body.appendChild(plainWrapper);

    const tabsEl = colEl.querySelector('#tabs') as any;
    await tabsEl.updateComplete;
    await Promise.resolve();
    await tabsEl.updateComplete;
    const customBefore = tabsEl.querySelector('#custom-1') as HTMLElement;
    assert.ok(customBefore);
    assert.strictEqual(customBefore.slot, 'current');
    await standaloneMirror.updateComplete;
    assert.strictEqual(readText(standaloneMirror), 'alice');

    const tf = colEl.querySelector('#tf') as any;
    const input = tf.shadowRoot?.querySelector('input') as HTMLInputElement;
    input.value = 'diana';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));

    await Promise.all([tf.updateComplete, tabsEl.updateComplete, standaloneMirror.updateComplete]);
    await Promise.resolve();

    assert.strictEqual(readText(standaloneMirror), 'diana');
    const customAfter = tabsEl.querySelector('#custom-1') as HTMLElement;
    assert.strictEqual(customAfter, customBefore);
    assert.strictEqual(customAfter.isConnected, true);
    assert.strictEqual(customAfter.slot, 'current');
  });

  describe('surface, processor, and guard isolation', () => {
    let windowErrors = 0;
    const onError = () => {
      windowErrors += 1;
    };

    beforeEach(() => {
      windowErrors = 0;
      window.addEventListener('error', onError);
    });

    afterEach(() => {
      window.removeEventListener('error', onError);
    });

    it('isolates updates by surfaceId and processor and skips disconnected or null-component hosts', async () => {
      const processor = new v0_8.Data.A2uiMessageProcessor();
      const otherProcessor = createProcessorWithData([{key: 'username', valueString: 'other'}]);
      const {colEl} = await mountSurface(
        processor,
        [
          {id: 'col', component: {Column: {children: {explicitList: ['tf']}}}},
          {
            id: 'tf',
            component: {TextField: {label: {literalString: 'Name'}, text: {path: '/username'}}},
          },
        ],
        [{key: 'username', valueString: 'alice'}],
      );

      const otherSurfaceText = document.createElement('a2ui-text') as any;
      otherSurfaceText.theme = mockTheme;
      otherSurfaceText.processor = processor;
      otherSurfaceText.surfaceId = 'other-surface';
      otherSurfaceText.component = {
        id: 'other-surface-text',
        type: 'Text',
        dataContextPath: '/',
        properties: {},
      };
      otherSurfaceText.text = {literalString: 'untouched'};
      colEl.appendChild(otherSurfaceText);

      const otherProcessorText = document.createElement('a2ui-text') as any;
      otherProcessorText.theme = mockTheme;
      otherProcessorText.processor = otherProcessor;
      otherProcessorText.surfaceId = '@default';
      otherProcessorText.component = {
        id: 'other-proc-text',
        type: 'Text',
        dataContextPath: '/',
        properties: {},
      };
      otherProcessorText.text = {path: '/username'};
      colEl.appendChild(otherProcessorText);

      const sameSurfacePeer = document.createElement('a2ui-text') as any;
      sameSurfacePeer.theme = mockTheme;
      sameSurfacePeer.processor = processor;
      sameSurfacePeer.surfaceId = '@default';
      sameSurfacePeer.component = {
        id: 'same-surface-peer',
        type: 'Text',
        dataContextPath: '/',
        properties: {},
      };
      sameSurfacePeer.text = {path: '/username'};
      colEl.appendChild(sameSurfacePeer);

      await Promise.all([
        otherSurfaceText.updateComplete,
        otherProcessorText.updateComplete,
        sameSurfacePeer.updateComplete,
      ]);

      let otherSurfaceUpdates = 0;
      const origOtherSurfaceReq = otherSurfaceText.requestUpdate.bind(otherSurfaceText);
      otherSurfaceText.requestUpdate = (...args: any[]) => {
        otherSurfaceUpdates += 1;
        return origOtherSurfaceReq(...args);
      };

      let otherProcessorUpdates = 0;
      const origOtherProcReq = otherProcessorText.requestUpdate.bind(otherProcessorText);
      otherProcessorText.requestUpdate = (...args: any[]) => {
        otherProcessorUpdates += 1;
        return origOtherProcReq(...args);
      };

      let sameSurfacePeerUpdates = 0;
      const origSamePeerReq = sameSurfacePeer.requestUpdate.bind(sameSurfacePeer);
      sameSurfacePeer.requestUpdate = (...args: any[]) => {
        sameSurfacePeerUpdates += 1;
        return origSamePeerReq(...args);
      };

      const tf = colEl.querySelector('#tf') as any;
      const tfInput = tf.shadowRoot?.querySelector('input') as HTMLInputElement;
      tfInput.value = 'updated';
      tfInput.dispatchEvent(new window.Event('input', {bubbles: true}));
      await sameSurfacePeer.updateComplete;

      assert.strictEqual(otherSurfaceUpdates, 0);
      assert.strictEqual(otherProcessorUpdates, 0);
      assert.strictEqual(sameSurfacePeerUpdates, 1);

      const orphanTf = document.createElement('a2ui-textfield') as any;
      orphanTf.theme = mockTheme;
      orphanTf.processor = processor;
      orphanTf.component = null;
      orphanTf.text = {path: '/username'};
      mountedElements.push(orphanTf);
      document.body.appendChild(orphanTf);
      await orphanTf.updateComplete;

      sameSurfacePeerUpdates = 0;
      const orphanInput = orphanTf.shadowRoot?.querySelector('input') as HTMLInputElement;
      orphanInput.value = 'ignored-null-component';
      orphanInput.dispatchEvent(new window.Event('input', {bubbles: true}));
      assert.strictEqual(sameSurfacePeerUpdates, 0);

      orphanTf.component = {
        id: 'detached-tf',
        type: 'TextField',
        dataContextPath: '/',
        properties: {},
      };
      orphanTf.remove();
      orphanInput.value = 'detached-edit';
      orphanInput.dispatchEvent(new window.Event('input', {bubbles: true}));
      assert.strictEqual(sameSurfacePeerUpdates, 0);
      assert.strictEqual(windowErrors, 0);
    });
  });

  it('skips peer broadcast when using createSignalA2uiMessageProcessor so unrelated elements do not re-render', async () => {
    const processor = v0_8.Data.createSignalA2uiMessageProcessor();
    const {colEl} = await mountSurface(
      processor,
      [
        {
          id: 'col',
          component: {Column: {children: {explicitList: ['tf', 'mirror', 'literal']}}},
        },
        {
          id: 'tf',
          component: {TextField: {label: {literalString: 'Name'}, text: {path: '/username'}}},
        },
        {id: 'mirror', component: {Text: {text: {path: '/username'}}}},
        {id: 'literal', component: {Text: {text: {literalString: 'Static'}}}},
      ],
      [{key: 'username', valueString: 'alice'}],
    );

    const tf = colEl.querySelector('#tf') as any;
    const mirror = colEl.querySelector('#mirror') as any;
    const literal = colEl.querySelector('#literal') as any;
    await Promise.all([tf.updateComplete, mirror.updateComplete, literal.updateComplete]);

    let literalUpdates = 0;
    const origLiteralReq = literal.requestUpdate.bind(literal);
    literal.requestUpdate = (...args: any[]) => {
      literalUpdates += 1;
      return origLiteralReq(...args);
    };

    const input = tf.shadowRoot?.querySelector('input') as HTMLInputElement;
    input.value = 'signal-bob';
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
    await mirror.updateComplete;

    assert.strictEqual(readText(mirror), 'signal-bob');
    assert.strictEqual(literalUpdates, 0);
  });
});
