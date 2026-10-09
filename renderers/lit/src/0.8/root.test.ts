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
import {describe, it, after, before} from 'node:test';
import {LitElement, html} from 'lit';
import {property, state} from 'lit/decorators.js';

describe('0.8 Root Custom Component Property Filtering', () => {
  let Root: typeof import('./ui/root.js').Root;
  let componentRegistry: typeof import('./ui/component-registry.js').componentRegistry;

  before(async () => {
    setupTestDom();
    const rootMod = await import('./ui/root.js');
    const registryMod = await import('./ui/component-registry.js');
    Root = rootMod.Root;
    componentRegistry = registryMod.componentRegistry;

    class SchemaBackedWidget extends Root {
      @property({type: String})
      accessor titleText = '';

      @property({type: String})
      accessor unexposedProp = 'initial';

      @state()
      accessor internalState = 'safe';

      override render() {
        return html`<div class="title">${this.titleText}</div>
          <slot></slot>`;
      }
    }

    componentRegistry.register(
      'SchemaBackedWidget',
      SchemaBackedWidget,
      'a2ui-test-schema-widget',
      {
        type: 'object',
        properties: {
          titleText: {type: 'string'},
          innerHTML: {type: 'string'},
        },
      },
    );

    class DecoratorBackedWidget extends LitElement {
      @property({type: String})
      accessor label = '';

      @property({type: String})
      accessor text = '';

      @state()
      accessor secretState = 'hidden';

      override render() {
        return html`<span>${this.label}: ${this.text}</span>`;
      }
    }

    componentRegistry.register(
      'DecoratorBackedWidget',
      DecoratorBackedWidget,
      'a2ui-test-decorator-widget',
    );
  });

  after(teardownTestDom);

  it('assigns allowed schema properties while blocking DOM sinks and unexposed properties', async () => {
    const root = document.createElement('a2ui-root') as InstanceType<typeof Root>;
    root.enableCustomElements = true;
    root.surfaceId = 'trusted-surface';
    document.body.appendChild(root);

    const maliciousClick = () => 'xss';
    await asyncUpdate(root, (r: any) => {
      r.childComponents = [
        {
          type: 'SchemaBackedWidget',
          id: 'widget-1',
          slotName: 'header',
          properties: {
            titleText: 'Allowed Title',
            unexposedProp: 'should-not-be-set',
            internalState: 'tampered',
            innerHTML: '<img src="x" onerror="alert(1)">',
            outerHTML: '<div>replaced</div>',
            srcdoc: '<script>alert(1)</script>',
            src: 'https://evil.example/script.js',
            href: 'javascript:alert(1)',
            formaction: 'https://evil.example/post',
            is: 'custom-builtin',
            style: 'display:none',
            onclick: maliciousClick,
            onerror: maliciousClick,
            'data-evil': 'payload',
            surfaceId: 'spoofed-surface',
            id: 'spoofed-id',
            slot: 'spoofed-slot',
            dataContextPath: '/spoofed',
            arbitraryKey: 'unexpected',
          },
        },
      ];
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    const widget = root.querySelector('a2ui-test-schema-widget') as any;
    assert.ok(widget, 'Expected custom widget to be rendered');
    assert.strictEqual(widget.titleText, 'Allowed Title');
    assert.strictEqual(widget.unexposedProp, 'initial');
    assert.strictEqual(widget.internalState, 'safe');
    assert.strictEqual(widget.querySelector('img[onerror]'), null);
    assert.strictEqual(widget.onclick, null);
    assert.strictEqual(widget.onerror, null);
    assert.strictEqual(widget.src, undefined);
    assert.strictEqual(widget.href, undefined);
    assert.strictEqual(widget.formaction, undefined);
    assert.strictEqual(widget.srcdoc, undefined);
    assert.strictEqual(widget['data-evil'], undefined);
    assert.strictEqual(widget.arbitraryKey, undefined);

    // Host bindings set by Root must not be overwritten by component.properties
    assert.strictEqual(widget.surfaceId, 'trusted-surface');
    assert.strictEqual(widget.id, 'widget-1');
    assert.strictEqual(widget.slot, 'header');
    assert.strictEqual(widget.dataContextPath, '/');

    document.body.removeChild(root);
  });

  it('assigns declared @property fields on schema-less custom elements while blocking @state and DOM sinks', async () => {
    const root = document.createElement('a2ui-root') as InstanceType<typeof Root>;
    root.enableCustomElements = true;
    document.body.appendChild(root);

    await asyncUpdate(root, (r: any) => {
      r.childComponents = [
        {
          type: 'DecoratorBackedWidget',
          id: 'widget-2',
          properties: {
            label: 'Username',
            text: 'Alice',
            secretState: 'leaked',
            innerHTML: '<script>alert(1)</script>',
            onmouseover: () => {},
            undeclaredProp: 'blocked',
          },
        },
      ];
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    const widget = root.querySelector('a2ui-test-decorator-widget') as any;
    assert.ok(widget, 'Expected decorator-backed widget to be rendered');
    assert.strictEqual(widget.label, 'Username');
    assert.strictEqual(widget.text, 'Alice');
    assert.strictEqual(widget.secretState, 'hidden');
    assert.strictEqual(widget.innerHTML, '');
    assert.strictEqual(widget.onmouseover, null);
    assert.strictEqual(widget.undeclaredProp, undefined);

    document.body.removeChild(root);
  });

  it('applies the same allowlist and denylist in renderCustomComponent', () => {
    const root = document.createElement('a2ui-root') as any;
    root.enableCustomElements = true;
    root.surfaceId = 'trusted-surface';

    const template = root.renderCustomComponent({
      type: 'SchemaBackedWidget',
      id: 'widget-3',
      properties: {
        titleText: 'Safe Direct Call',
        innerHTML: '<img src="x" onerror="alert(2)">',
        srcdoc: '<script>alert(2)</script>',
        surfaceId: 'hijacked-surface',
      },
    });

    const renderedEl = template?.values?.[0];
    assert.ok(renderedEl);
    assert.strictEqual(renderedEl.titleText, 'Safe Direct Call');
    assert.strictEqual(renderedEl.innerHTML, '');
    assert.strictEqual(renderedEl.srcdoc, undefined);
    assert.strictEqual(renderedEl.surfaceId, 'trusted-surface');
  });
});
