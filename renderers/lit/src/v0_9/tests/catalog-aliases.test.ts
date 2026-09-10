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

import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';
import assert from 'node:assert';
import {describe, it, before, after} from 'node:test';
import {MessageProcessor, Catalog} from '@a2ui/web_core/v0_9';
import type {LitComponentApi} from '@a2ui/lit/v0_9';
import type {A2uiSurface} from '../surface/a2ui-surface.js';

const CANONICAL_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const LEGACY_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

/**
 * Verifies that agents still emitting the legacy, non-canonical basic catalog
 * id — notably existing Flutter genui deployments — keep rendering against the
 * Lit basic catalog after the id was standardized on the canonical spec URL.
 */
describe('Basic catalog id aliases', () => {
  let basicCatalog: Catalog<LitComponentApi>;

  before(async () => {
    setupTestDom();

    // Dynamically import component files *after* setting up JSDOM globals
    // to prevent LitElement from evaluating in an empty Node context.
    await import('../surface/a2ui-surface.js');
    basicCatalog = (await import('../catalogs/basic/index.js')).basicCatalog;
  });

  after(teardownTestDom);

  it('publishes the canonical id and aliases the legacy one', () => {
    assert.strictEqual(basicCatalog.id, CANONICAL_ID);
    assert.deepStrictEqual(basicCatalog.aliases, [LEGACY_ID]);
  });

  it('binds a surface created with the legacy id to the basic catalog', () => {
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog]);

    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 'legacy-surface', catalogId: LEGACY_ID},
      },
    ]);

    const surface = processor.model.getSurface('legacy-surface');
    assert.ok(surface, 'legacy catalog id should resolve to the basic catalog');
    assert.strictEqual(surface.catalog, basicCatalog);
  });

  it('renders a legacy-id surface end to end', async () => {
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog]);

    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 'legacy-surface', catalogId: LEGACY_ID},
      },
    ]);

    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.surface = processor.model.getSurface('legacy-surface')! as any;
    });

    await asyncUpdate(el, () => {
      processor.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'legacy-surface',
            components: [{id: 'root', component: 'Text', text: 'Hello Legacy'}],
          },
        },
      ]);
    });

    await el.updateComplete;
    const childEl = el.renderRoot.querySelector('a2ui-basic-text') as any;
    if (childEl && childEl.updateComplete) {
      await childEl.updateComplete;
    }

    assert.ok(
      childEl?.innerHTML?.includes('Hello Legacy'),
      'legacy-id surface should render basic catalog components; got: ' + childEl?.innerHTML,
    );

    document.body.removeChild(el);
  });

  it('keeps surfaces on the legacy and canonical ids independent', () => {
    // Both ids reach the same catalog, but they must remain separate surfaces.
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog]);

    processor.processMessages([
      {version: 'v0.9', createSurface: {surfaceId: 'legacy', catalogId: LEGACY_ID}},
      {version: 'v0.9', createSurface: {surfaceId: 'modern', catalogId: CANONICAL_ID}},
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'legacy',
          components: [{id: 'root', component: 'Text', text: 'from legacy'}],
        },
      },
    ]);

    const legacy = processor.model.getSurface('legacy');
    const modern = processor.model.getSurface('modern');

    assert.strictEqual(legacy?.catalog, basicCatalog);
    assert.strictEqual(modern?.catalog, basicCatalog);
    assert.notStrictEqual(legacy, modern);
    assert.strictEqual(modern?.componentsModel.get('root'), undefined);
  });

  it('rejects an unrelated catalog id even though aliases exist', () => {
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog]);

    assert.throws(() =>
      processor.processMessages([
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'https://a2ui.org/specification/v0_9/other_catalog.json',
          },
        },
      ]),
    );
  });
});
