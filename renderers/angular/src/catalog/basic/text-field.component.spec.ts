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
import {TextFieldComponent} from './text-field.component';
import {A2uiRendererService, A2UI_RENDERER_CONFIG} from '../../core/a2ui-renderer.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '@a2ui/angular/testing';
import {By} from '@angular/platform-browser';

describe('TextFieldComponent', () => {
  let component: TextFieldComponent;
  let fixture: ComponentFixture<TextFieldComponent>;
  let defaultProps: ComponentToProps<TextFieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TextFieldComponent],
      providers: [A2uiRendererService, {provide: A2UI_RENDERER_CONFIG, useValue: {catalogs: []}}],
    }).compileComponents();

    fixture = TestBed.createComponent(TextFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'surf1');
    defaultProps = {
      label: createBoundProperty('Username'),
      value: createBoundProperty('testuser'),
      variant: createBoundProperty('shortText' as const),
      isValid: createBoundProperty(true),
      validationErrors: createBoundProperty<string[]>([]),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render label if provided', () => {
    fixture.detectChanges();
    const label = fixture.debugElement.query(By.css('label'));
    expect(label.nativeElement.textContent).toBe('Username');
  });

  it('should not render label if not provided', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      label: createBoundProperty(null as any),
    });
    fixture.detectChanges();
    const label = fixture.debugElement.query(By.css('label'));
    expect(label).toBeFalsy();
  });
  it('should render input with correct value', () => {
    fixture.detectChanges();
    const input = fixture.debugElement.query(By.css('input'));
    expect(input.nativeElement.value).toBe('testuser');
  });

  it('should return correct input type based on variant', () => {
    expect(component.inputType()).toBe('text');

    setComponentProps(fixture, {
      ...defaultProps,
      variant: createBoundProperty('obscured' as const),
    });
    expect(component.inputType()).toBe('password');

    setComponentProps(fixture, {
      ...defaultProps,
      variant: createBoundProperty('number' as const),
    });
    expect(component.inputType()).toBe('number');
  });

  it('should call onUpdate when input changes', () => {
    fixture.detectChanges();
    const input = fixture.debugElement.query(By.css('input'));
    input.nativeElement.value = 'newuser';
    input.triggerEventHandler('input', {target: input.nativeElement});

    expect(component.props()['value']!.onUpdate).toHaveBeenCalledWith('newuser');
  });

  it('should show error messages when checks fail', async () => {
    const isValidProp = createBoundProperty(true);
    const errorsProp = createBoundProperty<string[]>([]);

    setComponentProps(fixture, {
      ...defaultProps,
      isValid: isValidProp,
      validationErrors: errorsProp,
    });

    fixture.detectChanges();

    const errorMsgBefore = fixture.debugElement.query(By.css('.a2ui-error-message'));
    expect(errorMsgBefore).toBeFalsy();

    isValidProp.value.set(false);
    errorsProp.value.set(['Value is required']);
    fixture.detectChanges();

    const errorMsgAfter = fixture.debugElement.query(By.css('.a2ui-error-message'));
    expect(errorMsgAfter).toBeTruthy();
    expect(errorMsgAfter.nativeElement.textContent).toContain('Value is required');
  });

  it('should handle multiple error messages', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      isValid: createBoundProperty(false),
      validationErrors: createBoundProperty(['Error 1', 'Error 2']),
    });

    fixture.detectChanges();

    const errorMsgs = fixture.debugElement.queryAll(By.css('.a2ui-error-message'));
    expect(errorMsgs.length).toBe(2);
    expect(errorMsgs[0].nativeElement.textContent).toContain('Error 1');
    expect(errorMsgs[1].nativeElement.textContent).toContain('Error 2');
  });
});
