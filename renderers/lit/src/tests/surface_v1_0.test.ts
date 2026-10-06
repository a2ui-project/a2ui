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
import {describe, it, before, after, afterEach} from 'node:test';
import {z} from 'zod';
import {html, nothing} from 'lit';
import {MessageProcessor, Catalog} from '@a2ui/web_core';
import {A2uiLitElement, registerUniversalElement} from '@a2ui/web_core/universal';
import {basicCatalog as v1BasicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import type {A2uiSurface} from '../index.js';
import type {LitComponentApi} from '../types.js';

async function settleTree(node: Node): Promise<void> {
  const el = node as {updateComplete?: Promise<boolean>; shadowRoot?: ShadowRoot | null};
  if (el.updateComplete) {
    await el.updateComplete;
  }
  if (el.shadowRoot) {
    await settleTree(el.shadowRoot);
  }
  for (const child of Array.from(node.childNodes)) {
    await settleTree(child);
  }
}

describe('Lit v1.0 Surface & Catalog Integration', () => {
  let basicCatalog: Catalog<LitComponentApi>;
  const mountedElements: HTMLElement[] = [];

  before(async () => {
    setupTestDom();
    await import('../surface/a2ui-surface.js');
    basicCatalog = v1BasicCatalog as unknown as Catalog<LitComponentApi>;
  });

  afterEach(() => {
    while (mountedElements.length > 0) {
      mountedElements.pop()?.remove();
    }
  });

  after(teardownTestDom);

  async function mountSurface(surface: unknown): Promise<A2uiSurface> {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    mountedElements.push(el);
    document.body.appendChild(el);
    await asyncUpdate(el, e => {
      e.surface = surface as A2uiSurface['surface'];
    });
    await settleTree(el);
    return el;
  }

  it('renders a v1.0 createSurface payload with inline components and dataModel', async () => {
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'inline-v1-surface',
          catalogId: basicCatalog.id,
          dataModel: {
            greeting: 'Hello from v1.0 inline surface!',
          },
          components: [
            {
              id: 'root',
              component: 'Card',
              child: 'greeting_text',
            },
            {
              id: 'greeting_text',
              component: 'Text',
              text: {'@path': '/greeting'},
              variant: 'caption',
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('inline-v1-surface');
    assert.ok(surface, 'Surface should be created');

    const el = await mountSurface(surface);
    const textEl = el.renderRoot.querySelector('a2ui-basic-text');
    assert.ok(textEl, 'Should render a2ui-basic-text');
    assert.ok(
      textEl.textContent?.includes('Hello from v1.0 inline surface!'),
      `Expected greeting text, got: ${textEl.textContent}`,
    );
  });

  it('renders TextField.placeholder, Video.posterUrl, and Slider.steps + validation error', async () => {
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'props-v1-surface',
          catalogId: basicCatalog.id,
          components: [
            {
              id: 'root',
              component: 'Column',
              children: ['tf1', 'vid1', 'slider1'],
            },
            {
              id: 'tf1',
              component: 'TextField',
              label: 'Username',
              placeholder: 'Enter username',
              value: '',
            },
            {
              id: 'vid1',
              component: 'Video',
              url: 'https://example.com/clip.mp4',
              posterUrl: 'https://example.com/thumb.png',
            },
            {
              id: 'slider1',
              component: 'Slider',
              label: 'Volume',
              min: 0,
              max: 100,
              steps: 4,
              value: 5,
              checks: [
                {
                  condition: {
                    '@call': 'numeric',
                    args: {value: 5, min: 10},
                  },
                },
              ],
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('props-v1-surface')!;
    const el = await mountSurface(surface);

    const inputEl = el.renderRoot.querySelector('a2ui-basic-textfield input') as HTMLInputElement;
    assert.ok(inputEl, 'Should render TextField input');
    assert.strictEqual(inputEl.getAttribute('placeholder'), 'Enter username');

    const videoEl = el.renderRoot.querySelector('a2ui-video video') as HTMLVideoElement;
    assert.ok(videoEl, 'Should render Video element');
    assert.strictEqual(videoEl.getAttribute('poster'), 'https://example.com/thumb.png');

    const rangeEl = el.renderRoot.querySelector(
      'a2ui-slider input[type="range"]',
    ) as HTMLInputElement;
    assert.ok(rangeEl, 'Should render Slider range input');
    assert.strictEqual(rangeEl.getAttribute('step'), '25');

    const errorEl = el.renderRoot.querySelector('a2ui-slider .a2ui-error-message');
    assert.ok(errorEl, 'Should render Slider validation error message');
    assert.strictEqual(errorEl.textContent?.trim(), 'Minimum value is 10.');
  });

  it('renders accessibility ARIA attributes on components', async () => {
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'a11y-v1-surface',
          catalogId: basicCatalog.id,
          dataModel: {
            statusLabel: 'Live Status Banner',
          },
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'System normal',
              variant: 'caption',
              accessibility: {
                label: {'@path': '/statusLabel'},
                description: 'Detailed status description',
                live: 'polite',
                hidden: true,
              },
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('a11y-v1-surface')!;
    const el = await mountSurface(surface);

    const textEl = el.renderRoot.querySelector('a2ui-basic-text') as HTMLElement;
    assert.ok(textEl, 'Should render a2ui-basic-text');
    assert.strictEqual(textEl.getAttribute('aria-label'), 'Live Status Banner');
    assert.strictEqual(textEl.getAttribute('aria-description'), 'Detailed status description');
    assert.strictEqual(textEl.getAttribute('aria-live'), 'polite');
    assert.strictEqual(textEl.getAttribute('aria-hidden'), 'true');
  });

  it('evaluates @index inside a List template', async () => {
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'list-index-surface',
          catalogId: basicCatalog.id,
          dataModel: {
            tasks: [{title: 'First'}, {title: 'Second'}, {title: 'Third'}],
          },
          components: [
            {
              id: 'root',
              component: 'List',
              children: {
                componentId: 'task_row',
                path: '/tasks',
              },
            },
            {
              id: 'task_row',
              component: 'Row',
              children: ['task_idx', 'task_title'],
            },
            {
              id: 'task_idx',
              component: 'Text',
              variant: 'caption',
              text: {
                '@call': 'formatNumber',
                args: {
                  value: {
                    '@call': '@index',
                    args: {offset: 1},
                  },
                  decimals: 0,
                },
              },
            },
            {
              id: 'task_title',
              component: 'Text',
              variant: 'caption',
              text: {'@path': 'title'},
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('list-index-surface')!;
    const el = await mountSurface(surface);

    const rows = Array.from(el.renderRoot.querySelectorAll('a2ui-basic-row'));
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].textContent?.replace(/\s+/g, '').trim(), '1First');
    assert.strictEqual(rows[1].textContent?.replace(/\s+/g, '').trim(), '2Second');
    assert.strictEqual(rows[2].textContent?.replace(/\s+/g, '').trim(), '3Third');
  });

  it('handles local openUrl functionCall action vs. event action dispatch', async () => {
    const dispatchedActions: Array<{name: string; context?: Record<string, unknown>}> = [];
    const processor = new MessageProcessor<LitComponentApi>([basicCatalog], action => {
      dispatchedActions.push(action);
    });

    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'actions-v1-surface',
          catalogId: basicCatalog.id,
          components: [
            {
              id: 'root',
              component: 'Row',
              children: ['open_url_btn', 'event_btn'],
            },
            {
              id: 'open_url_label',
              component: 'Text',
              variant: 'caption',
              text: 'Open Website',
            },
            {
              id: 'open_url_btn',
              component: 'Button',
              child: 'open_url_label',
              action: {
                functionCall: {
                  '@call': 'openUrl',
                  args: {url: 'https://example.com/docs'},
                },
              },
            },
            {
              id: 'event_label',
              component: 'Text',
              variant: 'caption',
              text: 'Submit Form',
            },
            {
              id: 'event_btn',
              component: 'Button',
              child: 'event_label',
              action: {
                event: {
                  name: 'submit_form',
                  context: {source: 'unit_test'},
                },
              },
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('actions-v1-surface')!;
    const el = await mountSurface(surface);

    const buttons = Array.from(
      el.renderRoot.querySelectorAll('a2ui-basic-button button'),
    ) as HTMLButtonElement[];
    assert.strictEqual(buttons.length, 2);

    let openedUrl: string | undefined;
    const origOpen = window.open;
    window.open = ((url: string) => {
      openedUrl = url;
      return null;
    }) as typeof window.open;

    try {
      buttons[0].click();
      assert.strictEqual(openedUrl, 'https://example.com/docs');
      assert.strictEqual(
        dispatchedActions.length,
        0,
        'Local functionCall action should not dispatch an agent event',
      );

      buttons[1].click();
      assert.strictEqual(dispatchedActions.length, 1);
      assert.strictEqual(dispatchedActions[0].name, 'submit_form');
      assert.deepStrictEqual(dispatchedActions[0].context, {source: 'unit_test'});
    } finally {
      window.open = origOpen;
    }
  });

  it('renders multi-catalog surfaces when child or root component uses a secondary catalogId', async () => {
    const CustomPanelApi = {
      name: 'CustomPanel',
      schema: z
        .object({
          heading: z.string(),
          child: z.string().optional(),
        })
        .strict(),
    };

    class CustomPanelElement extends A2uiLitElement<typeof CustomPanelApi> {
      protected override readonly api = CustomPanelApi;
      override createRenderRoot() {
        return this;
      }
      override render() {
        const props = this.controller?.props;
        if (!props) return nothing;
        return html`
          <div class="custom-panel">
            <strong class="custom-panel-heading">${props.heading}</strong>
            ${props.child ? this.renderNode(props.child) : nothing}
          </div>
        `;
      }
    }

    const CustomPanelImpl: LitComponentApi = {
      ...CustomPanelApi,
      tagName: 'a2ui-v1-test-custom-panel',
      element: CustomPanelElement,
    };
    registerUniversalElement(CustomPanelImpl);

    const secondaryCatalog = new Catalog<LitComponentApi>(
      'https://example.com/catalogs/custom-v1.json',
      '1.0',
      [CustomPanelImpl],
      [],
    );

    const processor = new MessageProcessor<LitComponentApi>([basicCatalog, secondaryCatalog]);

    // Case A: Surface default catalog is basicCatalog, child uses secondaryCatalog
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'multi-child-surface',
          catalogId: basicCatalog.id,
          components: [
            {
              id: 'root',
              component: 'Column',
              children: ['panel_child'],
            },
            {
              id: 'panel_child',
              component: 'CustomPanel',
              catalogId: secondaryCatalog.id,
              heading: 'Secondary Child Heading',
            },
          ],
        },
      },
    ]);

    const childSurface = processor.model.getSurface('multi-child-surface')!;
    const childEl = await mountSurface(childSurface);
    const panelInChild = childEl.renderRoot.querySelector('.custom-panel-heading');
    assert.ok(panelInChild, 'Should render secondary catalog child inside basic Column');
    assert.strictEqual(panelInChild.textContent?.trim(), 'Secondary Child Heading');

    // Case B: Surface default catalog is basicCatalog, root itself uses secondaryCatalog
    // and renders a child from basicCatalog
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'multi-root-surface',
          catalogId: basicCatalog.id,
          components: [
            {
              id: 'root',
              component: 'CustomPanel',
              catalogId: secondaryCatalog.id,
              heading: 'Secondary Root Heading',
              child: 'inner_text',
            },
            {
              id: 'inner_text',
              component: 'Text',
              variant: 'caption',
              text: 'Basic Child Inside Secondary Root',
            },
          ],
        },
      },
    ]);

    const rootSurface = processor.model.getSurface('multi-root-surface')!;
    const rootEl = await mountSurface(rootSurface);
    const panelInRoot = rootEl.renderRoot.querySelector('.custom-panel-heading');
    assert.ok(panelInRoot, 'Should render secondary catalog root component');
    assert.strictEqual(panelInRoot.textContent?.trim(), 'Secondary Root Heading');

    const innerText = rootEl.renderRoot.querySelector('a2ui-basic-text');
    assert.ok(innerText, 'Should render basic catalog child inside secondary catalog root');
    assert.strictEqual(innerText.textContent?.trim(), 'Basic Child Inside Secondary Root');
  });
});
