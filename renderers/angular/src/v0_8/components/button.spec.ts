/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {Button} from './button';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import {Renderer} from '../rendering/renderer';
import type {Action, ButtonNode, A2UIClientEventMessage} from '../types';
import {Directive, Input} from '@angular/core';

// Mock Renderer directive to avoid full tree rendering issues for isolated unit tests
@Directive({
  selector: '[a2ui-renderer]',
  standalone: true,
})
class MockRenderer {
  @Input() surfaceId!: string;
  @Input() component!: any;
}

describe('Button Component', () => {
  let component: Button;
  let fixture: ComponentFixture<Button>;
  let mockProcessor: jasmine.SpyObj<MessageProcessor>;
  let mockTheme: Theme;

  const mockAction: Action = {
    name: 'testAction',
    context: [],
  };

  const mockButtonNode: ButtonNode = {
    id: 'btn-1',
    type: 'Button',
    weight: 1,
    properties: {
      child: {id: 'text-1', type: 'Text', properties: {text: 'Click Me'}},
      action: mockAction,
    },
  };

  beforeEach(async () => {
    mockProcessor = jasmine.createSpyObj('MessageProcessor', [
      'dispatch',
      'resolvePath',
      'getData',
    ]);
    mockProcessor.dispatch.and.returnValue(Promise.resolve([]));

    mockTheme = new Theme();
    mockTheme.components = {Button: 'btn-class'} as any;
    mockTheme.additionalStyles = {Button: {color: 'red'}} as any;

    const mockCatalog = {};

    await TestBed.configureTestingModule({
      imports: [Button],
      providers: [
        {provide: MessageProcessor, useValue: mockProcessor},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: mockCatalog},
      ],
    })
      .overrideComponent(Button, {
        remove: {imports: [Renderer]},
        add: {imports: [MockRenderer]},
      })
      .compileComponents();

    fixture = TestBed.createComponent(Button);
    component = fixture.componentInstance;

    // Set inputs
    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', mockButtonNode);
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('action', mockAction);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should apply theme classes and styles', () => {
    const buttonEl = fixture.nativeElement.querySelector('button');
    expect(buttonEl.className).toContain('btn-class');
    expect(buttonEl.style.color).toBe('red');
  });

  it('should call super.sendAction on click', () => {
    const buttonEl = fixture.nativeElement.querySelector('button');
    buttonEl.click();

    expect(mockProcessor.dispatch).toHaveBeenCalled();
    const message = mockProcessor.dispatch.calls.mostRecent().args[0] as A2UIClientEventMessage;
    expect(message.userAction!.name).toBe('testAction');
    expect(message.userAction!.sourceComponentId).toBe('btn-1');
  });

  it('should not dispatch if action is null', () => {
    fixture.componentRef.setInput('action', null);
    fixture.detectChanges();

    const buttonEl = fixture.nativeElement.querySelector('button');
    buttonEl.click();

    expect(mockProcessor.dispatch).not.toHaveBeenCalled();
  });
});
