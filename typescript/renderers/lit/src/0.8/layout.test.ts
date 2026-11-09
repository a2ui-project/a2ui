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
    Card: {'test-card': true},
    Column: {'test-column': true},
    Row: {'test-row': true},
    List: {'test-list': true},
    Modal: {
      backdrop: {'test-modal-backdrop': true},
      element: {'test-modal-element': true},
    },
    Tabs: {
      container: {'test-tabs-container': true},
      element: {'test-tabs-element': true},
      controls: {
        all: {'test-tab-btn': true},
        selected: {'test-tab-selected': true},
      },
    },
    Text: {
      all: {'test-text': true},
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

function makeTextNode(id: string, text: string, slotName?: string): AnyComponentNode {
  return {
    id,
    type: 'Text',
    dataContextPath: '/',
    slotName,
    properties: {
      text: {literalString: text},
    },
  } as unknown as AnyComponentNode;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('0.8 Layout Components', () => {
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
    if (!(global as any).HTMLDialogElement) {
      (global as any).HTMLDialogElement =
        (window as any).HTMLDialogElement ?? (window as any).HTMLElement;
    }
    const dialogProto = (global as any).HTMLDialogElement?.prototype;
    if (dialogProto && !dialogProto.showModal) {
      dialogProto.showModal = function () {
        this.open = true;
      };
      dialogProto.close = function () {
        this.open = false;
      };
    }
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

  it('Card renders child components in declared order', async () => {
    const el = document.createElement('a2ui-card') as any;
    el.theme = mockTheme;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.childComponents = [makeTextNode('c1', 'First'), makeTextNode('c2', 'Second')];
    });
    await flushMicrotasks();

    const section = el.shadowRoot?.querySelector('section');
    assert.ok(section);
    assert.ok(section.classList.contains('test-card'));

    const renderedIds = Array.from(el.children).map((child: any) => child.id);
    assert.deepStrictEqual(renderedIds, ['c1', 'c2']);
  });

  it('Column renders children in order and reflects alignment and distribution', async () => {
    const el = document.createElement('a2ui-column') as any;
    el.theme = mockTheme;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.alignment = 'center';
      e.distribution = 'spaceBetween';
      e.childComponents = [
        makeTextNode('col-1', 'Alpha'),
        makeTextNode('col-2', 'Beta'),
        makeTextNode('col-3', 'Gamma'),
      ];
    });
    await flushMicrotasks();

    assert.strictEqual(el.getAttribute('alignment'), 'center');
    assert.strictEqual(el.getAttribute('distribution'), 'spaceBetween');
    const renderedIds = Array.from(el.children).map((child: any) => child.id);
    assert.deepStrictEqual(renderedIds, ['col-1', 'col-2', 'col-3']);
  });

  it('Row renders children in order and reflects alignment and distribution', async () => {
    const el = document.createElement('a2ui-row') as any;
    el.theme = mockTheme;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.alignment = 'end';
      e.distribution = 'spaceEvenly';
      e.childComponents = [makeTextNode('row-1', 'Left'), makeTextNode('row-2', 'Right')];
    });
    await flushMicrotasks();

    assert.strictEqual(el.getAttribute('alignment'), 'end');
    assert.strictEqual(el.getAttribute('distribution'), 'spaceEvenly');
    const renderedIds = Array.from(el.children).map((child: any) => child.id);
    assert.deepStrictEqual(renderedIds, ['row-1', 'row-2']);
  });

  it('List renders children in order and reflects direction', async () => {
    const el = document.createElement('a2ui-list') as any;
    el.theme = mockTheme;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.direction = 'horizontal';
      e.childComponents = [makeTextNode('item-1', 'Item 1'), makeTextNode('item-2', 'Item 2')];
    });
    await flushMicrotasks();

    assert.strictEqual(el.getAttribute('direction'), 'horizontal');
    const renderedIds = Array.from(el.children).map((child: any) => child.id);
    assert.deepStrictEqual(renderedIds, ['item-1', 'item-2']);
  });

  it('Modal renders entry trigger initially and opens dialog on click', async () => {
    const el = document.createElement('a2ui-modal') as any;
    el.theme = mockTheme;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.childComponents = [
        makeTextNode('modal-entry', 'Open Modal', 'entry'),
        makeTextNode('modal-content', 'Modal Body'),
      ];
    });
    await flushMicrotasks();

    const renderedChildren = Array.from(el.children) as HTMLElement[];
    assert.deepStrictEqual(
      renderedChildren.map(c => c.id),
      ['modal-entry', 'modal-content'],
    );
    assert.strictEqual(renderedChildren[0].slot, 'entry');

    const entrySlot = el.shadowRoot?.querySelector('slot[name="entry"]');
    assert.ok(entrySlot);
    assert.strictEqual(el.shadowRoot?.querySelector('dialog'), null);

    const triggerSection = el.shadowRoot?.querySelector('section') as HTMLElement;
    assert.ok(triggerSection);
    triggerSection.click();
    await el.updateComplete;

    const dialog = el.shadowRoot?.querySelector('dialog');
    assert.ok(dialog);
    const closeBtn = dialog.querySelector('#controls button') as HTMLButtonElement;
    assert.ok(closeBtn);
    closeBtn.click();
    await el.updateComplete;

    assert.strictEqual(el.shadowRoot?.querySelector('dialog'), null);
  });

  it('Tabs renders titles and switches the active slotted child on click', async () => {
    const processor = new v0_8.Data.A2uiMessageProcessor();
    processor.processMessages([
      {
        beginRendering: {
          surfaceId: '@default',
          root: 'tabs-1',
        },
      },
      {
        dataModelUpdate: {
          surfaceId: '@default',
          path: '/',
          contents: [{key: 'secondTabTitle', valueString: 'Bound Second'}],
        },
      },
    ]);

    const el = document.createElement('a2ui-tabs') as any;
    el.theme = mockTheme;
    el.processor = processor;
    el.surfaceId = '@default';
    el.component = {id: 'tabs-1', type: 'Tabs', dataContextPath: '/', properties: {}};
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.titles = [{literalString: 'First Tab'}, {path: '/secondTabTitle'}];
      e.childComponents = [
        makeTextNode('tab-pane-1', 'Pane 1'),
        makeTextNode('tab-pane-2', 'Pane 2'),
      ];
    });
    await flushMicrotasks();
    await el.updateComplete;

    const buttons = Array.from(
      el.shadowRoot?.querySelectorAll('#buttons button') ?? [],
    ) as HTMLButtonElement[];
    assert.strictEqual(buttons.length, 2);
    assert.strictEqual(buttons[0].textContent?.trim(), 'First Tab');
    assert.strictEqual(buttons[1].textContent?.trim(), 'Bound Second');

    const panes = Array.from(el.children) as HTMLElement[];
    assert.deepStrictEqual(
      panes.map(p => p.id),
      ['tab-pane-1', 'tab-pane-2'],
    );
    assert.strictEqual(panes[0].slot, 'current');
    assert.strictEqual(panes[1].getAttribute('slot'), null);

    buttons[1].click();
    await el.updateComplete;

    assert.strictEqual(el.selected, 1);
    assert.strictEqual(panes[0].getAttribute('slot'), null);
    assert.strictEqual(panes[1].slot, 'current');
  });
});
