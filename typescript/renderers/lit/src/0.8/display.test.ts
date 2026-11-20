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

const mockTheme = {
  components: {
    Text: {
      all: {'text-all': true},
      h1: {'heading-h1': true},
      h2: {'heading-h2': true},
      h3: {'heading-h3': true},
      h4: {'heading-h4': true},
      h5: {'heading-h5': true},
      caption: {'heading-caption': true},
      body: {'heading-body': true},
    },
    Icon: {'test-icon': true},
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

describe('0.8 Display Components (Text and Icon)', () => {
  const mountedElements: HTMLElement[] = [];

  before(async () => {
    setupTestDom();
    await import('./ui/text.js');
    await import('./ui/icon.js');
  });

  afterEach(() => {
    while (mountedElements.length > 0) {
      mountedElements.pop()?.remove();
    }
  });

  after(teardownTestDom);

  it('Text renders literalString, usageHint classes, and empty state', async () => {
    const el = document.createElement('a2ui-text') as any;
    el.theme = mockTheme;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, () => {});
    assert.ok(el.shadowRoot?.textContent?.includes('(empty)'));

    await asyncUpdate(el, (e: any) => {
      e.text = {literalString: 'Welcome Home'};
      e.usageHint = 'h2';
    });

    const section = el.shadowRoot?.querySelector('section');
    assert.ok(section);
    assert.ok(section.classList.contains('text-all'));
    assert.ok(section.classList.contains('heading-h2'));
    assert.strictEqual(el.getAttribute('usage-hint'), 'h2');
    assert.ok(section.textContent?.includes('Welcome Home'));
  });

  it('Text resolves data-bound path from A2uiMessageProcessor', async () => {
    const processor = new v0_8.Data.A2uiMessageProcessor();
    processor.processMessages([
      {
        beginRendering: {
          surfaceId: '@default',
          root: 'txt-1',
        },
      },
      {
        dataModelUpdate: {
          surfaceId: '@default',
          path: '/',
          contents: [{key: 'greeting', valueString: 'Hello from model'}],
        },
      },
    ]);

    const compNode = {
      id: 'txt-1',
      type: 'Text',
      dataContextPath: '/',
      properties: {},
    } as unknown as AnyComponentNode;

    const el = document.createElement('a2ui-text') as any;
    el.theme = mockTheme;
    el.processor = processor;
    el.surfaceId = '@default';
    el.component = compNode;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.text = {path: '/greeting'};
    });

    assert.ok(el.shadowRoot?.textContent?.includes('Hello from model'));
  });

  it('Icon renders snake_case material icon glyph from literal and bound names', async () => {
    const processor = new v0_8.Data.A2uiMessageProcessor();
    processor.processMessages([
      {
        beginRendering: {
          surfaceId: '@default',
          root: 'icon-1',
        },
      },
      {
        dataModelUpdate: {
          surfaceId: '@default',
          path: '/',
          contents: [{key: 'iconName', valueString: 'accountCircle'}],
        },
      },
    ]);

    const compNode = {
      id: 'icon-1',
      type: 'Icon',
      dataContextPath: '/',
      properties: {},
    } as unknown as AnyComponentNode;

    const el = document.createElement('a2ui-icon') as any;
    el.theme = mockTheme;
    el.processor = processor;
    el.surfaceId = '@default';
    el.component = compNode;
    mountedElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, (e: any) => {
      e.name = {literalString: 'shoppingCart'};
    });

    const glyph = el.shadowRoot?.querySelector('span.g-icon');
    assert.ok(glyph);
    assert.strictEqual(glyph.textContent, 'shopping_cart');

    await asyncUpdate(el, (e: any) => {
      e.name = {path: '/iconName'};
    });

    const boundGlyph = el.shadowRoot?.querySelector('span.g-icon');
    assert.ok(boundGlyph);
    assert.strictEqual(boundGlyph.textContent, 'account_circle');
  });
});
