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
import {Checkbox} from './checkbox';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import type {A2UIClientEventMessage, CheckboxNode} from '../types';

describe('Checkbox Component', () => {
  let component: Checkbox;
  let fixture: ComponentFixture<Checkbox>;
  let mockProcessor: jasmine.SpyObj<MessageProcessor>;

  const mockNode: CheckboxNode = {
    id: 'chk-1',
    type: 'CheckBox',
    weight: 1,
    properties: {
      label: {literalString: 'Accept Terms'},
      value: {literalBoolean: false},
    },
  };

  beforeEach(async () => {
    mockProcessor = jasmine.createSpyObj('MessageProcessor', [
      'dispatch',
      'resolvePath',
      'getData',
    ]);
    mockProcessor.dispatch.and.returnValue(Promise.resolve([]));

    await TestBed.configureTestingModule({
      imports: [Checkbox],
      providers: [
        {provide: MessageProcessor, useValue: mockProcessor},
        {provide: Theme, useValue: new Theme()},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Checkbox);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', mockNode);
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('label', {literalString: 'Accept Terms'});
    fixture.componentRef.setInput('value', {literalBoolean: false});

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render label text', () => {
    const labelEl = fixture.nativeElement.querySelector('label');
    expect(labelEl.textContent).toContain('Accept Terms');
  });

  it('should reflect checked state', () => {
    const inputEl = fixture.nativeElement.querySelector('input');
    expect(inputEl.checked).toBeFalse();

    fixture.componentRef.setInput('value', {literalBoolean: true});
    fixture.detectChanges();
    expect(inputEl.checked).toBeTrue();
  });

  it('should dispatch action on toggle', () => {
    const inputEl = fixture.nativeElement.querySelector('input');
    inputEl.checked = true;
    inputEl.dispatchEvent(new Event('change'));

    expect(mockProcessor.dispatch).toHaveBeenCalled();
    const message = mockProcessor.dispatch.calls.mostRecent().args[0] as A2UIClientEventMessage;
    expect(message.userAction!.name).toBe('toggle');
    expect(message.userAction!.context!['checked']).toBeTrue();
  });
});
