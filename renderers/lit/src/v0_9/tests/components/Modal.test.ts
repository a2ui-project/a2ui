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
    await import('../../catalogs/basic/components/Button.js');
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
              id: 'modal_test',
              component: 'Modal',
              trigger: 'trigger_btn',
              content: 'content_txt',
              accessibility: {
                label: 'Confirmation Modal',
                description: 'Please confirm your action',
              },
            },
            {
              id: 'trigger_btn',
              component: 'Button',
              child: 'trigger_txt',
            },
            {
              id: 'trigger_txt',
              component: 'Text',
              text: 'Open Modal',
            },
            {
              id: 'content_txt',
              component: 'Text',
              text: 'Modal Content',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render dialog with accessibility label, description, and close button label', async () => {
    const el = document.createElement('a2ui-modal') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'modal_test');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const dialog = el.shadowRoot.querySelector('dialog');
    assert.ok(dialog);
    assert.strictEqual(dialog.getAttribute('aria-label'), 'Confirmation Modal');
    assert.strictEqual(dialog.getAttribute('aria-describedby'), 'modal_test-description');

    const closeBtn = el.shadowRoot.querySelector('.a2ui-modal-close');
    assert.ok(closeBtn);
    assert.strictEqual(closeBtn.getAttribute('aria-label'), 'Close');

    const desc = el.shadowRoot.querySelector('#modal_test-description');
    assert.ok(desc);
    assert.strictEqual(desc.textContent.trim(), 'Please confirm your action');

    document.body.removeChild(el);
  });
});
