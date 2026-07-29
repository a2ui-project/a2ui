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

import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SurfaceComponent } from './surface.component';
import { ComponentHostComponent } from './component-host.component';
import { By } from '@angular/platform-browser';
import { A2uiRendererService } from './a2ui-renderer.service';
import { ComponentBinder } from './component-binder.service';
import { ComponentModel } from '@a2ui/web_core/v0_9';

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

@Component({
  selector: 'test-surface-host',
  standalone: true,
  imports: [SurfaceComponent],
  template: `
    <a2ui-v09-surface
      [surfaceId]="'test-surface'"
      [loadingTemplate]="loadingTpl"
      [unknownComponentTemplate]="unknownTpl"
    ></a2ui-v09-surface>
    <ng-template #loadingTpl let-componentId="componentId">
      <div class="loading-marker">Loading {{ componentId }}</div>
    </ng-template>
    <ng-template #unknownTpl let-componentType="componentType">
      <div class="unknown-marker">Unknown {{ componentType }}</div>
    </ng-template>
  `,
})
class TestSurfaceHostComponent {}

describe('SurfaceComponent', () => {
  let component: SurfaceComponent;
  let fixture: ComponentFixture<SurfaceComponent>;
  let mockRendererService: any;
  let mockBinder: any;

  beforeEach(async () => {
    mockRendererService = {
      surfaceGroup: {
        getSurface: jasmine.createSpy('getSurface').and.returnValue({
          componentsModel: new Map([
            ['root', new ComponentModel('root', 'Text', { text: { value: 'Hello' } })],
          ]),
          catalog: {
            id: 'mock-catalog',
            components: new Map([['Text', { type: 'Text', component: TestTextComponent }]]),
          },
        }),
      },
    };
    mockBinder = jasmine.createSpyObj('ComponentBinder', ['bind']);

    await TestBed.configureTestingModule({
      imports: [SurfaceComponent],
      providers: [
        { provide: A2uiRendererService, useValue: mockRendererService },
        { provide: ComponentBinder, useValue: mockBinder },
      ],
    }).compileComponents();

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
    expect(host.componentInstance.componentKey()).toEqual({ id: 'root', basePath: '/custom/path' });
  });

  it('should use default dataContextPath of "/"', () => {
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.detectChanges();

    const host = fixture.debugElement.query(By.directive(ComponentHostComponent));
    expect(host.componentInstance.componentKey()).toEqual({ id: 'root', basePath: '/' });
  });

  it('forwards fallback templates to the component host', () => {
    spyOn(console, 'warn');
    // The shared fixture has no surfaceId input; destroy it so a scheduled
    // tick cannot refresh it and trip NG0950.
    fixture.destroy();
    // The root component is missing: componentsModel.get returns undefined and
    // onCreated.subscribe hands back a stub subscription.
    mockRendererService.surfaceGroup.getSurface.and.returnValue({
      componentsModel: {
        get: () => undefined,
        onCreated: { subscribe: () => ({ unsubscribe: () => {} }) },
      },
      catalog: { id: 'mock-catalog', components: new Map() },
    });

    const hostFixture = TestBed.createComponent(TestSurfaceHostComponent);
    hostFixture.detectChanges();
    // A second pass lets the viewChild-independent template refs settle.
    hostFixture.detectChanges();

    const marker = hostFixture.debugElement.query(By.css('.loading-marker'));
    expect(marker).toBeTruthy();
    expect(marker.nativeElement.textContent).toContain('root');
  });
});
