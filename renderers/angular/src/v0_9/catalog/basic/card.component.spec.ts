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
import {By} from '@angular/platform-browser';
import {CardComponent} from './card.component';
import {ComponentModel} from '@a2ui/web_core/v0_9';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '@a2ui/angular/testing';

@Component({
  selector: 'dummy-text-for-card',
  template: '<div>{{text}}</div>',
  standalone: true,
})
class DummyTextComponent {
  text?: string;
  props = input<Record<string, unknown>>();
  surfaceId = input<string>();
  componentId = input<string>();
  dataContextPath = input<string>();
}

describe('CardComponent', () => {
  let component: CardComponent;
  let fixture: ComponentFixture<CardComponent>;
  let defaultProps: ComponentToProps<CardComponent>;

  beforeEach(async () => {
    const mockRendererService = {
      surfaceGroup: {
        getSurface: jasmine.createSpy('getSurface').and.returnValue({
          componentsModel: new Map([
            ['child-1', new ComponentModel('child-1', 'Text', {text: {value: 'Child 1'}})],
          ]),
          catalog: {
            id: 'mock-catalog',
            components: new Map([['Text', {type: 'Text', component: DummyTextComponent}]]),
          },
        }),
      },
    };
    const mockBinder = jasmine.createSpyObj('ComponentBinder', ['bind']);

    await TestBed.configureTestingModule({
      imports: [CardComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      child: createBoundProperty({id: 'child-1', basePath: '/'}),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render component-host for child', () => {
    fixture.detectChanges();
    const host = fixture.debugElement.query(By.css('a2ui-v09-component-host'));
    expect(host).toBeTruthy();
    expect(host.componentInstance.componentKey()).toEqual({id: 'child-1', basePath: '/'});
  });
});
