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
import {Component, input, signal} from '@angular/core';
import {ColumnComponent} from './column.component';
import {ComponentModel} from '@a2ui/web_core/v0_9';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {By} from '@angular/platform-browser';
import {setComponentProps, createBoundProperty, ComponentToProps} from '../../core/test-utils';

@Component({
  standalone: true,
  selector: 'dummy-child',
  template: 'Dummy Child',
})
class DummyChild {
  props = input<any>();
  surfaceId = input<string>();
  componentId = input<string>();
  dataContextPath = input<string>();
}

describe('ColumnComponent', () => {
  let component: ColumnComponent;
  let fixture: ComponentFixture<ColumnComponent>;
  let mockRendererService: any;
  let mockSurface: any;
  let mockSurfaceGroup: any;
  let mockBinder: any;
  let defaultProps: ComponentToProps<ColumnComponent>;

  beforeEach(async () => {
    mockSurface = {
      componentsModel: new Map([
        ['child1', new ComponentModel('child1', 'Child', {})],
        ['child2', new ComponentModel('child2', 'Child', {})],
        ['template1', new ComponentModel('template1', 'Child', {})],
      ]),
      catalog: {
        id: 'test-catalog',
        components: new Map([['Child', {component: DummyChild}]]),
      },
    };

    mockSurfaceGroup = {
      getSurface: jasmine.createSpy('getSurface').and.returnValue(mockSurface),
    };

    mockRendererService = {
      surfaceGroup: mockSurfaceGroup,
    };

    mockBinder = jasmine.createSpyObj('ComponentBinder', ['bind']);
    mockBinder.bind.and.returnValue({text: {value: () => 'bound'}});

    await TestBed.configureTestingModule({
      imports: [ColumnComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ColumnComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'surf1');

    defaultProps = {
      justify: createBoundProperty('start' as const),
      align: createBoundProperty('stretch' as const),
      children: createBoundProperty([
        {id: 'child1', basePath: '/'},
        {id: 'child2', basePath: '/'},
      ]),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should apply flex styles from props', () => {
    fixture.detectChanges();
    const style = window.getComputedStyle(fixture.debugElement.nativeElement);
    expect(style.justifyContent).toBe('flex-start');
    expect(style.alignItems).toBe('stretch');
  });

  it('should apply flex style from weight prop', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      weight: createBoundProperty(2),
    });
    fixture.detectChanges();
    const style = window.getComputedStyle(fixture.debugElement.nativeElement);
    expect(style.flex).toBe('2 1 0%');
  });

  it('should apply flex style from weight prop when value is 0', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      weight: createBoundProperty(0),
    });
    fixture.detectChanges();
    const style = window.getComputedStyle(fixture.debugElement.nativeElement);
    expect(style.flex).toBe('0 1 0%');
  });

  it('should not apply flex style when weight prop is null', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      weight: createBoundProperty(undefined),
    });
    fixture.detectChanges();
    const style = window.getComputedStyle(fixture.debugElement.nativeElement);
    expect(style.flex).not.toBe('2 1 0%');
    expect(style.flex).not.toBe('0 1 0%');
  });

  it('should render non-repeating children', () => {
    fixture.detectChanges();
    const hosts = fixture.debugElement.queryAll(By.css('a2ui-v09-component-host'));
    expect(hosts.length).toBe(2);
    expect(hosts[0].componentInstance.componentKey()).toEqual({id: 'child1', basePath: '/'});
    expect(hosts[1].componentInstance.componentKey()).toEqual({id: 'child2', basePath: '/'});
  });

  it('should render repeating children', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      children: {
        value: signal([
          {id: 'template1', basePath: '/items/0'},
          {id: 'template1', basePath: '/items/1'},
        ]),
        raw: {
          componentId: 'template1',
          path: 'items',
        },
        template: {
          id: 'template1',
          path: 'items',
        },
        onUpdate: jasmine.createSpy('onUpdate'),
      },
    });
    fixture.detectChanges();

    const hosts = fixture.debugElement.queryAll(By.css('a2ui-v09-component-host'));
    expect(hosts.length).toBe(2);
    expect(hosts[0].componentInstance.componentKey()).toEqual({
      id: 'template1',
      basePath: '/items/0',
    });
    expect(hosts[1].componentInstance.componentKey()).toEqual({
      id: 'template1',
      basePath: '/items/1',
    });
  });

  it('should handle missing justify and align properties', () => {
    setComponentProps(fixture, {
      children: createBoundProperty([{id: 'child1', basePath: '/'}]),
    });
    fixture.detectChanges();
    const div = fixture.debugElement;
    expect(div.styles['justify-content']).toBeFalsy();
    expect(div.styles['align-items']).toBeFalsy();
  });
});
