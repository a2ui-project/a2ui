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

import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';
import assert from 'node:assert';
import {describe, it, beforeEach, after, before} from 'node:test';

import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  ComponentApi,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {LitComponentApi} from '../types.js';
import {A2uiController} from '../a2ui-controller.js';

describe('BasicCatalogA2uiLitElement', () => {
  let basicCatalog: Catalog<LitComponentApi>;

  before(async () => {
    setupTestDom();

    const module = await import('../catalogs/basic/basic-catalog-a2ui-lit-element.js');
    basicCatalog = (await import('../catalogs/basic/index.js')).basicCatalog;

    // Create a mock A2uiLitElement for tests
    class TestBasicElement extends module.BasicCatalogA2uiLitElement<ComponentApi> {
      createController() {
        const controllerMock = {
          props: {},
          dispose: () => {},
        } as A2uiController<ComponentApi>;

        return controllerMock;
      }

      render() {
        return null;
      }
    }

    customElements.define('test-basic-element', TestBasicElement);
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

  // This test ensures that if the element's context changes to a surface without a
  // theme, the CSS variable is removed. While surface themes are currently immutable
  // after creation, this ensures robust cleanup behavior if elements are reused.
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
