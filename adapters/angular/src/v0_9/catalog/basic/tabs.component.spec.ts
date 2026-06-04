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
import {TabsComponent} from './tabs.component';
import {ComponentModel, DynamicString} from '@a2ui/web_core/v0_9';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '../../core/test-utils';

@Component({
  selector: 'dummy-text-for-tabs',
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

describe('TabsComponent', () => {
  let component: TabsComponent;
  let fixture: ComponentFixture<TabsComponent>;
  let defaultProps: ComponentToProps<TabsComponent>;

  beforeEach(async () => {
    const mockRendererService = {
      surfaceGroup: {
        getSurface: jasmine.createSpy('getSurface').and.returnValue({
          componentsModel: new Map([
            ['content-1', new ComponentModel('content-1', 'Text', {text: {value: 'Content 1'}})],
            ['content-2', new ComponentModel('content-2', 'Text', {text: {value: 'Content 2'}})],
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
      imports: [TabsComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TabsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      tabs: createBoundProperty<{title: DynamicString; child: string}[]>([]),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render tabs and switch content', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      tabs: createBoundProperty<{title: DynamicString; child: string}[]>([
        {title: 'Tab 1', child: 'content-1'},
        {title: 'Tab 2', child: 'content-2'},
      ]),
    });
    fixture.detectChanges();
    const tabs = fixture.nativeElement.querySelectorAll('.a2ui-tab-button');
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain('Tab 1');

    let host = fixture.debugElement.query(By.css('a2ui-v09-component-host'));
    expect(host.componentInstance.componentKey()).toEqual({id: 'content-1', basePath: '/'});

    tabs[1].click();
    fixture.detectChanges();
    host = fixture.debugElement.query(By.css('a2ui-v09-component-host'));
    expect(host.componentInstance.componentKey()).toEqual({id: 'content-2', basePath: '/'});
  });

  it('should handle missing tabs property', () => {
    fixture.detectChanges();
    expect(component.tabs()).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('.a2ui-tab-button').length).toBe(0);
  });

  it('should handle empty tabs array', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      tabs: createBoundProperty<{title: DynamicString; child: string}[]>([]),
    });
    fixture.detectChanges();
    expect(component.tabs()).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('.a2ui-tab-button').length).toBe(0);
  });
});
