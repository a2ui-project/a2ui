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
import {ListComponent} from './list.component';
import {ComponentModel} from '@a2ui/web_core/v0_9';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder, Child} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '@a2ui/angular/testing';

@Component({
  selector: 'dummy-text-for-list',
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

describe('ListComponent', () => {
  let component: ListComponent;
  let fixture: ComponentFixture<ListComponent>;
  let defaultProps: ComponentToProps<ListComponent>;

  beforeEach(async () => {
    const mockRendererService = {
      surfaceGroup: {
        getSurface: jasmine.createSpy('getSurface').and.returnValue({
          componentsModel: new Map([
            ['child-1', new ComponentModel('child-1', 'Text', {text: {value: 'Child 1'}})],
            ['child-2', new ComponentModel('child-2', 'Text', {text: {value: 'Child 2'}})],
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
      imports: [ListComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      children: createBoundProperty<Child[]>([]),
      direction: createBoundProperty<'vertical' | 'horizontal' | undefined>('vertical'),
      listStyle: createBoundProperty<'none' | 'ordered' | 'unordered' | undefined>('none'),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render children', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      children: createBoundProperty([
        {id: 'child-1', basePath: '/'},
        {id: 'child-2', basePath: '/'},
      ]),
    });
    fixture.detectChanges();
    const hosts = fixture.nativeElement.querySelectorAll('a2ui-v09-component-host');
    expect(hosts.length).toBe(2);
  });

  it('should render as ordered list', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      children: createBoundProperty([{id: 'child-1', basePath: '/'}]),
      listStyle: createBoundProperty<'none' | 'ordered' | 'unordered' | undefined>('ordered'),
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ol')).toBeTruthy();
  });

  it('should render as unordered list', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      children: createBoundProperty([{id: 'child-1', basePath: '/'}]),
      listStyle: createBoundProperty<'none' | 'ordered' | 'unordered' | undefined>('unordered'),
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ul')).toBeTruthy();
  });

  it('should render fallback list when style is not list style', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      children: createBoundProperty([{id: 'child-1', basePath: '/'}]),
      listStyle: createBoundProperty('div' as 'none' | 'ordered' | 'unordered' | undefined),
    });
    fixture.detectChanges();
    const divList = fixture.nativeElement.querySelector('.a2ui-list');
    expect(divList.tagName.toLowerCase()).toBe('div');
  });

  it('should apply horizontal orientation class', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      children: createBoundProperty([{id: 'child-1', basePath: '/'}]),
      direction: createBoundProperty<'vertical' | 'horizontal' | undefined>('horizontal'),
    });
    fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('.a2ui-list');
    expect(list.classList).toContain('horizontal');
  });
});
