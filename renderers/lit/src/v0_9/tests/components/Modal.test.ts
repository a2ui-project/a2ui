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

describe('Modal Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Modal.js');
    await import('../../catalogs/basic/components/Text.js'); // For trigger and content
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
              id: 'modal_normal',
              component: 'Modal',
              trigger: 'txt_trigger',
              content: 'txt_content',
            },
            {
              id: 'modal_a11y',
              component: 'Modal',
              trigger: 'txt_trigger',
              content: 'txt_content',
              accessibility: {
                label: 'Information Dialog',
                description: 'This dialog shows important information',
              },
            },
            {
              id: 'txt_trigger',
              component: 'Text',
              text: 'Open Modal',
            },
            {
              id: 'txt_content',
              component: 'Text',
              text: 'Modal Content',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render modal with trigger and content', async () => {
    const el = document.createElement('a2ui-modal') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'modal_normal');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const trigger = el.shadowRoot.querySelector('.a2ui-modal-trigger');
    assert.ok(trigger);
    const dialog = el.shadowRoot.querySelector('dialog');
    assert.ok(dialog);

    document.body.removeChild(el);
  });

  it('should render accessibility attributes on dialog in Modal', async () => {
    const el = document.createElement('a2ui-modal') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'modal_a11y');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const dialog = el.shadowRoot.querySelector('dialog');
    assert.ok(dialog);
    assert.strictEqual(dialog.getAttribute('aria-label'), 'Information Dialog');
    assert.strictEqual(dialog.getAttribute('aria-description'), 'This dialog shows important information');

    document.body.removeChild(el);
  });
});
