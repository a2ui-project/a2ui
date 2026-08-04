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
import {CheckBoxComponent} from './check-box.component';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '@a2ui/angular/testing';

describe('CheckBoxComponent', () => {
  let component: CheckBoxComponent;
  let fixture: ComponentFixture<CheckBoxComponent>;
  let mockRendererService: {surfaceGroup: {getSurface: jasmine.Spy}};
  let defaultProps: ComponentToProps<CheckBoxComponent>;

  beforeEach(async () => {
    mockRendererService = {
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
      imports: [CheckBoxComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckBoxComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      label: createBoundProperty(''),
      value: createBoundProperty(false),
      isValid: createBoundProperty(true),
      validationErrors: createBoundProperty<string[]>([]),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should show label and checked state', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      label: createBoundProperty('Check me'),
      value: createBoundProperty(true),
    });
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input');
    expect(input.checked).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Check me');
  });

  it('should call onUpdate when toggled', () => {
    const onUpdateSpy = jasmine.createSpy('onUpdate');
    setComponentProps(fixture, {
      ...defaultProps,
      value: {value: angularSignal(false), raw: false, onUpdate: onUpdateSpy},
    });
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input');
    input.click();
    expect(onUpdateSpy).toHaveBeenCalledWith(true);
  });

  it('should apply primary color when checked', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      value: createBoundProperty(true),
    });
    mockRendererService.surfaceGroup.getSurface.and.returnValue({
      theme: {primaryColor: 'rgb(255, 0, 0)'},
      componentsModel: new Map(),
      catalog: {components: new Map()},
    });
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input');
    const styles = window.getComputedStyle(input);

    expect(styles.accentColor).toBe('rgb(255, 0, 0)');
  });
});
