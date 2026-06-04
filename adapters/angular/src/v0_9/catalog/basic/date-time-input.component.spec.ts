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
import {DateTimeInputComponent} from './date-time-input.component';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '../../core/test-utils';

describe('DateTimeInputComponent', () => {
  let component: DateTimeInputComponent;
  let fixture: ComponentFixture<DateTimeInputComponent>;
  let defaultProps: ComponentToProps<DateTimeInputComponent>;

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
      imports: [DateTimeInputComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DateTimeInputComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      label: createBoundProperty<string | undefined>(''),
      value: createBoundProperty(''),
      enableDate: createBoundProperty<boolean | undefined>(true),
      enableTime: createBoundProperty<boolean | undefined>(true),
      isValid: createBoundProperty(true),
      validationErrors: createBoundProperty<string[]>([]),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render date input', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      label: createBoundProperty<string | undefined>('Start Date'),
      value: createBoundProperty('2026-03-16'),
      enableTime: createBoundProperty<boolean | undefined>(false),
    });
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type="date"]');
    expect(input).toBeTruthy();
    expect(input.value).toBe('2026-03-16');
  });

  it('should call onUpdate when date or time changes', () => {
    const onUpdateSpy = jasmine.createSpy('onUpdate');
    setComponentProps(fixture, {
      ...defaultProps,
      value: {
        value: angularSignal('2026-03-16T10:00:00'),
        raw: '2026-03-16T10:00:00',
        onUpdate: onUpdateSpy,
      },
    });
    fixture.detectChanges();
    const dateInput = fixture.nativeElement.querySelector('input[type="date"]');
    const timeInput = fixture.nativeElement.querySelector('input[type="time"]');

    dateInput.value = '2026-03-17';
    dateInput.dispatchEvent(new Event('change'));
    expect(onUpdateSpy).toHaveBeenCalledWith('2026-03-17T10:00:00');

    onUpdateSpy.calls.reset();
    timeInput.value = '11:00';
    timeInput.dispatchEvent(new Event('change'));
    expect(onUpdateSpy).toHaveBeenCalledWith('2026-03-16T11:00:00');
  });

  it('should handle empty value by returning empty strings', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      value: createBoundProperty(''),
    });
    fixture.detectChanges();

    const dateInput = fixture.nativeElement.querySelector('input[type="date"]');
    const timeInput = fixture.nativeElement.querySelector('input[type="time"]');

    expect(dateInput.value).toBe('');
    expect(timeInput.value).toBe('');
  });
});
