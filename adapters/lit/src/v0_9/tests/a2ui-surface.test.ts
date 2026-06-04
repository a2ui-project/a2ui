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

import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';
import assert from 'node:assert';
import {describe, it, beforeEach, after, before} from 'node:test';
import type {A2uiSurface} from '../surface/a2ui-surface.js';
import {MessageProcessor} from '@a2ui/web_core/v0_9';

/**
 * These tests verify that the surface element:
 * - Renders nothing when no surface model is provided.
 * - Renders a loading state when the surface exists but the root component is missing.
 * - Renders the actual root component once it becomes available in the data model.
 */
describe('A2uiSurface', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();

    // Dynamically import component files *after* setting up JSDOM globals
    // to prevent LitElement from evaluating in an empty Node context and crashing.
    await import('../surface/a2ui-surface.js');
    basicCatalog = (await import('../catalogs/basic/index.js')).basicCatalog;
  });
  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surfaceModel: any;

  beforeEach(() => {
    processor = new MessageProcessor([basicCatalog]);
    // Initialize the test surface
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: basicCatalog.id,
        },
      },
    ]);

    surfaceModel = processor.model.getSurface('test-surface')!;
  });

  it('should render nothing when surface is undefined', async () => {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    await asyncUpdate(el, e => document.body.appendChild(e as any));

    // Without surface, it should render nothing
    assert.strictEqual(el.shadowRoot?.innerHTML, '<!---->');

    document.body.removeChild(el);
  });

  it('should render loading state when surface has no root component', async () => {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.surface = surfaceModel;
    });

    const html = el.shadowRoot?.innerHTML;
    assert.ok(html?.includes('Loading surface'), 'Should contain loading text');

    document.body.removeChild(el);
  });

  it('should render root component once it becomes available', async () => {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.surface = surfaceModel;
    });

    assert.ok(el.shadowRoot?.innerHTML?.includes('Loading surface'));

    // Add root component
    await asyncUpdate(el, () => {
      processor.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'test-surface',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello JSDOM',
              },
            ],
          },
        },
      ]);
    });

    await el.updateComplete;

    // Wait for the child element (a2ui-text) to finish updating as well
    const childEl = el.shadowRoot?.querySelector('a2ui-basic-text') as any;
    if (childEl && childEl.updateComplete) {
      await childEl.updateComplete;
    }

    const html = el.shadowRoot?.innerHTML;
    const childHtml = childEl?.shadowRoot?.innerHTML;

    assert.ok(!html?.includes('Loading surface'), 'Loading text should be gone');
    assert.ok(childHtml?.includes('Hello JSDOM'), 'Actual child HTML: ' + childHtml);

    document.body.removeChild(el);
  });
});
