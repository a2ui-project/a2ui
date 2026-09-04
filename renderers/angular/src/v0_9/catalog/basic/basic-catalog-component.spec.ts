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
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {BasicCatalogComponent} from './basic-catalog-component';
import {A2uiRendererService, A2UI_RENDERER_CONFIG} from '../../core/a2ui-renderer.service';
import {BasicCatalog} from './basic-catalog';
import {ComponentApi} from '@a2ui/web_core/v0_9';
import z from 'zod';

export const TestComponentApi = {
  name: 'TestComponent',
  schema: z
    .object({
      foo: z.string(),
    })
    .strict(),
} satisfies ComponentApi;

@Component({
  selector: 'test-basic-comp',
  template: '<div>Test</div>',
  standalone: true,
})
class TestBasicComp extends BasicCatalogComponent<typeof TestComponentApi> {}

describe('BasicCatalogComponent', () => {
  let fixture: ComponentFixture<TestBasicComp>;
  let rendererService: A2uiRendererService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestBasicComp],
      providers: [
        A2uiRendererService,
        BasicCatalog,
        {
          provide: A2UI_RENDERER_CONFIG,
          useFactory: (basicCatalog: BasicCatalog) => ({
            catalogs: [basicCatalog],
          }),
          deps: [BasicCatalog],
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestBasicComp);
    rendererService = TestBed.inject(A2uiRendererService);
    rendererService.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
    ]);
  });

  it('should set --a2ui-color-primary style on host for 6-character hex color', () => {
    rendererService.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'surface-6char',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          theme: {primaryColor: '#00FF00'},
        },
      },
    ]);

    fixture.componentRef.setInput('surfaceId', 'surface-6char');
    fixture.detectChanges();

    const element = fixture.nativeElement;
    expect(element.style.getPropertyValue('--a2ui-color-primary')).toBe('#00FF00');
  });

  it('should set --a2ui-color-primary style on host for 3-character hex color', () => {
    rendererService.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'surface-3char',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          theme: {primaryColor: '#17e'},
        },
      },
    ]);

    fixture.componentRef.setInput('surfaceId', 'surface-3char');
    fixture.detectChanges();

    const element = fixture.nativeElement;
    expect(element.style.getPropertyValue('--a2ui-color-primary')).toBe('#17e');
  });

  it('should set --a2ui-color-primary style on host for 8-character hex color', () => {
    rendererService.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'surface-8char',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          theme: {primaryColor: '#00FF0080'},
        },
      },
    ]);

    fixture.componentRef.setInput('surfaceId', 'surface-8char');
    fixture.detectChanges();

    const element = fixture.nativeElement;
    expect(element.style.getPropertyValue('--a2ui-color-primary')).toBe('#00FF0080');
  });

  it('should handle missing theme or primaryColor', () => {
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.detectChanges();

    const element = fixture.nativeElement;
    expect(element.style.getPropertyValue('--a2ui-color-primary')).toBe('');
  });

  it('should ignore invalid primaryColor values on host style', () => {
    const surface = rendererService.surfaceGroup.getSurface('test-surface');
    (surface as any).theme = {primaryColor: 'url(https://attacker.example/beacon)'};

    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.detectChanges();

    const element = fixture.nativeElement;
    expect(element.style.getPropertyValue('--a2ui-color-primary')).toBe('');
  });
});
