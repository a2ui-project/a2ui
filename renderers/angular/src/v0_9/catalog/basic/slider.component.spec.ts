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
import {signal as angularSignal} from '@angular/core';
import {SliderComponent} from './slider.component';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '@a2ui/angular/testing';

describe('SliderComponent', () => {
  let component: SliderComponent;
  let fixture: ComponentFixture<SliderComponent>;
  let defaultProps: ComponentToProps<SliderComponent>;

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
      imports: [SliderComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SliderComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      label: createBoundProperty<string | undefined>(''),
      min: createBoundProperty<number | undefined>(0),
      max: createBoundProperty(100),
      value: createBoundProperty(0),
      isValid: createBoundProperty(true),
      validationErrors: createBoundProperty<string[]>([]),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render slider with value', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      label: createBoundProperty<string | undefined>('Brightness'),
      value: createBoundProperty(50),
    });
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input');
    expect(input.value).toBe('50');
    expect(fixture.nativeElement.textContent).toContain('Brightness');
  });

  it('should call onUpdate when slider value changes', () => {
    const onUpdateSpy = jasmine.createSpy('onUpdate');
    setComponentProps(fixture, {
      ...defaultProps,
      value: {value: angularSignal(50), raw: 50, onUpdate: onUpdateSpy},
    });
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input');
    input.value = '75';
    input.dispatchEvent(new Event('input'));
    expect(onUpdateSpy).toHaveBeenCalledWith(75);
  });
});
