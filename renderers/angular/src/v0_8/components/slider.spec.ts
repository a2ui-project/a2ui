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
import {Slider} from './slider';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import {By} from '@angular/platform-browser';

describe('Slider Component', () => {
  let component: Slider;
  let fixture: ComponentFixture<Slider>;
  let mockTheme: Theme;
  let mockProcessor: jasmine.SpyObj<MessageProcessor>;

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {
      Slider: {
        container: 'slider-container',
        label: 'slider-label',
        element: 'slider-input',
      },
    } as any;

    mockProcessor = jasmine.createSpyObj('MessageProcessor', [
      'dispatch',
      'resolvePath',
      'getData',
    ]);
    mockProcessor.dispatch.and.returnValue(Promise.resolve([]));

    await TestBed.configureTestingModule({
      imports: [Slider],
      providers: [
        {provide: MessageProcessor, useValue: mockProcessor},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Slider);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', {id: 'slider-1', type: 'Slider', weight: 1});
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('label', {literalString: 'Volume'});
    fixture.componentRef.setInput('value', {literalNumber: 50});
    fixture.componentRef.setInput('minValue', 0);
    fixture.componentRef.setInput('maxValue', 100);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render label and set input attributes', () => {
    const labelEl = fixture.debugElement.query(By.css('label'));
    expect(labelEl).toBeTruthy();
    expect(labelEl.nativeElement.textContent.trim()).toBe('Volume');

    const inputEl = fixture.debugElement.query(By.css('input[type="range"]'));
    expect(inputEl).toBeTruthy();
    expect(inputEl.nativeElement.value).toBe('50');
    expect(inputEl.nativeElement.min).toBe('0');
    expect(inputEl.nativeElement.max).toBe('100');
  });

  it('should trigger sendAction with number context on input change', async () => {
    const inputEl = fixture.debugElement.query(By.css('input[type="range"]'));
    expect(inputEl).toBeTruthy();

    inputEl.nativeElement.value = '75';
    inputEl.nativeElement.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(mockProcessor.dispatch).toHaveBeenCalled();
    const message = mockProcessor.dispatch.calls.mostRecent().args[0];
    expect(message.userAction).toBeTruthy();
    expect(message.userAction!.name).toBe('change');
    expect(message.userAction!.context).toEqual({value: 75});
  });

  it('should use label as aria-label when label is set', () => {
    const inputEl = fixture.debugElement.query(By.css('input[type="range"]'));
    expect(inputEl).toBeTruthy();
    expect(inputEl.nativeElement.getAttribute('aria-label')).toBe('Volume');
  });

  it('should use default aria-label when label is not set', () => {
    fixture.componentRef.setInput('label', null);
    fixture.detectChanges();

    const inputEl = fixture.debugElement.query(By.css('input[type="range"]'));
    expect(inputEl).toBeTruthy();
    expect(inputEl.nativeElement.getAttribute('aria-label')).toBe('Slider');
  });
});
