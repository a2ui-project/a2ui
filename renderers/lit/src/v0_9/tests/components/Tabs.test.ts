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

describe('Tabs Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/Tabs.js');
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
              id: 'tabs_test',
              component: 'Tabs',
              accessibility: {
                label: 'Navigation Tabs',
              },
              tabs: [
                {
                  title: 'Tab 1',
                  child: 'txt1',
                },
                {
                  title: 'Tab 2',
                  child: 'txt2',
                },
              ],
            },
            {
              id: 'txt1',
              component: 'Text',
              text: 'Panel 1 Content',
            },
            {
              id: 'txt2',
              component: 'Text',
              text: 'Panel 2 Content',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render tablist, tabs, and tabpanel with proper ARIA attributes', async () => {
    const el = document.createElement('a2ui-tabs') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'tabs_test');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const tablist = el.shadowRoot.querySelector('[role="tablist"]');
    assert.ok(tablist);
    assert.strictEqual(tablist.getAttribute('aria-label'), 'Navigation Tabs');

    const tabs = el.shadowRoot.querySelectorAll('[role="tab"]');
    assert.strictEqual(tabs.length, 2);
    assert.strictEqual(tabs[0].getAttribute('id'), 'tabs_test-tab-0');
    assert.strictEqual(tabs[0].getAttribute('aria-selected'), 'true');
    assert.strictEqual(tabs[0].getAttribute('aria-controls'), 'tabs_test-panel-0');

    assert.strictEqual(tabs[1].getAttribute('id'), 'tabs_test-tab-1');
    assert.strictEqual(tabs[1].getAttribute('aria-selected'), 'false');
    assert.strictEqual(tabs[1].getAttribute('aria-controls'), 'tabs_test-panel-1');

    const panel = el.shadowRoot.querySelector('[role="tabpanel"]');
    assert.ok(panel);
    assert.strictEqual(panel.getAttribute('id'), 'tabs_test-panel-0');
    assert.strictEqual(panel.getAttribute('aria-labelledby'), 'tabs_test-tab-0');

    // Switch tab
    tabs[1].click();
    await asyncUpdate(el, () => {});

    assert.strictEqual(tabs[0].getAttribute('aria-selected'), 'false');
    assert.strictEqual(tabs[1].getAttribute('aria-selected'), 'true');

    const updatedPanel = el.shadowRoot.querySelector('[role="tabpanel"]');
    assert.ok(updatedPanel);
    assert.strictEqual(updatedPanel.getAttribute('id'), 'tabs_test-panel-1');
    assert.strictEqual(updatedPanel.getAttribute('aria-labelledby'), 'tabs_test-tab-1');

    document.body.removeChild(el);
  });
});
