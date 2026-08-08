/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Component, Injector} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {ComponentApi} from '@a2ui/web_core/v0_9';
import {z} from 'zod';
import {prepareUniversalCatalog} from './prepare_universal_catalog';
import {CatalogComponent} from '../core/catalog_component';
import {AngularCatalog, AngularComponentImplementation} from './types';

@Component({
  selector: 'test-custom-prep',
  template: '<div>Custom Prep</div>',
  standalone: true,
})
class TestCustomPrepComponent extends CatalogComponent<ComponentApi> {}

@Component({
  selector: 'test-custom-specified',
  template: '<div>Custom Specified</div>',
  standalone: true,
})
class TestCustomSpecifiedComponent extends CatalogComponent<ComponentApi> {}

describe('prepareUniversalCatalog', () => {
  let injector: Injector;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    injector = TestBed.inject(Injector);
  });

  it('preserves existing Web Component declarations with predefined tagName', () => {
    const catalog = new AngularCatalog('test-predefined-catalog', [
      {
        name: 'ExistingWc1',
        schema: z.object({}),
        tagName: 'existing-wc-1',
      },
      {
        name: 'ExistingWc2',
        schema: z.object({}),
        tagName: 'existing-wc-2',
      },
    ]);

    prepareUniversalCatalog(catalog, injector);

    expect(catalog.components.get('ExistingWc1')?.tagName).toBe('existing-wc-1');
    expect(catalog.components.get('ExistingWc2')?.tagName).toBe('existing-wc-2');
  });

  it('bridges custom Angular components to web components and populates tagName', () => {
    const customImpl: AngularComponentImplementation = {
      name: 'CustomPrepItem',
      schema: z.object({}),
      component: TestCustomPrepComponent,
    };

    const catalog = new AngularCatalog('test-custom-catalog', [customImpl]);
    expect(catalog.components.get('CustomPrepItem')?.tagName).toBeUndefined();

    prepareUniversalCatalog(catalog, injector);

    const resolved = catalog.components.get('CustomPrepItem');
    expect(resolved?.tagName).toBeDefined();
    expect(resolved?.tagName).toBe('a2ui-ng-customprepitem');
    expect(customElements.get(resolved!.tagName!)).toBeDefined();
  });

  it('is idempotent and does not re-process already prepared catalogs', () => {
    const customImpl: AngularComponentImplementation = {
      name: 'CustomPrepItem',
      schema: z.object({}),
      component: TestCustomPrepComponent,
    };

    const catalog = new AngularCatalog('test-idempotent-catalog', [customImpl]);

    prepareUniversalCatalog(catalog, injector);
    const firstTag = catalog.components.get('CustomPrepItem')?.tagName;

    // Call again with a different injector
    prepareUniversalCatalog(catalog, injector);
    expect(catalog.components.get('CustomPrepItem')?.tagName).toBe(firstTag);
  });

  it('registers custom elements for Angular components that specify tagName', () => {
    const customTag = 'test-specified-tag-wc';
    const customImpl: AngularComponentImplementation = {
      name: 'CustomSpecifiedTag',
      schema: z.object({}),
      component: TestCustomSpecifiedComponent,
      tagName: customTag,
    };

    const catalog = new AngularCatalog('test-specified-catalog', [customImpl]);
    expect(customElements.get(customTag)).toBeUndefined();

    prepareUniversalCatalog(catalog, injector);

    const resolved = catalog.components.get('CustomSpecifiedTag');
    expect(resolved?.tagName).toBe(customTag);
    expect(customElements.get(customTag)).toBeDefined();
  });
});
