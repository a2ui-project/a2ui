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
import {Component, input} from '@angular/core';
import {ButtonComponent} from './button.component';
import {Action, ComponentModel} from '@a2ui/web_core/v0_9';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder, Child} from '../../core/component-binder.service';
import {By} from '@angular/platform-browser';
import {setComponentProps, createBoundProperty, ComponentToProps} from '../../core/test-utils';

describe('ButtonComponent', () => {
  let component: ButtonComponent;
  let fixture: ComponentFixture<ButtonComponent>;
  let mockRendererService: any;
  let mockSurface: any;
  let mockSurfaceGroup: any;
  let defaultProps: ComponentToProps<ButtonComponent>;

  beforeEach(async () => {
    mockSurface = {
      dispatchAction: jasmine.createSpy('dispatchAction'),
      componentsModel: new Map([
        ['child1', new ComponentModel('child1', 'Text', {text: 'Child Content'})],
      ]),
      catalog: {
        id: 'test-catalog',
        components: new Map([
          [
            'Text',
            {
              component: (() => {
                @Component({
                  standalone: true,
                  selector: 'dummy-text',
                  template: 'Dummy Text',
                })
                class DummyText {
                  props = input<any>();
                  surfaceId = input<string>();
                  componentId = input<string>();
                  dataContextPath = input<string>();
                }
                return DummyText;
              })(),
            },
          ],
        ]),
      },
    };

    mockSurfaceGroup = {
      getSurface: jasmine.createSpy('getSurface').and.returnValue(mockSurface),
    };

    mockRendererService = {
      surfaceGroup: mockSurfaceGroup,
    };

    const mockBinder = jasmine.createSpyObj('ComponentBinder', ['bind']);
    mockBinder.bind.and.returnValue({text: {value: () => 'bound text'}});

    await TestBed.configureTestingModule({
      imports: [ButtonComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ButtonComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'surf1');
    fixture.componentRef.setInput('componentId', 'comp1');

    defaultProps = {
      variant: createBoundProperty('primary' as const),
      child: createBoundProperty<Child>({id: 'child1', basePath: '/'}),
      action: createBoundProperty<Action>({
        event: {name: 'test-action'},
      }),
      isValid: createBoundProperty(true),
      validationErrors: createBoundProperty<string[]>([]),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should set button type to submit for primary variant', () => {
    fixture.detectChanges();
    const button = fixture.debugElement.query(By.css('button'));
    expect(button.nativeElement.type).toBe('submit');
  });

  it('should set button type to button for non-primary variant', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      variant: createBoundProperty('default' as const),
    });
    fixture.detectChanges();
    const button = fixture.debugElement.query(By.css('button'));
    expect(button.nativeElement.type).toBe('button');
  });

  it('should apply variant class', () => {
    fixture.detectChanges();
    const button = fixture.debugElement.query(By.css('button'));
    expect(button.nativeElement.classList).toContain('primary');
  });

  it('should handle click and dispatch action with sourceComponentId', () => {
    fixture.detectChanges();
    const button = fixture.debugElement.query(By.css('button'));
    button.triggerEventHandler('click', null);

    expect(mockSurfaceGroup.getSurface).toHaveBeenCalledWith('surf1');
    expect(mockSurface.dispatchAction).toHaveBeenCalledWith(jasmine.any(Object), 'comp1');
  });

  it('should show child component host if child prop is present', () => {
    fixture.detectChanges();
    const host = fixture.debugElement.query(By.css('a2ui-v09-component-host'));
    expect(host).toBeTruthy();
    expect(host.componentInstance.componentKey()).toEqual({id: 'child1', basePath: '/'});
  });

  it('should be disabled when isValid is false', () => {
    const isValidProp = createBoundProperty(true);

    setComponentProps(fixture, {
      ...defaultProps,
      isValid: isValidProp,
    });

    fixture.detectChanges();
    const button = fixture.debugElement.query(By.css('button'));
    expect(button.nativeElement.disabled).toBeFalse();

    isValidProp.value.set(false);
    fixture.detectChanges();
    expect(button.nativeElement.disabled).toBeTrue();
  });

  it('should override the button default background color when primary color is set', () => {
    mockSurface.theme = {primaryColor: 'red'};
    fixture.detectChanges();
    const button = fixture.debugElement.query(By.css('button'));
    const computedStyle = window.getComputedStyle(button.nativeElement);

    expect(computedStyle.backgroundColor).toBe('rgb(255, 0, 0)'); // 'red' is evaluated to rgb in computed style
  });
});
