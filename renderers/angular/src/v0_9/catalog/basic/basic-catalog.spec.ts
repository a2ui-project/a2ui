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
import {
  BasicCatalog,
  BASIC_CATALOG_OPTIONS,
  NativeBasicCatalog,
  UniversalBasicCatalog,
  provideBasicCatalog,
} from './basic-catalog';
import {AngularCatalog, AngularComponentImplementation} from '../types';

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
  it('should be created with default options (universal) when no token is provided', () => {
    TestBed.configureTestingModule({
      providers: [BasicCatalog],
    });

    const catalog = TestBed.inject(BasicCatalog);
    expect(catalog).toBeTruthy();
    expect(catalog.id).toBe('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json');
    expect(catalog.components.get('Text')?.tagName).toBe('a2ui-basic-text');
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

  it('instantiates NativeBasicCatalog with native Angular component implementations', () => {
    TestBed.configureTestingModule({
      providers: [
        BasicCatalog,
        {
          provide: BASIC_CATALOG_OPTIONS,
          useValue: {
            useUniversal: false,
          },
        },
      ],
    });

    const catalog = TestBed.inject(BasicCatalog);
    const textComp = catalog.components.get('Text') as AngularComponentImplementation;
    expect(textComp).toBeDefined();
    expect(textComp.component).toBeDefined();
  });

  it('provides configured catalog using provideBasicCatalog helper', () => {
    TestBed.configureTestingModule({
      providers: [provideBasicCatalog({useUniversal: false})],
    });

    const catalog = TestBed.inject(AngularCatalog);
    expect(catalog instanceof NativeBasicCatalog).toBeTrue();
    const textComp = catalog.components.get('Text') as AngularComponentImplementation;
    expect(textComp.component).toBeDefined();
  });

  it('provides universal catalog by default with provideBasicCatalog', () => {
    TestBed.configureTestingModule({
      providers: [provideBasicCatalog()],
    });

    const catalog = TestBed.inject(AngularCatalog);
    expect(catalog instanceof UniversalBasicCatalog).toBeTrue();
    expect(catalog.components.get('Text')?.tagName).toBe('a2ui-basic-text');
  });

  it('preserves AngularComponentImplementation in extraComponents', () => {
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
    const comp = catalog.components.get('CustomSlider') as AngularComponentImplementation;
    expect(comp.component).toBe(TestCustomSliderComponent);
  });
});
