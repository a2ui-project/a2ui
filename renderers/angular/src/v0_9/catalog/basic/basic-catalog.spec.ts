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
import {TestBed} from '@angular/core/testing';
import {z} from 'zod';
import {BasicCatalog} from './basic-catalog';
import {AngularComponentImplementation, isAngularComponentImplementation} from '../types';
import {CatalogComponent} from '../../core/catalog_component';
import {ComponentApi} from '@a2ui/web_core/v0_9';

const CUSTOM_SLIDER = 'CustomSlider';

@Component({
  selector: 'test-custom-slider',
  template: '<div>custom slider</div>',
  standalone: true,
})
class TestCustomSliderComponent extends CatalogComponent<ComponentApi> {}

const customSliderDeclaration: AngularComponentImplementation = {
  name: CUSTOM_SLIDER,
  schema: z.object({}),
  component: TestCustomSliderComponent,
};

describe('BasicCatalog', () => {
  it('should be created with default options', () => {
    TestBed.configureTestingModule({
      providers: [BasicCatalog],
    });

    const catalog = TestBed.inject(BasicCatalog);
    expect(catalog).toBeTruthy();
    expect(catalog.id).toBe('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json');
  });

  it('should be created with custom options via constructor', () => {
    const catalog = new BasicCatalog({
      id: 'https://example.com/custom-catalog.json',
    });

    expect(catalog).toBeTruthy();
    expect(catalog.id).toBe('https://example.com/custom-catalog.json');
  });

  it('contains native component implementations in basic components', () => {
    const catalog = new BasicCatalog();
    expect(catalog.components.size).toBeGreaterThan(0);
    const hasAngularComponent = Array.from(catalog.components.values()).some(
      isAngularComponentImplementation,
    );
    expect(hasAngularComponent).toBeTrue();
  });

  it('preserves AngularComponentImplementation in extraComponents', () => {
    const catalog = new BasicCatalog({
      extraComponents: [customSliderDeclaration],
    });

    expect(catalog.components.has(CUSTOM_SLIDER)).toBeTrue();
    const comp = catalog.components.get(CUSTOM_SLIDER) as AngularComponentImplementation;
    expect(comp.component).toBe(TestCustomSliderComponent);
  });
});
