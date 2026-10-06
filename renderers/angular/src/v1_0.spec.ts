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

import {TestBed} from '@angular/core/testing';
import {
  A2uiRendererService,
  BasicCatalog,
  BasicCatalogBase,
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  provideA2UI,
  SurfaceComponent,
} from './public-api';
import {isWebComponentImplementation} from '@a2ui/web_core';

describe('@a2ui/angular v1.0 & BasicCatalog', () => {
  describe('BasicCatalog', () => {
    it('should have v1.0 catalog ID and protocolVersion', () => {
      const catalog = new BasicCatalog();
      expect(catalog.id).toBe('https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json');
      expect(catalog.protocolVersion).toBe('1.0');
    });

    it('should register all 18 v1.0 basic catalog components with WebComponentImplementations', () => {
      const catalog = new BasicCatalog();
      expect(catalog.components.size).toBe(18);
      expect(BASIC_COMPONENTS.length).toBe(18);
      expect(BASIC_FUNCTIONS.length).toBeGreaterThan(0);

      const expectedNames = [
        'Text',
        'Row',
        'Column',
        'Button',
        'TextField',
        'Image',
        'Icon',
        'Video',
        'AudioPlayer',
        'List',
        'Card',
        'Tabs',
        'Modal',
        'Divider',
        'CheckBox',
        'ChoicePicker',
        'Slider',
        'DateTimeInput',
      ];
      for (const name of expectedNames) {
        const impl = catalog.components.get(name);
        expect(impl).withContext(`Missing component ${name}`).toBeDefined();
        expect(isWebComponentImplementation(impl)).toBeTrue();
      }
    });

    it('should allow overriding catalog options via BasicCatalogBase', () => {
      const custom = new BasicCatalogBase({
        id: 'https://example.com/custom-v1.json',
        locale: 'fr-FR',
      });
      expect(custom.id).toBe('https://example.com/custom-v1.json');
      expect(custom.protocolVersion).toBe('1.0');
    });
  });

  describe('provideA2UI and v1.0 rendering', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [SurfaceComponent],
        providers: [provideA2UI({catalogs: [new BasicCatalog()]})],
      });
    });

    it('should default useUniversalComponents to true', () => {
      const rendererService = TestBed.inject(A2uiRendererService);
      expect(rendererService.useUniversalComponents).toBeTrue();
    });

    it('should process v1.0 envelope messages and render SurfaceComponent with v1.0 components', async () => {
      const rendererService = TestBed.inject(A2uiRendererService);

      await rendererService.processMessagesAsync({
        version: 'v1.0',
        messages: [
          {
            version: 'v1.0',
            createSurface: {
              surfaceId: 'v1-test-surf',
              catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            },
          },
          {
            version: 'v1.0',
            updateComponents: {
              surfaceId: 'v1-test-surf',
              components: [
                {
                  id: 'root',
                  component: 'Column',
                  children: ['heading', 'videoPlayer', 'sliderInput', 'nameInput'],
                },
                {
                  id: 'heading',
                  component: 'Text',
                  text: 'Hello A2UI v1.0',
                  variant: 'body',
                },
                {
                  id: 'videoPlayer',
                  component: 'Video',
                  url: 'https://example.com/demo.mp4',
                  posterUrl: 'https://example.com/poster.png',
                },
                {
                  id: 'sliderInput',
                  component: 'Slider',
                  label: 'Steps Slider',
                  min: 0,
                  max: 100,
                  steps: 5,
                  value: 40,
                },
                {
                  id: 'nameInput',
                  component: 'TextField',
                  label: 'Full Name',
                  placeholder: 'Jane Doe',
                  value: {path: '/user/name'},
                  checks: [
                    {
                      condition: {path: '/user/nameCheck'},
                      message: 'Fallback name error',
                    },
                  ],
                },
              ],
            },
          },
          {
            version: 'v1.0',
            updateDataModel: {
              surfaceId: 'v1-test-surf',
              path: '/user',
              value: {
                name: '',
                nameCheck: {
                  valid: false,
                  severity: 'error',
                  message: 'Name is required by v1.0 CheckResult',
                },
              },
            },
          },
        ],
      });

      const fixture = TestBed.createComponent(SurfaceComponent);
      fixture.componentRef.setInput('surfaceId', 'v1-test-surf');
      fixture.detectChanges();

      const surfaceEl = fixture.nativeElement as HTMLElement;
      const columnEl = surfaceEl.querySelector('a2ui-basic-column') as HTMLElement;
      expect(columnEl).toBeTruthy();

      await (columnEl as any)?.updateComplete;

      const root = columnEl?.shadowRoot ?? columnEl;
      const textEl = root?.querySelector('a2ui-basic-text');
      expect(textEl).toBeTruthy();

      const videoEl = root?.querySelector('a2ui-video');
      expect(videoEl).toBeTruthy();

      const sliderEl = root?.querySelector('a2ui-slider');
      expect(sliderEl).toBeTruthy();

      const textFieldEl = root?.querySelector('a2ui-basic-textfield');
      expect(textFieldEl).toBeTruthy();
    });
  });
});
