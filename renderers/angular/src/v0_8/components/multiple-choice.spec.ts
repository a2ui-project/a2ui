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
import {MultipleChoice} from './multiple-choice';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import {By} from '@angular/platform-browser';

describe('MultipleChoice Component', () => {
  let component: MultipleChoice;
  let fixture: ComponentFixture<MultipleChoice>;
  let mockTheme: Theme;
  let mockProcessor: jasmine.SpyObj<MessageProcessor>;

  const mockOptions = [
    {label: {literalString: 'Option 1'} as any, value: 'opt1'},
    {label: {literalString: 'Option 2'} as any, value: 'opt2'},
  ];

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {
      MultipleChoice: {
        container: 'container-class',
        label: 'label-class',
        element: 'select-class',
      },
    } as any;

    mockProcessor = jasmine.createSpyObj('MessageProcessor', [
      'dispatch',
      'resolvePath',
      'getData',
    ]);
    mockProcessor.dispatch.and.returnValue(Promise.resolve([]));

    await TestBed.configureTestingModule({
      imports: [MultipleChoice],
      providers: [
        {provide: MessageProcessor, useValue: mockProcessor},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MultipleChoice);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', {id: 'mc-1', type: 'MultipleChoice', weight: 1});
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('label', {literalString: 'Select an option'});
    fixture.componentRef.setInput('options', mockOptions);
    fixture.componentRef.setInput('selections', {literalArray: ['opt1']});

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render label and options', () => {
    const labelEl = fixture.debugElement.query(By.css('label'));
    expect(labelEl).toBeTruthy();
    expect(labelEl.nativeElement.textContent.trim()).toBe('Select an option');

    const optionEls = fixture.debugElement.queryAll(By.css('option'));
    expect(optionEls.length).toBe(2);
    expect(optionEls[0].nativeElement.textContent.trim()).toBe('Option 1');
    expect(optionEls[0].nativeElement.value).toBe('opt1');
    expect(optionEls[1].nativeElement.textContent.trim()).toBe('Option 2');
    expect(optionEls[1].nativeElement.value).toBe('opt2');
  });

  it('should trigger sendAction on change', async () => {
    const selectEl = fixture.debugElement.query(By.css('select'));
    expect(selectEl).toBeTruthy();

    selectEl.nativeElement.value = 'opt2';
    selectEl.nativeElement.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(mockProcessor.dispatch).toHaveBeenCalled();
    const message = mockProcessor.dispatch.calls.mostRecent().args[0];
    expect(message.userAction).toBeTruthy();
    expect(message.userAction!.name).toBe('change');
    expect(message.userAction!.context).toEqual({value: 'opt2'});
  });
});
