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

import {Component, ChangeDetectionStrategy} from '@angular/core';

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {SurfaceComponent} from './surface.component';
import {ComponentHostComponent} from './component-host.component';
import {By} from '@angular/platform-browser';
import {A2uiRendererService} from './a2ui-renderer.service';
import {provideA2Ui} from './provide-a2ui';
import {CatalogComponent} from './catalog_component';
import {AngularCatalog} from '../catalog/types';
import {ComponentModel, SurfaceModel, ComponentApi} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

@Component({
  selector: 'test-text',
  template: '<div>{{props()["text"]}}</div>',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestTextComponent extends CatalogComponent<ComponentApi> {}

describe('SurfaceComponent', () => {
  let component: SurfaceComponent;
  let fixture: ComponentFixture<SurfaceComponent>;
  let rendererService: A2uiRendererService;
  let catalog: AngularCatalog;

  beforeEach(async () => {
    catalog = new AngularCatalog('mock-catalog', [
      {
        name: 'Text',
        schema: z.object({text: z.string()}),
        component: TestTextComponent,
      },
    ]);

    await TestBed.configureTestingModule({
      imports: [SurfaceComponent],
      providers: [provideA2Ui({catalogs: [catalog]})],
    }).compileComponents();

    rendererService = TestBed.inject(A2uiRendererService);
    const surface = new SurfaceModel('test-surface', catalog);
    const rootComponent = new ComponentModel('root', 'Text', {text: 'Hello'});
    surface.componentsModel.addComponent(rootComponent);
    rendererService.surfaceGroup.addSurface(surface);

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
    expect(host.componentInstance.componentKey()).toEqual({
      id: 'root',
      basePath: '/custom/path',
    });
  });

  it('should use default dataContextPath of "/"', () => {
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.detectChanges();

    const host = fixture.debugElement.query(By.directive(ComponentHostComponent));
    expect(host.componentInstance.componentKey()).toEqual({id: 'root', basePath: '/'});
  });
});
