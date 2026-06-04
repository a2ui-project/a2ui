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
import {ChoicePickerComponent} from './choice-picker.component';
import {DynamicString} from '@a2ui/web_core/v0_9';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '../../core/test-utils';

describe('ChoicePickerComponent', () => {
  let component: ChoicePickerComponent;
  let fixture: ComponentFixture<ChoicePickerComponent>;
  let defaultProps: ComponentToProps<ChoicePickerComponent>;

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
      imports: [ChoicePickerComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChoicePickerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('componentId', 'test-choice-picker');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      label: createBoundProperty<string | undefined>(''),
      options: createBoundProperty<{label: DynamicString; value: string}[]>([]),
      value: createBoundProperty<string[]>([]),
      variant: createBoundProperty<'multipleSelection' | 'mutuallyExclusive' | undefined>(
        'mutuallyExclusive',
      ),
      displayStyle: createBoundProperty<'checkbox' | 'chips' | undefined>('checkbox'),
      isValid: createBoundProperty(true),
      validationErrors: createBoundProperty<string[]>([]),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render options', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      label: createBoundProperty<string | undefined>('Pick one'),
      options: createBoundProperty<{label: DynamicString; value: string}[]>([
        {label: 'Opt 1', value: '1'},
        {label: 'Opt 2', value: '2'},
      ]),
      value: createBoundProperty(['1']),
    });
    fixture.detectChanges();
    const options = fixture.nativeElement.querySelectorAll('.a2ui-option-label');
    expect(options.length).toBe(2);
    expect(options[0].textContent).toContain('Opt 1');
  });

  it('should call onUpdate when option selected', () => {
    const onUpdateSpy = jasmine.createSpy('onUpdate');
    setComponentProps(fixture, {
      ...defaultProps,
      label: createBoundProperty<string | undefined>('Pick one'),
      options: createBoundProperty<{label: DynamicString; value: string}[]>([
        {label: 'Opt 1', value: '1'},
        {label: 'Opt 2', value: '2'},
      ]),
      value: {value: angularSignal(['1']), raw: ['1'], onUpdate: onUpdateSpy},
    });
    fixture.detectChanges();
    const opt2Input = fixture.nativeElement.querySelector('input[value="2"]');
    opt2Input.click();
    expect(onUpdateSpy).toHaveBeenCalledWith(['2']);
  });

  it('should render chips and toggle selection', () => {
    const onUpdateSpy = jasmine.createSpy('onUpdate');
    setComponentProps(fixture, {
      ...defaultProps,
      options: createBoundProperty<{label: DynamicString; value: string}[]>([
        {label: 'Chip 1', value: 'c1'},
        {label: 'Chip 2', value: 'c2'},
      ]),
      value: {value: angularSignal(['c1']), raw: ['c1'], onUpdate: onUpdateSpy},
      variant: createBoundProperty<'multipleSelection' | 'mutuallyExclusive' | undefined>(
        'multipleSelection',
      ),
      displayStyle: createBoundProperty<'checkbox' | 'chips' | undefined>('chips'),
    });
    fixture.detectChanges();
    const chips = fixture.nativeElement.querySelectorAll('.a2ui-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].classList.contains('active')).toBeTrue();
    expect(chips[1].classList.contains('active')).toBeFalse();

    chips[1].click();
    expect(onUpdateSpy).toHaveBeenCalledWith(['c1', 'c2']);

    chips[0].click();
    expect(onUpdateSpy).toHaveBeenCalledWith([]);
  });
});
