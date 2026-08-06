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

import {describe, it, before, after} from 'node:test';
import assert from 'node:assert';
import {JSDOM} from 'jsdom';
import type {Catalog, WebComponentImplementation} from '../catalog/types.js';

interface GlobalWithDom {
  window?: unknown;
  document?: unknown;
  HTMLElement?: unknown;
  customElements?: unknown;
  Element?: unknown;
  Node?: unknown;
  Event?: unknown;
  MutationObserver?: unknown;
}

describe('WebComponentImplementation & basicCatalog', () => {
  let dom: JSDOM;
  let basicCatalog: Catalog<WebComponentImplementation>;
  const testGlobal = globalThis as GlobalWithDom;

  before(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    testGlobal.window = dom.window;
    testGlobal.document = dom.window.document;
    testGlobal.HTMLElement = dom.window.HTMLElement;
    testGlobal.customElements = dom.window.customElements;
    testGlobal.Element = dom.window.Element;
    testGlobal.Node = dom.window.Node;
    testGlobal.Event = dom.window.Event;
    testGlobal.MutationObserver = dom.window.MutationObserver;
    if (!dom.window.document.adoptedStyleSheets) {
      dom.window.document.adoptedStyleSheets = [];
    }

    basicCatalog = (await import('./index.js')).basicCatalog;
  });

  after(() => {
    delete testGlobal.window;
    delete testGlobal.document;
    delete testGlobal.HTMLElement;
    delete testGlobal.customElements;
    delete testGlobal.Element;
    delete testGlobal.Node;
    delete testGlobal.Event;
    delete testGlobal.MutationObserver;
  });

  it('exports canonical basicCatalog with correct catalog ID', () => {
    assert.strictEqual(
      basicCatalog.id,
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    );
  });

  it('contains all 18 universal components implementing WebComponentImplementation', () => {
    const expectedComponentNames = [
      'Text',
      'Button',
      'TextField',
      'Row',
      'Column',
      'List',
      'Image',
      'Icon',
      'Video',
      'AudioPlayer',
      'Card',
      'Divider',
      'CheckBox',
      'Slider',
      'DateTimeInput',
      'ChoicePicker',
      'Tabs',
      'Modal',
    ];

    assert.strictEqual(basicCatalog.components.size, 18);

    for (const name of expectedComponentNames) {
      const comp = basicCatalog.components.get(name) as WebComponentImplementation;
      assert.ok(comp, `Component ${name} should exist in basicCatalog`);
      assert.strictEqual(comp.name, name);
      assert.ok(
        typeof comp.tagName === 'string' && comp.tagName.length > 0,
        `Component ${name} must have a valid tagName`,
      );
      assert.ok(comp.schema, `Component ${name} must have a Zod schema`);
    }
  });

  it('instantiates custom element DOM elements for components in basicCatalog', () => {
    const buttonImpl = basicCatalog.components.get('Button') as WebComponentImplementation;
    assert.strictEqual(buttonImpl.tagName, 'a2ui-basic-button');

    const buttonEl = dom.window.document.createElement(buttonImpl.tagName);
    assert.ok(buttonEl);
    assert.strictEqual(buttonEl.tagName.toLowerCase(), 'a2ui-basic-button');
  });
});
