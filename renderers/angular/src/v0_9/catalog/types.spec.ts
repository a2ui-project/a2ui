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

import {Component} from '@angular/core';
import {ComponentApi} from '@a2ui/web_core/v0_9';
import {AngularCatalog, createComponentImplementation} from './types';
import {BASIC_COMPONENTS} from './basic/basic-catalog';
import {CatalogComponent} from '../core/catalog_component';
import {z} from 'zod';

@Component({
  selector: 'test-comp',
  template: '',
  standalone: true,
})
class TestComponent extends CatalogComponent<ComponentApi> {}

describe('createComponentImplementation', () => {
  it('should map ComponentApi and Angular Component Type correctly', () => {
    const api: ComponentApi = {
      name: 'TestComp',
      schema: z.object({}),
    };

    const impl = createComponentImplementation(api, TestComponent);

    expect(impl.name).toBe('TestComp');
    expect(impl.schema).toEqual(api.schema);
    expect(impl.component).toBe(TestComponent);
  });
});

@Component({
  selector: 'test-custom-comp',
  template: '<div>custom angular component</div>',
  standalone: true,
})
class TestCustomComponent extends CatalogComponent<ComponentApi> {}

describe('AngularCatalog & Catalog Types', () => {
  it('instantiates empty AngularCatalog by default when no components are provided', () => {
    const catalog = new AngularCatalog('https://example.com/catalog.json', []);
    expect(catalog.id).toBe('https://example.com/catalog.json');
    expect(catalog.components.size).toBe(0);
    expect(catalog.functions.size).toBe(0);
  });

  it('instantiates AngularCatalog with components as a pure registry without injection context', () => {
    const catalog = new AngularCatalog('test-catalog', [
      {
        name: 'CustomTest',
        schema: z.object({}),
        component: TestCustomComponent,
      },
    ]);
    expect(catalog.components.size).toBe(1);
    const comp = catalog.components.get('CustomTest');
    expect(comp).toBeDefined();
    expect('component' in comp! && comp.component).toBe(TestCustomComponent);
  });

  it('exports BASIC_COMPONENTS with 18 native components by default', () => {
    expect(BASIC_COMPONENTS.length).toBe(18);
    const textComp = BASIC_COMPONENTS.find(c => c.name === 'Text');
    expect(textComp).toBeDefined();
    expect('component' in textComp! && textComp.component).toBeDefined();
  });

  it('creates an AngularComponentImplementation via createComponentImplementation', () => {
    const schema = z.object({value: z.string()});
    const impl = createComponentImplementation({name: 'CustomItem', schema}, TestCustomComponent);
    expect(impl.name).toBe('CustomItem');
    expect(impl.schema).toBe(schema);
    expect(impl.component).toBe(TestCustomComponent);
  });

  it('preserves native AngularComponentImplementation without converting to Web Component', () => {
    const catalog = new AngularCatalog('test-catalog', [
      {
        name: 'CustomNative',
        schema: z.object({}),
        component: TestCustomComponent,
      },
    ]);
    const comp = catalog.components.get('CustomNative');
    expect(comp).toBeDefined();
    expect('component' in comp! && comp.component).toBe(TestCustomComponent);
  });
});
