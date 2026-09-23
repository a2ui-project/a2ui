/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {Component, input, signal} from '@angular/core';
import {RowComponent} from './row.component';
import {ColumnComponent} from './column.component';
import {ComponentContext, ComponentModel} from '@a2ui/web_core/v0_9';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {By} from '@angular/platform-browser';
import {setComponentProps, createBoundProperty, ComponentToProps} from '@a2ui/angular/testing';

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

describe('RowComponent', () => {
  let component: RowComponent;
  let fixture: ComponentFixture<RowComponent>;
  let mockRendererService: any;
  let mockSurface: any;
  let mockSurfaceGroup: any;
  let mockBinder: any;
  let defaultProps: ComponentToProps<RowComponent>;

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
      imports: [RowComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RowComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'surf1');

    defaultProps = {
      justify: createBoundProperty('center' as const),
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
    expect(style.justifyContent).toBe('center');
    expect(style.alignItems).toBe('stretch');
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

  it('should style direct Column/Row children with width: auto without affecting nested descendants', () => {
    mockSurface.componentsModel.set('directCol', new ComponentModel('directCol', 'Column', {}));
    mockSurface.componentsModel.set('nestedCol', new ComponentModel('nestedCol', 'Column', {}));
    mockSurface.componentsModel.set('nestedRow', new ComponentModel('nestedRow', 'Row', {}));
    mockSurface.catalog.components.set('Column', {component: ColumnComponent});
    mockSurface.catalog.components.set('Row', {component: RowComponent});

    mockBinder.bind.and.callFake((ctx: ComponentContext) => {
      if (ctx.componentModel.id === 'directCol') {
        return {
          children: createBoundProperty([
            {id: 'nestedCol', basePath: '/'},
            {id: 'nestedRow', basePath: '/'},
          ]),
        };
      }
      return {
        children: createBoundProperty([]),
      };
    });

    const hostEl = fixture.debugElement.nativeElement as HTMLElement;
    hostEl.style.width = '500px';

    setComponentProps(fixture, {
      ...defaultProps,
      children: createBoundProperty([{id: 'directCol', basePath: '/'}]),
    });
    fixture.detectChanges();

    const directColDebug = fixture.debugElement.query(By.directive(ColumnComponent));
    const nestedColDebug = directColDebug.query(By.directive(ColumnComponent));
    const nestedRowDebug = directColDebug.query(By.directive(RowComponent));

    expect(directColDebug).toBeTruthy();
    expect(nestedColDebug).toBeTruthy();
    expect(nestedRowDebug).toBeTruthy();

    // Direct child Column inside Row has width: auto (0px since it has no content),
    // whereas nested Column/Row inside that Column retain width: 100% of their parent.
    directColDebug.nativeElement.style.width = '200px';
    fixture.detectChanges();

    expect(window.getComputedStyle(nestedColDebug.nativeElement).width).toBe('200px');
    expect(window.getComputedStyle(nestedRowDebug.nativeElement).width).toBe('200px');

    directColDebug.nativeElement.style.removeProperty('width');
    fixture.detectChanges();
    expect(window.getComputedStyle(directColDebug.nativeElement).width).toBe('0px');
  });
});
