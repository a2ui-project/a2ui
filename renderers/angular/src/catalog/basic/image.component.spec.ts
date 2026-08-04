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

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ImageComponent} from './image.component';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '@a2ui/angular/testing';

describe('ImageComponent', () => {
  let component: ImageComponent;
  let fixture: ComponentFixture<ImageComponent>;
  let defaultProps: ComponentToProps<ImageComponent>;

  beforeEach(async () => {
    const mockRendererService = {
      surfaceGroup: {
        getSurface: jasmine.createSpy('getSurface').and.returnValue({
          componentsModel: new Map(),
          catalog: {
            id: 'mock-catalog',
            components: new Map(),
          },
        }),
      },
    };
    const mockBinder = jasmine.createSpyObj('ComponentBinder', ['bind']);

    await TestBed.configureTestingModule({
      imports: [ImageComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(ImageComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      url: createBoundProperty('https://example.com/image.png'),
      fit: createBoundProperty('cover' as const),
      variant: createBoundProperty('avatar' as const),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render image with url', () => {
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.src).toBeTruthy();
    expect(img.style.objectFit).toBe('cover');
    expect(img.className).toContain('avatar');
  });

  it('should render image with description', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      description: createBoundProperty('A cute cat'),
    });
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.alt).toBe('A cute cat');
  });

  it('should support all specified variants', () => {
    const variants = [
      'icon',
      'avatar',
      'smallFeature',
      'mediumFeature',
      'largeFeature',
      'header',
    ] as const;
    for (const variant of variants) {
      setComponentProps(fixture, {
        ...defaultProps,
        variant: createBoundProperty(variant),
      });
      fixture.detectChanges();
      const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
      expect(img.className).toContain(variant);
    }
  });
});
