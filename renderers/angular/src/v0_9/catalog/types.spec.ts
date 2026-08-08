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
import {AngularCatalog} from './types';
import {BASIC_COMPONENTS} from './basic/basic-catalog';
import {toWebComponent} from './to_web_component';
import {z} from 'zod';

@Component({
  selector: 'test-custom-comp',
  template: '<div>custom angular component</div>',
  standalone: true,
})
class TestCustomComponent {}

describe('Angular Catalog & toWebComponent', () => {
  let injector: Injector;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestCustomComponent],
    });
    injector = TestBed.inject(Injector);
  });

  it('instantiates AngularCatalog wrapping universal WebComponentImplementation catalog', () => {
    const catalog = new AngularCatalog();
    expect(catalog.id).toBe('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json');
    expect(catalog.components.size).toBe(18);
    expect(catalog.components.get('Button')?.tagName).toBe('a2ui-basic-button');
  });

  it('exports BASIC_COMPONENTS with 18 universal components', () => {
    expect(BASIC_COMPONENTS.length).toBe(18);
    const textComp = BASIC_COMPONENTS.find(c => c.name === 'Text');
    expect(textComp).toBeDefined();
    expect(textComp?.tagName).toBe('a2ui-basic-text');
  });

  it('converts Angular Component to Web Component via toWebComponent', () => {
    const impl = toWebComponent(
      {
        name: 'CustomTest',
        schema: z.object({}),
        component: TestCustomComponent,
      },
      injector,
    );
    expect(impl.name).toBe('CustomTest');
    expect(impl.tagName).toBe('a2ui-ng-customtest');
    expect(customElements.get(impl.tagName)).toBeDefined();

    const el = document.createElement(impl.tagName);
    expect(el).toBeDefined();
  });
});
