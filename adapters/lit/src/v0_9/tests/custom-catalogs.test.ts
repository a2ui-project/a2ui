/*
 * Copyright 2025 Google LLC
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

import assert from 'node:assert';
import {describe, it, before, after} from 'node:test';
import {MessageProcessor, Catalog, ComponentApi} from '@a2ui/web_core/v0_9';
import type {LitComponentApi} from '@a2ui/lit/v0_9';
import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';
import type {A2uiSurface} from '../surface/a2ui-surface.js';

import {z} from 'zod';

// A mock custom component API
const CustomWidgetApi = {
  name: 'CustomWidget',
  tagName: 'a2ui-customwidget',
  schema: z.object({
    label: z.string().optional(),
  }),
}; // satisfies LitComponentApi

// A custom catalog wrapping the component
const customCatalog = new Catalog<LitComponentApi>('custom-catalog-v1', [CustomWidgetApi]);

/**
 * Verifies that:
 * - Users can successfully define and integrate their own custom `Catalog` schemas.
 * - The A2UI `MessageProcessor` and downstream controllers can handle multiple
 *   disparate catalogs running concurrently within the same environment across different surfaces.
 */
describe('Custom Catalogs Integration', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();

    // Dynamically import component files *after* setting up JSDOM globals
    // to prevent LitElement from evaluating in an empty Node context.
    await import('../surface/a2ui-surface.js');
    basicCatalog = (await import('../catalogs/basic/index.js')).basicCatalog;
  });

  after(teardownTestDom);

  it('should allow users to define and use their own custom catalogs', async () => {
    // MessageProcessor instantiated exclusively with the custom catalog
    const processor = new MessageProcessor<LitComponentApi>([customCatalog]);

    // Initialize a surface mapped to the custom catalog and populate it with a CustomWidget
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'custom-surface',
          catalogId: customCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'custom-surface',
          components: [
            {
              id: 'root',
              component: 'CustomWidget',
              label: 'Hello Custom',
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('custom-surface')!;
    assert.ok(surface, 'Surface should be created safely using the custom catalog');

    const rootNode = surface.componentsModel.get('root') as any;
    assert.strictEqual(rootNode?.type, 'CustomWidget');
  });

  it('should handle multiple catalogs concurrently across different surfaces', async () => {
    // MessageProcessor instantiated with MULTIPLE catalogs
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog, customCatalog]);

    // Create two independent surfaces concurrently, mapping them to their respective
    // catalogs, and populate each with a component type unique to that catalog.
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'minimal-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'custom-surface',
          catalogId: customCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'minimal-surface',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'From Minimal',
            },
          ],
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'custom-surface',
          components: [
            {
              id: 'root',
              component: 'CustomWidget',
              label: 'From Custom',
            },
          ],
        },
      },
    ]);

    const minimalSurf = processor.model.getSurface('minimal-surface')!;
    const customSurf = processor.model.getSurface('custom-surface')!;

    assert.ok(minimalSurf);
    assert.ok(customSurf);

    // Mount visual surfaces recursively evaluating the nodes
    const el1 = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    const el2 = document.createElement('a2ui-surface') as unknown as A2uiSurface;

    await asyncUpdate(el1, (e: any) => {
      document.body.appendChild(e);
      e.surface = minimalSurf;
    });

    await asyncUpdate(el2, (e: any) => {
      document.body.appendChild(e);
      e.surface = customSurf;
    });

    // Validates that the minimal catalog surface spawned the classic a2ui-text node
    assert.ok(el1.shadowRoot?.querySelector('a2ui-basic-text'));

    // Validates that the custom catalog surface dynamically spawned the custom node tag `<a2ui-customwidget>`
    assert.ok(el2.shadowRoot?.querySelector('a2ui-customwidget'));
  });
});
