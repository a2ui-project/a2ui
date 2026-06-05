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
import {IconComponent} from './icon.component';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '../../core/test-utils';

describe('IconComponent', () => {
  let component: IconComponent;
  let fixture: ComponentFixture<IconComponent>;
  let defaultProps: ComponentToProps<IconComponent>;

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
      imports: [IconComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(IconComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      name: createBoundProperty('search' as const),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render named icon', () => {
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.a2ui-icon');
    expect(icon.textContent.trim()).toBe('search');
  });

  it('should convert camelCase icon names to snake_case', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      name: createBoundProperty('shoppingCart' as const),
    });
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.a2ui-icon');
    expect(icon.textContent.trim()).toBe('shopping_cart');
  });

  it('should map "play" to "play_arrow"', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      name: createBoundProperty('play' as const),
    });
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.a2ui-icon');
    expect(icon.textContent.trim()).toBe('play_arrow');
  });

  it('should map "rewind" to "fast_rewind"', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      name: createBoundProperty('rewind' as const),
    });
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.a2ui-icon');
    expect(icon.textContent.trim()).toBe('fast_rewind');
  });

  it('should map "favoriteOff" to "favorite_border"', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      name: createBoundProperty('favoriteOff' as const),
    });
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.a2ui-icon');
    expect(icon.textContent.trim()).toBe('favorite_border');
  });

  it('should map "starOff" to "star_border"', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      name: createBoundProperty('starOff' as const),
    });
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.a2ui-icon');
    expect(icon.textContent.trim()).toBe('star_border');
  });

  it('should render path icon', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      name: createBoundProperty({
        svgPath: 'M10 10...',
      }) as unknown as ComponentToProps<IconComponent>['name'],
    });
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg).toBeTruthy();
  });
});
