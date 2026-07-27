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
import {DateTimeInput} from './datetime-input';
import type {A2UIClientEventMessage, DateTimeInputNode} from '../types';
import {Theme} from '../rendering/theming';
import {MessageProcessor} from '../data/processor';
import {Catalog} from '../rendering/catalog';

describe('DateTimeInput Component', () => {
  let component: DateTimeInput;
  let fixture: ComponentFixture<DateTimeInput>;
  let mockTheme: Theme;
  let mockProcessor: jasmine.SpyObj<MessageProcessor>;

  const mockDatetimeNode: DateTimeInputNode = {
    id: 'dt-1',
    type: 'DateTimeInput',
    weight: 1,
    properties: {
      value: {literalString: '2023-10-27'},
    },
  };

  beforeEach(async () => {
    mockProcessor = jasmine.createSpyObj('MessageProcessor', ['dispatch']);
    mockProcessor.dispatch.and.returnValue(Promise.resolve([]));

    mockTheme = new Theme();
    mockTheme.components = {
      DateTimeInput: {
        container: {'dt-container': true},
        label: {'dt-label': true},
        element: {'dt-element': true},
      },
    } as any;

    await TestBed.configureTestingModule({
      imports: [DateTimeInput],
      providers: [
        {provide: MessageProcessor, useValue: mockProcessor},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DateTimeInput);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', mockDatetimeNode);
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('value', mockDatetimeNode.properties.value);
    fixture.componentRef.setInput('label', {literalString: 'Select Date'});

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render label and input element', () => {
    const labelEl = fixture.nativeElement.querySelector('label');
    const inputEl = fixture.nativeElement.querySelector('input');

    expect(labelEl).toBeTruthy();
    expect(labelEl.textContent).toContain('Select Date');
    expect(inputEl).toBeTruthy();
    expect(inputEl.value).toBe('2023-10-27');
  });

  it('should apply correct input type based on flags', () => {
    const inputEl = fixture.nativeElement.querySelector('input');

    // Default is date (enableDate=true, enableTime=false)
    expect(inputEl.type).toBe('date');

    // Enable time only
    fixture.componentRef.setInput('enableDate', false);
    fixture.componentRef.setInput('enableTime', true);
    fixture.detectChanges();
    expect(inputEl.type).toBe('time');

    // Enable both
    fixture.componentRef.setInput('enableDate', true);
    fixture.componentRef.setInput('enableTime', true);
    fixture.detectChanges();
    expect(inputEl.type).toBe('datetime-local');
  });

  it('should call super.sendAction on change event', () => {
    const inputEl = fixture.nativeElement.querySelector('input');
    inputEl.value = '2023-10-28';
    inputEl.dispatchEvent(new Event('change'));

    expect(mockProcessor.dispatch).toHaveBeenCalled();
    const message = mockProcessor.dispatch.calls.mostRecent().args[0] as A2UIClientEventMessage;
    expect(message.userAction!.name).toBe('change');

    // Verify context
    expect(message.userAction!.context).toEqual({value: '2023-10-28'});
  });

  it('should apply theme classes', () => {
    const containerEl = fixture.nativeElement.querySelector('div');
    const labelEl = fixture.nativeElement.querySelector('label');
    const inputEl = fixture.nativeElement.querySelector('input');

    expect(containerEl.className).toContain('dt-container');
    expect(labelEl.className).toContain('dt-label');
    expect(inputEl.className).toContain('dt-element');
  });
});
