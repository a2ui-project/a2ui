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

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ComponentHostComponent } from './component-host.component';
import { A2uiRendererService } from './a2ui-renderer.service';
import {
  A2uiFallbackInfo,
  ComponentApi,
  ComponentModel,
  SurfaceComponentsModel,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {
  Component,
  EnvironmentInjector,
  EventEmitter,
  Input,
  NgZone,
  TemplateRef,
  forwardRef,
  viewChild,
} from '@angular/core';
import { initializeAngularReactivity } from './reactivity';
import {
  A2UI_FALLBACK_TEMPLATES,
  A2uiFallbackTemplateContext,
  A2uiFallbackTemplates,
} from './fallback-templates';

@Component({
  selector: 'test-child',
  template: '<div>Child Component</div>',
})
class TestChildComponent {
  @Input() props: any;
  @Input() surfaceId?: string;
  @Input() componentId?: string;
  @Input() dataContextPath?: string;
}

@Component({
  selector: 'test-parent',
  standalone: true,
  imports: [ComponentHostComponent],
  template: `
    <div class="test-parent">
      <a2ui-v09-component-host [componentKey]="'child1'" [surfaceId]="surfaceId!">
      </a2ui-v09-component-host>
    </div>
  `,
})
class TestParentComponent {
  @Input() props: any;
  @Input() surfaceId?: string;
  @Input() componentId?: string;
  @Input() dataContextPath?: string;
}

// Mimics a catalog component that embeds a second surface: it hosts a
// component-host bound to a DIFFERENT surfaceId, so the inner host's
// `skipSelf` injection resolves to the outer host across a surface boundary.
@Component({
  selector: 'test-nested-surface',
  standalone: true,
  imports: [ComponentHostComponent],
  template: `
    <a2ui-v09-component-host [componentKey]="'innerChild'" [surfaceId]="'surf2'">
    </a2ui-v09-component-host>
  `,
})
class TestNestedSurfaceComponent {
  @Input() props: any;
  @Input() surfaceId?: string;
  @Input() componentId?: string;
  @Input() dataContextPath?: string;
}

@Component({
  selector: 'test-fallback-wrapper',
  standalone: true,
  imports: [ComponentHostComponent],
  providers: [
    {
      provide: A2UI_FALLBACK_TEMPLATES,
      useExisting: forwardRef(() => TestFallbackWrapperComponent),
    },
  ],
  template: `
    <ng-template #loadingTpl let-info let-componentId="componentId">
      <div class="loading-marker">Loading {{ componentId }}</div>
      {{ capture(info) }}
    </ng-template>
    <ng-template #unknownTpl let-info let-componentType="componentType">
      <div class="unknown-marker">Unknown {{ componentType }}</div>
      {{ capture(info) }}
    </ng-template>
    <a2ui-v09-component-host [componentKey]="componentKey" [surfaceId]="surfaceId">
    </a2ui-v09-component-host>
  `,
})
class TestFallbackWrapperComponent implements A2uiFallbackTemplates {
  readonly loadingTemplate = viewChild<TemplateRef<A2uiFallbackTemplateContext>>('loadingTpl');
  readonly unknownComponentTemplate =
    viewChild<TemplateRef<A2uiFallbackTemplateContext>>('unknownTpl');

  componentKey: string | { id: string; basePath: string } = { id: 'comp1', basePath: '/' };
  surfaceId = 'surf1';

  readonly capturedInfos: A2uiFallbackInfo[] = [];

  capture(info: A2uiFallbackInfo): string {
    if (!this.capturedInfos.includes(info)) {
      this.capturedInfos.push(info);
    }
    return '';
  }
}

describe('ComponentHostComponent', () => {
  let component: ComponentHostComponent;
  let fixture: ComponentFixture<ComponentHostComponent>;
  let mockRendererService: any;
  let mockCatalog: any;
  let mockSurface: SurfaceModel<any>;
  let mockSurfaceGroup: any;

  beforeEach(async () => {
    mockCatalog = {
      id: 'test-catalog',
      components: new Map([['TestType', { component: TestChildComponent }]]),
    };

    const mockSurfaceComponentsModel = new SurfaceComponentsModel();
    mockSurfaceComponentsModel.addComponent(
      new ComponentModel('comp1', 'TestType', { text: 'Hello' }),
    );

    mockSurface = {
      id: 'surf1',
      componentsModel: mockSurfaceComponentsModel,
      catalog: mockCatalog,
      dispatchError: jasmine.createSpy('dispatchError').and.resolveTo(),
    } as unknown as SurfaceModel<any>;

    mockSurfaceGroup = {
      getSurface: jasmine.createSpy('getSurface').and.returnValue(mockSurface),
    };

    mockRendererService = {
      surfaceGroup: mockSurfaceGroup,
    };

    TestBed.configureTestingModule({
      imports: [ComponentHostComponent],
      providers: [{ provide: A2uiRendererService, useValue: mockRendererService }],
    });

    initializeAngularReactivity(TestBed.inject(EnvironmentInjector));

    fixture = TestBed.createComponent(ComponentHostComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('componentKey', { id: 'comp1', basePath: '/' });
    fixture.componentRef.setInput('surfaceId', 'surf1');
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  describe('Component Initialization', () => {
    it('should resolve component type and bind props', () => {
      fixture.detectChanges(); // Triggers change detection

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeTruthy();

      const childInstance = childDebugElement.componentInstance as TestChildComponent;
      expect(childInstance.props).toBeTruthy();
      expect(childInstance.props.text.value()).toBe('Hello');
      expect(childInstance.surfaceId).toBe('surf1');
      expect(childInstance.componentId).toBe('comp1');
      expect(childInstance.dataContextPath).toBe('/');

      expect(mockSurfaceGroup.getSurface).toHaveBeenCalledWith('surf1');
    });

    it('should use provided dataContextPath for ComponentContext', () => {
      fixture.componentRef.setInput('componentKey', { id: 'comp1', basePath: '/nested/path' });
      fixture.detectChanges();

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeTruthy();

      const childInstance = childDebugElement.componentInstance as TestChildComponent;
      expect(childInstance.dataContextPath).toBe('/nested/path');
    });

    it('should update props when component model is updated', () => {
      fixture.detectChanges(); // Trigger change detection

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      const childInstance = childDebugElement.componentInstance as TestChildComponent;

      expect(childInstance.props.text.value()).toBe('Hello');

      const compModel = mockSurface.componentsModel.get('comp1')!;
      // This properties assignment triggers the update.
      compModel.properties = { text: 'Hello', newProp: 'new value' };

      fixture.detectChanges(); // Propagate changes

      expect(childInstance.props.newProp.value()).toBe('new value');
    });

    it('should warn and return if surface not found', () => {
      const consoleWarnSpy = spyOn(console, 'warn');
      mockSurfaceGroup.getSurface.and.returnValue(null);

      fixture.detectChanges();

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeFalsy();
      expect(consoleWarnSpy).toHaveBeenCalledWith('Surface surf1 not found. Waiting for it...');
    });

    it('should wait for surface creation and render component when surface arrives asynchronously', () => {
      const surfaceCreatedEmitter = new EventEmitter<SurfaceModel<ComponentApi>>();
      mockSurfaceGroup.onSurfaceCreated = surfaceCreatedEmitter;
      mockSurfaceGroup.getSurface.and.returnValue(null);

      fixture.detectChanges();
      let childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeFalsy();

      mockSurfaceGroup.getSurface.and.returnValue(mockSurface);
      surfaceCreatedEmitter.emit(mockSurface);
      fixture.detectChanges();

      childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeTruthy();
    });

    it('should handle synchronous surface creation and unsubscribe cleanly', () => {
      const mockSubscription = { unsubscribe: jasmine.createSpy('unsubscribe') };
      mockSurfaceGroup.onSurfaceCreated = {
        subscribe: jasmine
          .createSpy('subscribe')
          .and.callFake((callback: (s: SurfaceModel<any>) => void) => {
            callback(mockSurface);
            return mockSubscription;
          }),
      };
      // First call returns null (not found), second recursive call returns mockSurface (found)
      mockSurfaceGroup.getSurface.and.returnValues(null, mockSurface);

      fixture.detectChanges();

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeTruthy();
      expect(mockSubscription.unsubscribe).toHaveBeenCalledOnceWith();
    });

    it('should warn and return if component model not found', () => {
      const consoleWarnSpy = spyOn(console, 'warn');
      mockSurface.componentsModel.dispose();

      fixture.detectChanges();

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeFalsy();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Component comp1 not found in surface surf1. Waiting for it...',
      );
    });

    it('should error and return if component type not in catalog', () => {
      const consoleErrorSpy = spyOn(console, 'error');
      mockCatalog.components.clear();

      fixture.detectChanges();

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeFalsy();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Component type "TestType" not found in catalog "test-catalog"',
      );
    });

    it('clears resolvedModelType on reset when re-entering a fallback state', () => {
      spyOn(console, 'warn');
      fixture.detectChanges();
      expect(component.resolvedModelType).toBe('TestType');

      // Re-point at a missing component: the host drops into loading and must
      // not keep advertising the previously resolved type as its parent hint.
      fixture.componentRef.setInput('componentKey', { id: 'ghost', basePath: '/' });
      fixture.detectChanges();

      expect(component.resolvedModelType).toBeUndefined();
    });

    it('should trigger destroyRef on destroy', () => {
      fixture.detectChanges(); // Trigger change detection

      // Destroy fixture
      fixture.destroy();

      // Implicitly verifies no crash on destroy
      expect(component).toBeTruthy();
    });

    it('should execute setupComponent inside the Angular Zone when surface is created asynchronously', () => {
      const surfaceCreatedEmitter = new EventEmitter<SurfaceModel<ComponentApi>>();
      mockSurfaceGroup.onSurfaceCreated = surfaceCreatedEmitter;
      mockSurfaceGroup.getSurface.and.returnValue(null);

      fixture.detectChanges();

      mockSurfaceGroup.getSurface.and.returnValue(mockSurface);

      const ngZone = TestBed.inject(NgZone);
      const runSpy = spyOn(ngZone, 'run').and.callThrough();

      surfaceCreatedEmitter.emit(mockSurface);

      expect(runSpy).toHaveBeenCalled();
    });

    it('should run property updates inside the Angular Zone when component model updates', () => {
      fixture.detectChanges();

      const ngZone = TestBed.inject(NgZone);
      const runSpy = spyOn(ngZone, 'run').and.callThrough();

      const compModel = mockSurface.componentsModel.get('comp1')!;
      compModel.properties = { text: 'Hello', newProp: 'new value' };

      expect(runSpy).toHaveBeenCalled();
    });
  });

  describe('Template rendering', () => {
    it('should render the resolved component', () => {
      fixture.detectChanges(); // Triggers change detection and render

      const compiled = fixture.nativeElement;
      expect(compiled.innerHTML).toContain('Child Component');
    });
    it('should pass dataContextPath to the rendered component', () => {
      fixture.componentRef.setInput('componentKey', { id: 'comp1', basePath: '/some/path' });
      fixture.detectChanges();

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeTruthy();
      const childInstance = childDebugElement.componentInstance as TestChildComponent;
      expect(childInstance.dataContextPath).toBe('/some/path');
    });
  });

  describe('Fallback dispatch', () => {
    let dispatchErrorSpy: jasmine.Spy;

    beforeEach(() => {
      dispatchErrorSpy = (mockSurface as any).dispatchError;
    });

    it('renders nothing by default while pending', () => {
      const consoleWarnSpy = spyOn(console, 'warn');
      mockSurface.componentsModel.dispose();

      fixture.detectChanges();

      expect(fixture.nativeElement.children.length).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Component comp1 not found in surface surf1. Waiting for it...',
      );
    });

    it('dispatches COMPONENT_NOT_FOUND once per warned type', async () => {
      spyOn(console, 'error');
      mockCatalog.components.clear();

      fixture.detectChanges();
      await Promise.resolve();

      expect(dispatchErrorSpy).toHaveBeenCalledTimes(1);
      // Exact payload equality also proves no surfaceId key is passed —
      // SurfaceModel.dispatchError appends it itself.
      expect(dispatchErrorSpy).toHaveBeenCalledWith({
        code: 'COMPONENT_NOT_FOUND',
        message: 'Component implementation not found for type: TestType',
        componentId: 'comp1',
        componentType: 'TestType',
      });

      // Re-setup with the same type via a new key object identity: the
      // per-instance dedup must keep the count at 1.
      fixture.componentRef.setInput('componentKey', { id: 'comp1', basePath: '/' });
      fixture.detectChanges();
      await Promise.resolve();

      expect(dispatchErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('dispatches again for a second distinct unknown type on the same mount', async () => {
      spyOn(console, 'error');
      mockCatalog.components.clear();

      fixture.detectChanges();
      await Promise.resolve();
      expect(dispatchErrorSpy).toHaveBeenCalledTimes(1);

      mockSurface.componentsModel.removeComponent('comp1');
      mockSurface.componentsModel.addComponent(new ComponentModel('comp1', 'TestType2', {}));
      fixture.componentRef.setInput('componentKey', { id: 'comp1', basePath: '/' });
      fixture.detectChanges();
      await Promise.resolve();

      expect(dispatchErrorSpy).toHaveBeenCalledTimes(2);
      expect(dispatchErrorSpy.calls.mostRecent().args[0].componentType).toBe('TestType2');
    });

    it('a type flap dispatches once per distinct unknown type', async () => {
      spyOn(console, 'error');
      mockCatalog.components.clear();

      fixture.detectChanges();
      await Promise.resolve();

      const replaceComp = async (type: string) => {
        mockSurface.componentsModel.removeComponent('comp1');
        mockSurface.componentsModel.addComponent(new ComponentModel('comp1', type, {}));
        fixture.componentRef.setInput('componentKey', { id: 'comp1', basePath: '/' });
        fixture.detectChanges();
        await Promise.resolve();
      };

      // TestType -> TestType2 -> TestType: returning to an already-dispatched
      // type must not re-dispatch.
      await replaceComp('TestType2');
      await replaceComp('TestType');

      expect(dispatchErrorSpy).toHaveBeenCalledTimes(2);
      const dispatchedTypes = dispatchErrorSpy.calls
        .allArgs()
        .map(([payload]) => payload.componentType);
      expect(dispatchedTypes).toEqual(['TestType', 'TestType2']);
    });
  });

  describe('Fallback templates', () => {
    let wrapperFixture: ComponentFixture<TestFallbackWrapperComponent>;
    let wrapper: TestFallbackWrapperComponent;

    const createWrapper = (key: string | { id: string; basePath: string }) => {
      wrapperFixture = TestBed.createComponent(TestFallbackWrapperComponent);
      wrapper = wrapperFixture.componentInstance;
      wrapper.componentKey = key;
      wrapperFixture.detectChanges();
      // A second pass lets the viewChild template queries settle into the
      // host's computed before asserting.
      wrapperFixture.detectChanges();
    };

    it('renders consumer fallback for pending (root)', () => {
      const consoleWarnSpy = spyOn(console, 'warn');
      createWrapper('compX');

      const marker = wrapperFixture.debugElement.query(By.css('.loading-marker'));
      expect(marker).toBeTruthy();
      expect(marker.nativeElement.textContent).toContain('compX');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Component compX not found in surface surf1. Waiting for it...',
      );
    });

    it('renders consumer unknownComponent fallback with componentType context', () => {
      spyOn(console, 'error');
      mockCatalog.components.clear();
      createWrapper({ id: 'comp1', basePath: '/' });

      const marker = wrapperFixture.debugElement.query(By.css('.unknown-marker'));
      expect(marker).toBeTruthy();
      expect(marker.nativeElement.textContent).toContain('TestType');
    });

    it('renders consumer fallback for a nested child via the injection token', () => {
      spyOn(console, 'warn');
      mockCatalog.components.set('TestParent', { component: TestParentComponent });
      mockSurface.componentsModel.addComponent(new ComponentModel('parent1', 'TestParent', {}));
      createWrapper('parent1');

      // The loading marker renders INSIDE the parent's DOM — the templates
      // crossed ngComponentOutlet into the nested host via the token.
      const nestedMarker = wrapperFixture.debugElement.query(
        By.css('.test-parent .loading-marker'),
      );
      expect(nestedMarker).toBeTruthy();
      expect(nestedMarker.nativeElement.textContent).toContain('child1');
    });

    it('clears the fallback when the component arrives', () => {
      spyOn(console, 'warn');
      createWrapper('comp2');

      expect(wrapperFixture.debugElement.query(By.css('.loading-marker'))).toBeTruthy();

      mockSurface.componentsModel.addComponent(
        new ComponentModel('comp2', 'TestType', { text: 'Loaded Data' }),
      );
      wrapperFixture.detectChanges();

      expect(wrapperFixture.debugElement.query(By.css('.loading-marker'))).toBeFalsy();
      expect(wrapperFixture.debugElement.query(By.directive(TestChildComponent))).toBeTruthy();
    });

    it('runs component initialization inside the Angular Zone when the component arrives', () => {
      spyOn(console, 'warn');
      createWrapper('comp2');

      // In this arrival flow the onCreated handler's ngZone.run is the only
      // run() call (detectChanges does not call it and onUpdated does not fire),
      // so the spy discriminates the zone-wrapped path from the un-zoned one.
      const ngZone = TestBed.inject(NgZone);
      const runSpy = spyOn(ngZone, 'run').and.callThrough();

      mockSurface.componentsModel.addComponent(
        new ComponentModel('comp2', 'TestType', { text: 'Loaded' }),
      );
      wrapperFixture.detectChanges();

      expect(runSpy).toHaveBeenCalled();
    });

    it('passes parentComponentType to nested loading fallbacks', () => {
      spyOn(console, 'warn');
      mockCatalog.components.set('TestParent', { component: TestParentComponent });
      mockSurface.componentsModel.addComponent(new ComponentModel('parent1', 'TestParent', {}));
      createWrapper('parent1');

      const info = wrapper.capturedInfos.find((i) => i.state === 'loading');
      expect(info).toBeDefined();
      expect(info!.parentComponentType).toBe('TestParent');
    });

    it('omits parentComponentType at the root', () => {
      spyOn(console, 'warn');
      createWrapper('compX');

      const info = wrapper.capturedInfos.find((i) => i.state === 'loading');
      expect(info).toBeDefined();
      // The key must be ABSENT at the root, not present with an undefined value.
      expect('parentComponentType' in info!).toBe(false);
    });

    it('does not inherit the outer surface type at a nested surface root', () => {
      spyOn(console, 'warn');
      mockCatalog.components.set('TestNestedSurface', { component: TestNestedSurfaceComponent });
      mockSurface.componentsModel.addComponent(
        new ComponentModel('parent1', 'TestNestedSurface', {}),
      );

      // A second surface whose root component ('innerChild') has not streamed
      // in yet, so the inner host settles into the loading fallback.
      const surf2ComponentsModel = new SurfaceComponentsModel();
      const surf2 = {
        id: 'surf2',
        componentsModel: surf2ComponentsModel,
        catalog: mockCatalog,
        dispatchError: jasmine.createSpy('dispatchError').and.resolveTo(),
      } as unknown as SurfaceModel<any>;
      mockSurfaceGroup.getSurface.and.callFake((sid: string) =>
        sid === 'surf2' ? surf2 : mockSurface,
      );

      createWrapper('parent1');

      // The inner host's parent (via skipSelf) is the outer host, which
      // resolved 'TestNestedSurface' on surf1. Because the inner host lives on
      // surf2, that type must NOT leak in as its parentComponentType.
      const innerInfo = wrapper.capturedInfos.find(
        (i) => i.state === 'loading' && i.componentId === 'innerChild',
      );
      expect(innerInfo).toBeDefined();
      expect('parentComponentType' in innerInfo!).toBe(false);
    });

    it('passes parentComponentType to nested unknownComponent fallbacks', () => {
      spyOn(console, 'warn');
      spyOn(console, 'error');
      mockCatalog.components.set('TestParent', { component: TestParentComponent });
      mockSurface.componentsModel.addComponent(new ComponentModel('parent1', 'TestParent', {}));
      mockSurface.componentsModel.addComponent(new ComponentModel('child1', 'Nope', {}));
      createWrapper('parent1');

      const info = wrapper.capturedInfos.find((i) => i.state === 'unknownComponent');
      expect(info).toBeDefined();
      expect(info!.parentComponentType).toBe('TestParent');
      const nestedMarker = wrapperFixture.debugElement.query(
        By.css('.test-parent .unknown-marker'),
      );
      expect(nestedMarker).toBeTruthy();
      expect(nestedMarker.nativeElement.textContent).toContain('Nope');
    });
  });
});
