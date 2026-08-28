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
import {describe, it, beforeEach, after, before} from 'node:test';
import {css} from 'lit';

import {ComponentContext, MessageProcessor, ComponentApi, SurfaceModel} from '@a2ui/web_core/v0_9';
import {LitComponentApi} from '../types.js';
import {A2uiController} from '../a2ui-controller.js';

describe('BasicCatalogA2uiLitElement', () => {
  let basicCatalog: any;
  let module: typeof import('../catalogs/basic/basic-catalog-a2ui-lit-element.js');

  before(async () => {
    setupTestDom();

    module = await import('../catalogs/basic/basic-catalog-a2ui-lit-element.js');
    basicCatalog = (await import('../catalogs/basic/index.js')).basicCatalog;

    function defineCustomElement(name: string, constructor: CustomElementConstructor) {
      if (!customElements.get(name)) {
        customElements.define(name, constructor);
      }
    }

    class TestBasicElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = css`
        :host {
          display: block;
        }
      `;

      createController() {
        return {
          props: {},
          dispose: () => {},
        } as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-basic-element', TestBasicElement);

    class TestCssTransformElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = css`
        :host {
          display: flex;
        }
        :where(:host) {
          margin: 0;
        }
        :host(.active) {
          background-color: blue;
        }
        :host([disabled]) {
          opacity: 0.5;
        }
        :host:hover {
          color: green;
        }
        .child-item {
          padding: 8px;
        }
        button {
          cursor: pointer;
        }
        div > span.highlight {
          font-weight: bold;
        }
      `;

      createController() {
        return {props: {}, dispose: () => {}} as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-css-transform-el', TestCssTransformElement);

    class TestNoDoublePrefixElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = css`
        test-no-double-prefix-el {
          display: inline-block;
        }
        test-no-double-prefix-el .inner {
          color: red;
        }
        test-no-double-prefix-el.active {
          color: yellow;
        }
        test-no-double-prefix-el:focus {
          outline: none;
        }
        test-no-double-prefix-el[hidden] {
          display: none;
        }
        :where(test-no-double-prefix-el) {
          box-sizing: border-box;
        }
        :is(test-no-double-prefix-el, .other) {
          color: purple;
        }
      `;

      createController() {
        return {props: {}, dispose: () => {}} as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-no-double-prefix-el', TestNoDoublePrefixElement);

    class TestCommaSelectorsElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = css`
        :host,
        .item,
        span > a {
          color: cyan;
        }
      `;

      createController() {
        return {props: {}, dispose: () => {}} as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-comma-selectors-el', TestCommaSelectorsElement);

    class TestMediaQueryElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = css`
        @media (max-width: 600px) {
          :host {
            display: none;
          }
          .sidebar {
            width: 100%;
          }
        }
      `;

      createController() {
        return {props: {}, dispose: () => {}} as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-media-query-el', TestMediaQueryElement);

    const baseStyle = css`
      :host {
        color: black;
      }
    `;
    const componentStyle = css`
      .label {
        font-size: 14px;
      }
    `;
    class TestArrayStylesElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = [baseStyle, componentStyle];

      createController() {
        return {props: {}, dispose: () => {}} as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-array-styles-el', TestArrayStylesElement);

    class TestNoStylesElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = undefined;

      createController() {
        return {props: {}, dispose: () => {}} as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-no-styles-el', TestNoStylesElement);

    class TestAdoptedSheetsElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = css`
        :host {
          margin: 4px;
        }
      `;

      createController() {
        return {props: {}, dispose: () => {}} as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-adopted-sheets-el', TestAdoptedSheetsElement);

    class TestShadowHostedElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = css`
        :host {
          padding: 12px;
        }
      `;

      createController() {
        return {props: {}, dispose: () => {}} as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-shadow-hosted-el', TestShadowHostedElement);

    class TestStyleFallbackElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      static override styles = css`
        :host {
          border: 1px solid black;
        }
      `;

      createController() {
        return {props: {}, dispose: () => {}} as A2uiController<ComponentApi>;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-style-tag-fallback-el', TestStyleFallbackElement);

    class TestFlexWeightElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      mockProps: {weight?: number} = {};

      setMockWeight(weight: number | undefined) {
        this.mockProps = {weight};
        this.requestUpdate();
      }

      createController() {
        const controller = {
          dispose: () => {},
        } as any;
        Object.defineProperty(controller, 'props', {
          get: () => this.mockProps,
        });
        return controller;
      }

      override render() {
        return null;
      }
    }
    defineCustomElement('test-flex-weight-el', TestFlexWeightElement);
  });

  after(teardownTestDom);

  let processor: MessageProcessor<LitComponentApi>;
  let surface: SurfaceModel<LitComponentApi>;

  beforeEach(() => {
    processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: basicCatalog.id,
          theme: {
            primaryColor: '#ff0000',
          },
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'Root',
            },
          ],
        },
      },
    ]);

    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render into Light DOM by returning self from createRenderRoot', () => {
    const el = document.createElement('test-basic-element') as any;
    assert.strictEqual(el.createRenderRoot(), el);
    assert.strictEqual(el.shadowRoot, null);
  });

  it('should transform :host, :where(:host), :host(...), and scope descendant selectors', () => {
    const tagName = 'test-css-transform-el';
    const el = document.createElement(tagName);
    document.body.appendChild(el);

    const constructor = el.constructor as any;
    assert.ok(constructor._processedCss, 'Processed CSS should be generated');

    const processed = constructor._processedCss;
    // :host -> tagName
    assert.match(processed, new RegExp(`${tagName} \\{[^}]*display: flex`));
    // :where(:host) -> :where(tagName)
    assert.match(processed, new RegExp(`:where\\(${tagName}\\) \\{[^}]*margin: 0`));
    // :host(.active) -> tagName.active
    assert.match(processed, new RegExp(`${tagName}\\.active \\{[^}]*background-color: blue`));
    // :host([disabled]) -> tagName[disabled]
    assert.match(processed, new RegExp(`${tagName}\\[disabled\\] \\{[^}]*opacity: 0\\.5`));
    // :host:hover -> tagName:hover
    assert.match(processed, new RegExp(`${tagName}:hover \\{[^}]*color: green`));
    // Descendant selectors prefixed with tagName
    assert.match(processed, new RegExp(`${tagName} \\.child-item \\{[^}]*padding: 8px`));
    assert.match(processed, new RegExp(`${tagName} button \\{[^}]*cursor: pointer`));
    assert.match(
      processed,
      new RegExp(`${tagName} div > span\\.highlight \\{[^}]*font-weight: bold`),
    );

    document.body.removeChild(el);
  });

  it('should not double-prefix selectors that already target the host tag or :where/:is', () => {
    const tagName = 'test-no-double-prefix-el';
    const el = document.createElement(tagName);
    document.body.appendChild(el);

    const processed = (el.constructor as any)._processedCss;
    assert.ok(!processed.includes(`${tagName} ${tagName}`), 'Should not contain double tag prefix');
    assert.match(processed, new RegExp(`${tagName} \\{[^}]*display: inline-block`));
    assert.match(processed, new RegExp(`${tagName} \\.inner \\{[^}]*color: red`));
    assert.match(processed, new RegExp(`${tagName}\\.active \\{[^}]*color: yellow`));
    assert.match(processed, new RegExp(`${tagName}:focus \\{[^}]*outline: none`));
    assert.match(processed, new RegExp(`${tagName}\\[hidden\\] \\{[^}]*display: none`));
    assert.match(processed, new RegExp(`:where\\(${tagName}\\) \\{[^}]*box-sizing: border-box`));

    document.body.removeChild(el);
  });

  it('should correctly scope comma-separated compound selectors', () => {
    const tagName = 'test-comma-selectors-el';
    const el = document.createElement(tagName);
    document.body.appendChild(el);

    const processed = (el.constructor as any)._processedCss;
    assert.match(
      processed,
      new RegExp(`${tagName}, ${tagName} \\.item, ${tagName} span > a \\{[^}]*color: cyan`),
    );

    document.body.removeChild(el);
  });

  it('should scope inner rules inside @media queries recursively', () => {
    const tagName = 'test-media-query-el';
    const el = document.createElement(tagName);
    document.body.appendChild(el);

    const processed = (el.constructor as any)._processedCss;
    assert.match(processed, /@media \(max-width: 600px\)/);
    assert.match(processed, new RegExp(`${tagName} \\{[^}]*display: none`));
    assert.match(processed, new RegExp(`${tagName} \\.sidebar \\{[^}]*width: 100%`));

    document.body.removeChild(el);
  });

  it('should handle array of styles and CSSResult objects', () => {
    const tagName = 'test-array-styles-el';
    const el = document.createElement(tagName);
    document.body.appendChild(el);

    const processed = (el.constructor as any)._processedCss;
    assert.match(processed, new RegExp(`${tagName} \\{[^}]*color: black`));
    assert.match(processed, new RegExp(`${tagName} \\.label \\{[^}]*font-size: 14px`));

    document.body.removeChild(el);
  });

  it('should handle element with no styles gracefully', () => {
    const tagName = 'test-no-styles-el';
    const el = document.createElement(tagName);
    document.body.appendChild(el);

    const constructor = el.constructor as any;
    assert.strictEqual(constructor._processedSheet, undefined);
    assert.strictEqual(constructor._processedCss, undefined);

    document.body.removeChild(el);
  });

  it('should adopt CSSStyleSheet into document.adoptedStyleSheets and deduplicate across instances', () => {
    const tagName = 'test-adopted-sheets-el';
    const el1 = document.createElement(tagName);
    const el2 = document.createElement(tagName);

    document.body.appendChild(el1);
    const countAfterFirst = (document as any).adoptedStyleSheets.length;

    document.body.appendChild(el2);
    const countAfterSecond = (document as any).adoptedStyleSheets.length;

    assert.strictEqual(
      countAfterFirst,
      countAfterSecond,
      'Should not add duplicate stylesheets for multiple instances of the same component',
    );

    const sheet = (el1.constructor as any)._processedSheet;
    assert.ok(sheet, 'Processed stylesheet must be created');
    assert.ok((document as any).adoptedStyleSheets.includes(sheet));

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it('should adopt CSSStyleSheet into shadowRoot when hosted inside a shadow root', () => {
    const tagName = 'test-shadow-hosted-el';
    const hostContainer = document.createElement('div');
    const shadowRoot = hostContainer.attachShadow({mode: 'open'});
    (shadowRoot as any).adoptedStyleSheets = [];
    document.body.appendChild(hostContainer);

    const el = document.createElement(tagName);
    shadowRoot.appendChild(el);

    const sheet = (el.constructor as any)._processedSheet;
    assert.ok(sheet, 'Processed stylesheet must be created');
    assert.ok((shadowRoot as any).adoptedStyleSheets.includes(sheet));

    document.body.removeChild(hostContainer);
  });

  it('should fallback to injecting a style tag when adoptedStyleSheets is unavailable', () => {
    const tagName = 'test-style-tag-fallback-el';
    // Temporarily remove adoptedStyleSheets to test fallback
    const originalAdopted = (document as any).adoptedStyleSheets;
    delete (document as any).adoptedStyleSheets;

    try {
      const el1 = document.createElement(tagName);
      const el2 = document.createElement(tagName);

      document.body.appendChild(el1);
      const getStyleEls = () =>
        Array.from(document.head.querySelectorAll('style')).filter(el =>
          el.textContent?.includes(tagName),
        );
      assert.strictEqual(getStyleEls().length, 1, 'Should inject exactly one style element');
      assert.match(
        getStyleEls()[0].textContent || '',
        new RegExp(`${tagName} \\{[^}]*border: 1px solid black`),
      );

      // Connect second element and verify deduplication
      document.body.appendChild(el2);
      assert.strictEqual(getStyleEls().length, 1, 'Should not inject duplicate style elements');

      document.body.removeChild(el1);
      document.body.removeChild(el2);
    } finally {
      (document as any).adoptedStyleSheets = originalAdopted;
    }
  });

  it('should set style.flex when props.weight is defined and remove it when undefined', async () => {
    const tagName = 'test-flex-weight-el';
    const el = document.createElement(tagName) as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'root');
    await asyncUpdate(el, (e: any) => {
      e.context = context;
    });

    await asyncUpdate(el, (e: any) => {
      e.setMockWeight(2);
    });
    assert.strictEqual(el.style.flex, '2');

    await asyncUpdate(el, (e: any) => {
      e.setMockWeight(0.5);
    });
    assert.strictEqual(el.style.flex, '0.5');

    await asyncUpdate(el, (e: any) => {
      e.setMockWeight(undefined);
    });
    assert.strictEqual(el.style.flex, '');

    document.body.removeChild(el);
  });

  it('should apply primary color from theme', async () => {
    const el = document.createElement('test-basic-element');
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'root');
    await asyncUpdate(el, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(el.style.getPropertyValue('--a2ui-color-primary'), '#ff0000');
    assert.strictEqual(
      el.style.getPropertyValue('--a2ui-color-primary-light'),
      'color-mix(in oklab, var(--a2ui-color-primary) 85%, white)',
    );
    assert.strictEqual(
      el.style.getPropertyValue('--a2ui-color-primary-dark'),
      'color-mix(in oklab, var(--a2ui-color-primary) 85%, black)',
    );
    assert.strictEqual(
      el.style.getPropertyValue('--a2ui-color-primary-hover'),
      'light-dark(var(--a2ui-color-primary-dark), var(--a2ui-color-primary-light))',
    );
    document.body.removeChild(el);
  });

  it('should remove primary color when theme changes or is missing', async () => {
    const el = document.createElement('test-basic-element');
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'root');
    await asyncUpdate(el, (e: any) => {
      e.context = context;
    });

    assert.strictEqual(el.style.getPropertyValue('--a2ui-color-primary'), '#ff0000');

    // Create a new context with a surface that has no theme.
    const surfaceNoThemeMock = {
      ...surface,
      theme: {},
    } as SurfaceModel<LitComponentApi>;

    const contextNoTheme = new ComponentContext(surfaceNoThemeMock, 'root');
    await asyncUpdate(el, (e: any) => {
      e.context = contextNoTheme;
    });

    assert.strictEqual(el.style.getPropertyValue('--a2ui-color-primary'), '');
    assert.strictEqual(el.style.getPropertyValue('--a2ui-color-primary-light'), '');
    assert.strictEqual(el.style.getPropertyValue('--a2ui-color-primary-dark'), '');
    assert.strictEqual(el.style.getPropertyValue('--a2ui-color-primary-hover'), '');
    document.body.removeChild(el);
  });
});
