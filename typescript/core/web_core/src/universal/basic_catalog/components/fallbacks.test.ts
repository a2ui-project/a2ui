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

import * as assert from 'node:assert';
import {describe, it, before, after, afterEach} from 'node:test';
import {setupTestDom, teardownTestDom} from '../../../test/dom-setup.js';
import {html, render} from 'lit';
import {Catalog, MessageProcessor} from '../../../v0_9/index.js';
import type {ProcessableMessagePayload} from '../../../processing/message-processor.js';
import {NodeResolver} from '../../../resolution/node-resolver.js';
import type {A2uiFallbackRequest} from '../../../resolution/fallbacks.js';
import {getValue} from '../../../reactivity/signals.js';
import {
  type A2uiWebComponentElement,
  registerFallbackRenderer,
  registerUniversalElement,
  renderA2uiNode,
  type WebComponentImplementation,
} from '../../index.js';

/** Waits until no element below `root` has a pending Lit update. */
async function settle(root: Element) {
  for (let i = 0; i < 10; i++) {
    const pending = [root, ...root.querySelectorAll('*')]
      .map(e => (e as {updateComplete?: Promise<boolean>}).updateComplete)
      .filter(p => p !== undefined);
    const done = await Promise.all(pending);
    if (done.every(Boolean)) return;
  }
}

describe('universal elements render fallbacks for unresolved children', () => {
  let resolver: NodeResolver | undefined;
  let unregister: (() => void) | undefined;
  let container: HTMLElement | undefined;

  before(setupTestDom);
  after(teardownTestDom);
  afterEach(() => {
    unregister?.();
    resolver?.dispose();
    container?.remove();
  });

  for (const version of ['v0.9', '1.0'] as const) {
    it(`reaches nested Card and Column children with their parent type (${version})`, async () => {
      const catalog: Catalog<WebComponentImplementation> =
        version === 'v0.9'
          ? (await import('../../../v0_9/basic_catalog/index.js')).basicCatalog
          : (await import('../../../catalogs/basic/v1/index.js')).basicCatalog;
      catalog.components.forEach(c => registerUniversalElement(c));
      const processor = new MessageProcessor([catalog]);
      processor.processMessages([
        {version, createSurface: {surfaceId: 's', catalogId: catalog.id}},
        {
          version,
          updateComponents: {
            surfaceId: 's',
            components: [
              {id: 'root', component: 'Column', children: ['card', 'stars', 'loop']},
              {id: 'card', component: 'Card', child: 'late'},
              {id: 'stars', component: 'StarRating'},
              {id: 'loop', component: 'Row', children: ['loop']},
            ],
          },
        },
      ] as ProcessableMessagePayload);
      const surface = processor.model.getSurface('s')!;
      resolver = new NodeResolver(surface, catalog);
      const requests: A2uiFallbackRequest[] = [];
      unregister = registerFallbackRenderer(surface, request => {
        requests.push(request);
        return html`<span class="fb">${request.info.componentId}</span>`;
      });

      container = document.createElement('div');
      document.body.appendChild(container);
      const root = getValue(resolver.rootNode)!;
      render(renderA2uiNode(root, {surface}), container);
      await settle(container);

      assert.deepStrictEqual(
        [...container.querySelectorAll('.fb')].map(e => e.textContent),
        ['late', 'stars', 'loop'],
      );
      const byId = new Map(requests.map(r => [r.info.componentId, r]));
      assert.deepStrictEqual(byId.get('late'), {
        category: 'pending',
        info: {componentId: 'late', parentComponentType: 'Card'},
      });
      assert.deepStrictEqual(byId.get('stars'), {
        category: 'error',
        info: {
          componentId: 'stars',
          parentComponentType: 'Column',
          error: {type: 'unknown-type', componentType: 'StarRating'},
        },
      });
      assert.deepStrictEqual(byId.get('loop'), {
        category: 'error',
        info: {componentId: 'loop', parentComponentType: 'Row', error: {type: 'cyclic'}},
      });

      // The fallback sits where the child goes: inside the Card's element.
      const card = container.querySelector('a2ui-card') as A2uiWebComponentElement;
      assert.strictEqual(card.querySelector('.fb')?.textContent, 'late');
    });
  }

  it('renders nothing for unresolved children when the surface has no fallbacks', async () => {
    const catalog = (await import('../../../v0_9/basic_catalog/index.js')).basicCatalog;
    catalog.components.forEach(c => registerUniversalElement(c));
    const processor = new MessageProcessor([catalog]);
    processor.processMessages([
      {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: catalog.id}},
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{id: 'root', component: 'Card', child: 'late'}],
        },
      },
    ]);
    const surface = processor.model.getSurface('s')!;
    resolver = new NodeResolver(surface, catalog);
    container = document.createElement('div');
    document.body.appendChild(container);
    render(renderA2uiNode(getValue(resolver.rootNode)!, {surface}), container);
    await settle(container);
    const card = container.querySelector('a2ui-card')!;
    assert.strictEqual(card.querySelector('.fb'), null);
    assert.strictEqual(card.textContent?.trim(), '');
  });
});
