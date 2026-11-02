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

import {Component, EnvironmentInjector, Input, ChangeDetectionStrategy, Type} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {SurfaceComponent} from './surface.component';
import {ComponentHostComponent} from './component-host.component';
import {By} from '@angular/platform-browser';
import {A2uiRendererService} from './a2ui-renderer.service';
import {SurfaceNodeResolver} from './surface-node-resolver.service';
import {initializeAngularReactivity} from './reactivity';
import {CatalogComponentInstance} from './catalog_component_instance';
import {AngularCatalog, createComponentImplementation} from '../catalog/types';
import {ComponentModel, DynamicStringSchema, SurfaceModel} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

@Component({
  selector: 'test-text',
  template: '<div>{{props?.["text"]?.value()}}</div>',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestTextComponent {
  @Input() props: any;
  @Input() surfaceId?: string;
  @Input() componentId?: string;
  @Input() dataContextPath?: string;
}

describe('SurfaceComponent', () => {
  let component: SurfaceComponent;
  let fixture: ComponentFixture<SurfaceComponent>;
  let mockRendererService: any;
  let surface: SurfaceModel<any>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SurfaceComponent],
      providers: [{provide: A2uiRendererService, useFactory: () => mockRendererService}],
    }).compileComponents();
    initializeAngularReactivity(TestBed.inject(EnvironmentInjector));

    const catalog = new AngularCatalog('test-catalog', '0.9', [
      createComponentImplementation(
        {name: 'Text', schema: z.object({text: DynamicStringSchema})},
        TestTextComponent as unknown as Type<CatalogComponentInstance>,
      ),
    ]);
    surface = new SurfaceModel('test-surface', catalog);
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'Text', {text: 'Hello'}, catalog),
    );

    mockRendererService = {
      surfaceGroup: {
        getSurface: jasmine.createSpy('getSurface').and.returnValue(surface),
      },
      useUniversalComponents: false,
    };

    fixture = TestBed.createComponent(SurfaceComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render component-host with correct inputs', () => {
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/custom/path');
    fixture.detectChanges();

    const host = fixture.debugElement.query(By.directive(ComponentHostComponent));
    expect(host).toBeTruthy();
    expect(host.componentInstance.surfaceId()).toBe('test-surface');
    expect(host.componentInstance.componentKey()).toEqual({id: 'root', basePath: '/custom/path'});
  });

  it('should use default dataContextPath of "/"', () => {
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.detectChanges();

    const host = fixture.debugElement.query(By.directive(ComponentHostComponent));
    expect(host.componentInstance.componentKey()).toEqual({id: 'root', basePath: '/'});
  });

  it('should render the root node through the surface-owned NodeResolver', () => {
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.detectChanges();

    const host = fixture.debugElement.query(By.directive(ComponentHostComponent));
    const resolver = host.injector.get(SurfaceNodeResolver);
    expect(resolver).toBeTruthy();
    expect(resolver.resolverFor(surface)).toBe(resolver.resolverFor(surface));
    expect(fixture.nativeElement.textContent).toContain('Hello');
  });
});
