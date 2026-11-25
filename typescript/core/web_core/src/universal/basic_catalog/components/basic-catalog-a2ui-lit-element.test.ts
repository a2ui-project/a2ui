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
import {describe, it, before, beforeEach, after, afterEach} from 'node:test';
import {setupTestDom, teardownTestDom, asyncUpdate} from '../../../test/dom-setup.js';
import {z} from 'zod';
import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  ComponentApi,
  SurfaceModel,
  Subscription,
  peekValue,
} from '../../../v0_9/index.js';
import {CheckableSchema} from '../../../v0_9/schema/common-types.js';
import {NodeResolver} from '../../../resolution/node-resolver.js';
import type {ComponentNode} from '../../../resolution/component-node.js';

describe('BasicCatalogA2uiLitElement', () => {
  let customCatalog: Catalog<ComponentApi>;
  let injectBasicCatalogStyles: (targetRoot?: Document | ShadowRoot) => void;

  before(async () => {
    setupTestDom();

    const {BasicCatalogA2uiLitElement} = await import('./basic-catalog-a2ui-lit-element.js');
    const {injectBasicCatalogStyles: injectStyles} = await import('../styles/default.js');
    injectBasicCatalogStyles = injectStyles;
    const {renderValidationErrors} = await import('./accessibility.js');

    const {css, html} = await import('lit');

    const TestComponentSchema = z.object({
      text: z.string().optional(),
      weight: z.number().optional(),
      checks: CheckableSchema.shape.checks,
      accessibility: z
        .object({
          label: z.string().optional(),
          description: z.string().optional(),
          live: z.enum(['off', 'polite', 'assertive']).optional(),
          hidden: z.boolean().optional(),
        })
        .optional(),
    });

    const TestComponentApi: ComponentApi<typeof TestComponentSchema> = {
      name: 'TestComponent',
      schema: TestComponentSchema,
    };

    class TestBasicElement extends BasicCatalogA2uiLitElement<typeof TestComponentApi> {
      static override styles = css`
        :host {
          display: block;
          color: red;
        }
        .inner {
          font-size: 14px;
        }
      `;

      protected override readonly api = TestComponentApi;

      override render() {
        return html`
          <div class="inner">${this.controller?.props?.text ?? ''}</div>
          ${renderValidationErrors(this.domId, this.controller?.props)}
        `;
      }
    }

    if (!customElements.get('a2ui-test-basic-element')) {
      customElements.define('a2ui-test-basic-element', TestBasicElement);
    }

    customCatalog = new Catalog('https://test.catalog', '0.9', [TestComponentApi]);
  });

  after(teardownTestDom);

  let processor: MessageProcessor<ComponentApi>;
  let surface: SurfaceModel<ComponentApi>;
  let element: any = null;
  let subscription: Subscription | null = null;

  beforeEach(() => {
    processor = new MessageProcessor([customCatalog]);
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: customCatalog.id,
          theme: {
            primaryColor: '#ff0055',
          },
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'comp1',
              component: 'TestComponent',
              text: 'Hello',
              weight: 2,
            },
            {
              id: 'comp2',
              component: 'TestComponent',
              text: 'Themed',
            },
          ],
        },
      },
    ]);

    surface = processor.model.getSurface('test-surface')!;
  });

  afterEach(() => {
    subscription?.unsubscribe();
    subscription = null;
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('renders into light DOM (createRenderRoot returns this)', () => {
    element = document.createElement('a2ui-test-basic-element');
    assert.strictEqual(element.createRenderRoot(), element);
    assert.strictEqual(element.shadowRoot, null);
  });

  it('adopts and scopes component styles into document on connection', () => {
    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    const styleEl = document.head.querySelector('style');
    if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0) {
      assert.ok(document.adoptedStyleSheets.length > 0);
    } else {
      assert.notStrictEqual(styleEl, null);
      assert.ok(styleEl?.textContent?.includes('a2ui-test-basic-element'));
    }
  });

  it('adopts basic catalog styles only into shadow root when connected inside a shadow root', () => {
    document.adoptedStyleSheets = [];
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({mode: 'open'});
    document.body.appendChild(host);

    const shadowElement = document.createElement('a2ui-test-basic-element');
    shadowRoot.appendChild(shadowElement);

    const sheetsAfterConnect = shadowRoot.adoptedStyleSheets.length;
    assert.ok(sheetsAfterConnect > 0);
    // Re-running is a no-op only if connectedCallback already adopted the sheet,
    // which the component's own `static styles` cannot account for.
    injectBasicCatalogStyles(shadowRoot);
    assert.strictEqual(shadowRoot.adoptedStyleSheets.length, sheetsAfterConnect);
    assert.strictEqual(document.adoptedStyleSheets.length, 0);

    host.remove();
  });

  it('injectBasicCatalogStyles adopts into targetRoot when provided without polluting document', () => {
    document.adoptedStyleSheets = [];
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({mode: 'open'});
    document.body.appendChild(host);

    const existingSheet = new CSSStyleSheet();
    shadowRoot.adoptedStyleSheets = [existingSheet];

    injectBasicCatalogStyles(shadowRoot);

    // The default sheet goes first, so the host component's own rules win.
    assert.strictEqual(shadowRoot.adoptedStyleSheets.length, 2);
    assert.strictEqual(shadowRoot.adoptedStyleSheets[1], existingSheet);
    assert.strictEqual(document.adoptedStyleSheets.length, 0);

    host.remove();
  });

  it('injectBasicCatalogStyles falls back to a style tag when a shadow root rejects adoption', () => {
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({mode: 'open'});
    shadowRoot.appendChild(document.createElement('style'));
    Object.defineProperty(shadowRoot, 'adoptedStyleSheets', {
      get: () => [],
      set: () => {
        throw new Error('adoption is not supported');
      },
    });

    injectBasicCatalogStyles(shadowRoot);

    assert.ok(shadowRoot.querySelector('style[data-a2ui-basic-catalog]') !== null);
    // The style goes first, so the host component's own rules win.
    assert.ok(shadowRoot.firstElementChild?.matches('style[data-a2ui-basic-catalog]'));
    assert.strictEqual(document.head.querySelector('style[data-a2ui-basic-catalog]'), null);
  });

  it('injectBasicCatalogStyles falls back to a style tag in the document head when adoption is unavailable', () => {
    const original = document.adoptedStyleSheets;
    Object.defineProperty(document, 'adoptedStyleSheets', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    try {
      injectBasicCatalogStyles(document);
      injectBasicCatalogStyles(document);

      const styleEls = document.head.querySelectorAll('style[data-a2ui-basic-catalog]');
      assert.strictEqual(styleEls.length, 1);
    } finally {
      document.head.querySelector('style[data-a2ui-basic-catalog]')?.remove();
      Object.defineProperty(document, 'adoptedStyleSheets', {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });

  it('injectBasicCatalogStyles falls back to style tag injection when adoptedStyleSheets is absent', () => {
    const mockRoot = document.createElement('div') as any;
    // mockRoot has no adoptedStyleSheets property
    injectBasicCatalogStyles(mockRoot);

    const styleEl = mockRoot.querySelector('style[data-a2ui-basic-catalog]');
    assert.ok(styleEl !== null);
    assert.ok(styleEl.textContent?.includes('--a2ui-color-primary'));

    // Re-injecting does not duplicate the style tag
    injectBasicCatalogStyles(mockRoot);
    const styleEls = mockRoot.querySelectorAll('style[data-a2ui-basic-catalog]');
    assert.strictEqual(styleEls.length, 1);
  });

  it('applies flex weight when props.weight is provided and removes when undefined', async () => {
    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(element, (e: any) => {
      e.context = context;
    });

    assert.ok(element.style.flex.startsWith('2'));

    // Update weight to undefined
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'comp1',
              component: 'TestComponent',
              text: 'Hello',
              weight: undefined,
            },
          ],
        },
      },
    ]);

    await asyncUpdate(element, () => {});
    assert.strictEqual(element.style.flex, '');
  });

  it('sets theme primaryColor CSS variables and computes variants', async () => {
    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    const context = new ComponentContext(surface, 'comp2');
    await asyncUpdate(element, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary'), '#ff0055');
    assert.ok(element.style.getPropertyValue('--a2ui-color-primary-light').length > 0);
    assert.ok(element.style.getPropertyValue('--a2ui-color-primary-dark').length > 0);
    assert.ok(element.style.getPropertyValue('--a2ui-color-primary-hover').length > 0);
  });

  it('clears theme primaryColor CSS variables when primaryColor is absent', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'no-theme-surface',
          catalogId: customCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'no-theme-surface',
          components: [
            {
              id: 'comp3',
              component: 'TestComponent',
              text: 'Un-themed',
            },
          ],
        },
      },
    ]);

    const noThemeSurface = processor.model.getSurface('no-theme-surface')!;
    const context = new ComponentContext(noThemeSurface, 'comp3');

    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    await asyncUpdate(element, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary'), '');
    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary-light'), '');
    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary-dark'), '');
    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary-hover'), '');
  });

  it('should ignore invalid primaryColor value from theme', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'invalid-theme-surface',
          catalogId: customCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'invalid-theme-surface',
          components: [
            {
              id: 'comp4',
              component: 'TestComponent',
              text: 'Invalid Themed',
            },
          ],
        },
      },
    ]);

    const invalidThemeSurface = processor.model.getSurface('invalid-theme-surface')!;
    (invalidThemeSurface as any).theme = {
      primaryColor: 'url(https://attacker.example/beacon)',
    };
    const context = new ComponentContext(invalidThemeSurface, 'comp4');

    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    await asyncUpdate(element, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary'), '');
    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary-light'), '');
    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary-dark'), '');
    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary-hover'), '');
  });

  it('sets theme primaryColor CSS variables for named color', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'named-color-surface',
          catalogId: customCatalog.id,
          theme: {primaryColor: 'red'},
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'named-color-surface',
          components: [{id: 'comp-named', component: 'TestComponent'}],
        },
      },
    ]);
    const namedSurface = processor.model.getSurface('named-color-surface')!;
    const context = new ComponentContext(namedSurface, 'comp-named');
    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    await asyncUpdate(element, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary'), 'red');
    assert.ok(element.style.getPropertyValue('--a2ui-color-primary-light').length > 0);
  });

  it('sets theme primaryColor CSS variables for rgb color', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'rgb-color-surface',
          catalogId: customCatalog.id,
          theme: {primaryColor: 'rgb(255, 0, 0)'},
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'rgb-color-surface',
          components: [{id: 'comp-rgb', component: 'TestComponent'}],
        },
      },
    ]);
    const rgbSurface = processor.model.getSurface('rgb-color-surface')!;
    const context = new ComponentContext(rgbSurface, 'comp-rgb');
    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    await asyncUpdate(element, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(element.style.getPropertyValue('--a2ui-color-primary'), 'rgb(255, 0, 0)');
    assert.ok(element.style.getPropertyValue('--a2ui-color-primary-light').length > 0);
  });

  it('applies only aria-live and aria-hidden on host by default and clears them when unset', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'comp-a11y',
              component: 'TestComponent',
              text: 'Live announcement',
              accessibility: {
                label: 'Inner label only',
                description: 'Inner description only',
                live: 'assertive',
                hidden: false,
              },
            },
          ],
        },
      },
    ]);

    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    await asyncUpdate(element, (e: HTMLElement & {context?: ComponentContext}) => {
      e.context = new ComponentContext(surface, 'comp-a11y');
    });

    assert.strictEqual(element.hasAttribute('aria-label'), false);
    assert.strictEqual(element.hasAttribute('aria-description'), false);
    assert.strictEqual(element.getAttribute('aria-live'), 'assertive');
    assert.strictEqual(element.getAttribute('aria-hidden'), 'false');

    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'comp-a11y',
              component: 'TestComponent',
              text: 'Cleared',
              accessibility: undefined,
            },
          ],
        },
      },
    ]);

    await asyncUpdate(element, () => {});
    assert.strictEqual(element.hasAttribute('aria-live'), false);
    assert.strictEqual(element.hasAttribute('aria-hidden'), false);
  });

  it('uses ComponentNode.id for domId when rendered with a node and falls back to nextNodeId otherwise', async () => {
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'root',
              component: 'TestComponent',
              text: 'Invalid',
              checks: [{condition: false, message: 'Required'}],
            },
          ],
        },
      },
    ]);

    const resolver = new NodeResolver(surface);
    const rootNode = peekValue(resolver.rootNode);
    assert.ok(rootNode);

    element = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(element);

    await asyncUpdate(element, (e: HTMLElement & {node?: ComponentNode}) => {
      e.node = rootNode;
    });

    const nodeErrorEl = element.querySelector('.a2ui-validation-errors');
    assert.strictEqual(nodeErrorEl?.id, `${rootNode.id}-error`);

    const contextOnlyEl = document.createElement('a2ui-test-basic-element');
    document.body.appendChild(contextOnlyEl);
    try {
      await asyncUpdate(contextOnlyEl, (e: HTMLElement & {context?: ComponentContext}) => {
        e.context = new ComponentContext(surface, 'root');
      });
      const fallbackErrorEl = contextOnlyEl.querySelector('.a2ui-validation-errors');
      assert.ok(fallbackErrorEl?.id.startsWith('a2ui-n'));
      assert.notStrictEqual(fallbackErrorEl?.id, `${rootNode.id}-error`);
    } finally {
      contextOnlyEl.remove();
      resolver.dispose();
    }
  });
});
