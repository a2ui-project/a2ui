/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Component} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {z} from 'zod';
import {BasicCatalog, BASIC_CATALOG_OPTIONS} from './basic-catalog';
import {AngularComponentImplementation} from '../types';

@Component({
  selector: 'test-custom-slider',
  template: '<div>custom slider</div>',
  standalone: true,
})
class TestCustomSliderComponent {}

const customSliderDeclaration: AngularComponentImplementation = {
  name: 'CustomSlider',
  schema: z.object({}),
  component: TestCustomSliderComponent,
};

describe('BasicCatalog', () => {
  it('should be created with default options when no token is provided', () => {
    TestBed.configureTestingModule({
      providers: [BasicCatalog],
    });

    const catalog = TestBed.inject(BasicCatalog);
    expect(catalog).toBeTruthy();
    expect(catalog.id).toBe('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json');
  });

  it('should be created with custom options when token is provided', () => {
    TestBed.configureTestingModule({
      providers: [
        BasicCatalog,
        {
          provide: BASIC_CATALOG_OPTIONS,
          useValue: {
            id: 'https://example.com/custom-catalog.json',
          },
        },
      ],
    });

    const catalog = TestBed.inject(BasicCatalog);
    expect(catalog).toBeTruthy();
    expect(catalog.id).toBe('https://example.com/custom-catalog.json');
  });

  it('automatically converts AngularComponentImplementation in extraComponents to custom elements', () => {
    TestBed.configureTestingModule({
      providers: [
        BasicCatalog,
        {
          provide: BASIC_CATALOG_OPTIONS,
          useValue: {
            extraComponents: [customSliderDeclaration],
          },
        },
      ],
    });

    const catalog = TestBed.inject(BasicCatalog);
    expect(catalog.components.has('CustomSlider')).toBeTrue();
    const converted = catalog.components.get('CustomSlider');
    expect(converted?.tagName).toBe('a2ui-ng-customslider');
    expect(customElements.get('a2ui-ng-customslider')).toBeDefined();
  });
});
