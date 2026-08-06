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

import {setupTestDom, teardownTestDom, asyncUpdate} from '../dom-setup.js';
import assert from 'node:assert';
import {describe, it, beforeEach, after, before} from 'node:test';
import {ComponentContext, MessageProcessor} from '@a2ui/web_core/v0_9';

describe('Card Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Card.js');
    await import('../../catalogs/basic/components/Text.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surface: any;

  beforeEach(() => {
    processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'card_default',
              component: 'Card',
              child: 'txt1',
            },
            {
              id: 'card_region',
              component: 'Card',
              child: 'txt1',
              accessibility: {
                role: 'region',
                label: 'Weather Card',
              },
            },
            {
              id: 'txt1',
              component: 'Text',
              text: 'Card Content',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render default card without region role', async () => {
    const el = document.createElement('a2ui-card') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'card_default');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    assert.strictEqual(el.getAttribute('role'), null);
    assert.strictEqual(el.getAttribute('aria-label'), null);

    document.body.removeChild(el);
  });

  it('should set region role and aria-label when accessibility role is region', async () => {
    const el = document.createElement('a2ui-card') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'card_region');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    assert.strictEqual(el.getAttribute('role'), 'region');
    assert.strictEqual(el.getAttribute('aria-label'), 'Weather Card');

    document.body.removeChild(el);
  });
});
