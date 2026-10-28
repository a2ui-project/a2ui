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

import {TestBed, ComponentFixture} from '@angular/core/testing';
import {By} from '@angular/platform-browser';
import {ComponentHostComponent} from './component-host.component';
import {A2uiRendererService} from './a2ui-renderer.service';
import {
  ComponentApi,
  ComponentIdSchema,
  ComponentModel,
  DynamicStringSchema,
  NodeResolver,
  SurfaceModel,
  getValue,
} from '@a2ui/web_core/v0_9';
import {A2uiText} from '@a2ui/web_core/v0_9/basic_catalog';
import {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import {Component, EnvironmentInjector, EventEmitter, Input, NgZone, Type} from '@angular/core';
import {CatalogComponentInstance} from './catalog_component_instance';
import {AngularCatalog, createComponentImplementation} from '../catalog/types';
import {UniversalOnlyComponent} from '../catalog/universal_only.component';
import {initializeAngularReactivity} from './reactivity';
import {ComponentBinder} from './component-binder.service';
import {SurfaceNodeResolver} from './surface-node-resolver.service';
import {z} from 'zod';

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
  selector: 'test-other-child',
  template: '<div>Other Child Component</div>',
})
class TestOtherChildComponent {
  @Input() props!: {text: {value: () => string}};
  @Input() surfaceId?: string;
  @Input() componentId?: string;
  @Input() dataContextPath?: string;
}

const TestTypeApi = {
  name: 'TestType',
  schema: z.object({text: DynamicStringSchema.optional(), other: DynamicStringSchema.optional()}),
} satisfies ComponentApi;
const OtherTypeApi = {name: 'OtherType', schema: z.object({text: DynamicStringSchema.optional()})};

/** Flushes root effects (the resolver updates node props in effects) and the fixture view. */
function flush(fixture: ComponentFixture<unknown>) {
  TestBed.tick();
  fixture.detectChanges();
}

/** Waits for `EventSource` listeners that are delivered asynchronously. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve));

describe('ComponentHostComponent', () => {
  let component: ComponentHostComponent;
  let fixture: ComponentFixture<ComponentHostComponent>;
  let mockRendererService: any;
  let mockRendererConfig: any;
  let catalog: AngularCatalog;
  let surface: SurfaceModel<any>;
  let mockSurfaceGroup: any;

  function addRoot(type: string, props: Record<string, unknown>) {
    surface.componentsModel.addComponent(new ComponentModel('root', type, props, catalog));
  }

  beforeEach(async () => {
    mockRendererConfig = {useUniversalComponents: false};
    mockRendererService = {
      surfaceGroup: undefined,
      get useUniversalComponents() {
        return mockRendererConfig.useUniversalComponents ?? false;
      },
    };

    TestBed.configureTestingModule({
      imports: [ComponentHostComponent],
      providers: [{provide: A2uiRendererService, useValue: mockRendererService}],
    });
    // Angular reactivity must be in place before any `NodeResolver` or `SurfaceModel`
    // signal is created, exactly as `provideA2Ui` guarantees in an application.
    initializeAngularReactivity(TestBed.inject(EnvironmentInjector));

    catalog = new AngularCatalog('test-catalog', '0.9', [
      createComponentImplementation(
        TestTypeApi,
        TestChildComponent as unknown as Type<CatalogComponentInstance>,
      ),
      createComponentImplementation(
        OtherTypeApi,
        TestOtherChildComponent as unknown as Type<CatalogComponentInstance>,
      ),
    ]);
    surface = new SurfaceModel('surf1', catalog);
    addRoot('TestType', {text: 'Hello'});

    mockSurfaceGroup = {
      getSurface: jasmine.createSpy('getSurface').and.returnValue(surface),
    };
    mockRendererService.surfaceGroup = mockSurfaceGroup;

    fixture = TestBed.createComponent(ComponentHostComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('componentKey', {id: 'root', basePath: '/'});
    fixture.componentRef.setInput('surfaceId', 'surf1');
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  describe('Component Initialization', () => {
    it('should resolve component type and bind props from the resolved node', () => {
      const bindNodeSpy = spyOn(TestBed.inject(ComponentBinder), 'bindNode').and.callThrough();
      const bindSpy = spyOn(TestBed.inject(ComponentBinder), 'bind').and.callThrough();
      fixture.detectChanges();

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      expect(childDebugElement).toBeTruthy();

      const childInstance = childDebugElement.componentInstance as TestChildComponent;
      expect(childInstance.props).toBeTruthy();
      expect(childInstance.props.text.value()).toBe('Hello');
      expect(childInstance.surfaceId).toBe('surf1');
      expect(childInstance.componentId).toBe('root');
      expect(childInstance.dataContextPath).toBe('/');

      expect(bindNodeSpy).toHaveBeenCalledTimes(1);
      expect(bindSpy).not.toHaveBeenCalled();
      expect(mockSurfaceGroup.getSurface).toHaveBeenCalledWith('surf1');
    });

    it('should update props when component model is updated', async () => {
      fixture.detectChanges();

      const childDebugElement = fixture.debugElement.query(By.directive(TestChildComponent));
      const childInstance = childDebugElement.componentInstance as TestChildComponent;
      expect(childInstance.props.text.value()).toBe('Hello');

      const rootModel = surface.componentsModel.get('root')!;
      rootModel.properties = {text: 'Hello', other: 'new value'};
      await settle();
      flush(fixture);

      expect(childInstance.props.other.value()).toBe('new value');
    });

    it('should update bound values when the data model changes', () => {
      surface.dataModel.set('/greeting', 'Hi');
      surface.componentsModel.get('root')!.properties = {text: {path: '/greeting'}};
      fixture.detectChanges();

      const childInstance = fixture.debugElement.query(By.directive(TestChildComponent))
        .componentInstance as TestChildComponent;
      expect(childInstance.props.text.value()).toBe('Hi');

      surface.dataModel.set('/greeting', 'Hello again');
      flush(fixture);
      expect(childInstance.props.text.value()).toBe('Hello again');
    });

    it('should write back through onUpdate for writable bindings', () => {
      surface.dataModel.set('/greeting', 'Hi');
      surface.componentsModel.get('root')!.properties = {text: {path: '/greeting'}};
      fixture.detectChanges();

      const childInstance = fixture.debugElement.query(By.directive(TestChildComponent))
        .componentInstance as TestChildComponent;
      childInstance.props.text.onUpdate('Typed');
      expect(surface.dataModel.get('/greeting')).toBe('Typed');
    });

    // MessageProcessor handles a type change by replacing the ComponentModel under the same id.
    function replaceRoot(type: string, props: Record<string, unknown>) {
      surface.componentsModel.removeComponent('root');
      addRoot(type, props);
    }

    it('should re-resolve the rendered component when its type changes in place', () => {
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeTruthy();

      replaceRoot('OtherType', {text: 'World'});
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeFalsy();
      const other = fixture.debugElement.query(By.directive(TestOtherChildComponent));
      expect(other).toBeTruthy();
      expect((other.componentInstance as TestOtherChildComponent).props.text.value()).toBe('World');
    });

    it('should bind the replacement node exactly once after a type change', async () => {
      fixture.detectChanges();

      const bindNodeSpy = spyOn(TestBed.inject(ComponentBinder), 'bindNode').and.callThrough();
      replaceRoot('OtherType', {text: 'World'});
      await new Promise<void>(resolve => setTimeout(resolve));
      fixture.detectChanges();

      expect(bindNodeSpy).toHaveBeenCalledTimes(1);
      expect(fixture.debugElement.query(By.directive(TestOtherChildComponent))).toBeTruthy();
    });

    it('should still re-resolve after a type change to a type missing from the catalog', () => {
      fixture.detectChanges();
      const consoleErrorSpy = spyOn(console, 'error');

      replaceRoot('UnknownType', {});
      fixture.detectChanges();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Component type "UnknownType" not found in catalog "test-catalog"',
      );
      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeFalsy();

      replaceRoot('OtherType', {text: 'World'});
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.directive(TestOtherChildComponent))).toBeTruthy();
    });

    it('should warn and return if surface not found', () => {
      const consoleWarnSpy = spyOn(console, 'warn');
      mockSurfaceGroup.getSurface.and.returnValue(null);

      fixture.detectChanges();

      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeFalsy();
      expect(consoleWarnSpy).toHaveBeenCalledWith('Surface surf1 not found. Waiting for it...');
    });

    it('should wait for surface creation and render component when surface arrives asynchronously', () => {
      const surfaceCreatedEmitter = new EventEmitter<SurfaceModel<ComponentApi>>();
      mockSurfaceGroup.onSurfaceCreated = surfaceCreatedEmitter;
      mockSurfaceGroup.getSurface.and.returnValue(null);

      fixture.detectChanges();
      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeFalsy();

      mockSurfaceGroup.getSurface.and.returnValue(surface);
      surfaceCreatedEmitter.emit(surface);
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeTruthy();
    });

    it('should handle synchronous surface creation and unsubscribe cleanly', () => {
      const mockSubscription = {unsubscribe: jasmine.createSpy('unsubscribe')};
      mockSurfaceGroup.onSurfaceCreated = {
        subscribe: jasmine
          .createSpy('subscribe')
          .and.callFake((callback: (s: SurfaceModel<any>) => void) => {
            callback(surface);
            return mockSubscription;
          }),
      };
      // First call returns null (not found), second call returns the surface (found)
      mockSurfaceGroup.getSurface.and.returnValues(null, surface);

      fixture.detectChanges();

      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeTruthy();
      expect(mockSubscription.unsubscribe).toHaveBeenCalledOnceWith();
    });

    it('should warn and wait when the component is not yet in the surface', () => {
      const consoleWarnSpy = spyOn(console, 'warn');
      surface.componentsModel.removeComponent('root');

      fixture.detectChanges();

      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeFalsy();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Component root not found in surface surf1. Waiting for it...',
      );

      addRoot('TestType', {text: 'Late'});
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeTruthy();
    });

    it('should error and return if component type not in catalog', () => {
      const consoleErrorSpy = spyOn(console, 'error');
      surface.componentsModel.removeComponent('root');
      addRoot('Missing', {});

      fixture.detectChanges();

      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeFalsy();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Component type "Missing" not found in catalog "test-catalog"',
      );
    });

    it('should trigger destroyRef on destroy', () => {
      fixture.detectChanges();
      fixture.destroy();
      expect(component).toBeTruthy();
    });

    it('should execute setup inside the Angular Zone when surface is created asynchronously', () => {
      const surfaceCreatedEmitter = new EventEmitter<SurfaceModel<ComponentApi>>();
      mockSurfaceGroup.onSurfaceCreated = surfaceCreatedEmitter;
      mockSurfaceGroup.getSurface.and.returnValue(null);

      fixture.detectChanges();

      mockSurfaceGroup.getSurface.and.returnValue(surface);
      const runSpy = spyOn(TestBed.inject(NgZone), 'run').and.callThrough();
      surfaceCreatedEmitter.emit(surface);

      expect(runSpy).toHaveBeenCalled();
    });

    it('should run property updates inside the Angular Zone when component model updates', async () => {
      fixture.detectChanges();

      const runSpy = spyOn(TestBed.inject(NgZone), 'run').and.callThrough();
      surface.componentsModel.get('root')!.properties = {text: 'Hello', other: 'new value'};
      await settle();

      expect(runSpy).toHaveBeenCalled();
    });
  });

  describe('Node resolution', () => {
    it('should render a child that arrives after the parent was mounted', async () => {
      @Component({
        selector: 'test-parent-with-child',
        imports: [ComponentHostComponent],
        template:
          '<a2ui-v09-component-host [componentKey]="props.child.value()" [surfaceId]="surfaceId!" />',
      })
      class TestParentComponent {
        @Input() props: any;
        @Input() surfaceId?: string;
        @Input() componentId?: string;
        @Input() dataContextPath?: string;
      }
      const lateCatalog = new AngularCatalog('late-catalog', '0.9', [
        createComponentImplementation(
          {name: 'Parent', schema: z.object({child: ComponentIdSchema})},
          TestParentComponent as unknown as Type<CatalogComponentInstance>,
        ),
        createComponentImplementation(
          TestTypeApi,
          TestChildComponent as unknown as Type<CatalogComponentInstance>,
        ),
      ]);
      const lateSurface = new SurfaceModel('late-surf', lateCatalog);
      lateSurface.componentsModel.addComponent(
        new ComponentModel('root', 'Parent', {child: 'leaf'}, lateCatalog),
      );
      mockSurfaceGroup.getSurface.and.returnValue(lateSurface);

      const testFixture = TestBed.createComponent(ComponentHostComponent);
      testFixture.componentRef.setInput('componentKey', 'root');
      testFixture.componentRef.setInput('surfaceId', 'late-surf');
      flush(testFixture);
      expect(testFixture.debugElement.query(By.directive(TestParentComponent))).toBeTruthy();
      expect(testFixture.debugElement.query(By.directive(TestChildComponent))).toBeFalsy();

      lateSurface.componentsModel.addComponent(
        new ComponentModel('leaf', 'TestType', {text: 'Late leaf'}, lateCatalog),
      );
      await settle();
      flush(testFixture);
      flush(testFixture);

      const leaf = testFixture.debugElement.query(By.directive(TestChildComponent));
      expect(leaf).toBeTruthy();
      expect((leaf.componentInstance as TestChildComponent).props.text.value()).toBe('Late leaf');
      testFixture.destroy();
    });

    it('should render a child reference that carries its node without searching the tree', () => {
      const childCatalog = new AngularCatalog('child-catalog', '0.9', [
        createComponentImplementation(
          {name: 'Parent', schema: z.object({child: ComponentIdSchema})},
          TestOtherChildComponent as unknown as Type<CatalogComponentInstance>,
        ),
        createComponentImplementation(
          TestTypeApi,
          TestChildComponent as unknown as Type<CatalogComponentInstance>,
        ),
      ]);
      const childSurface = new SurfaceModel('child-surf', childCatalog);
      childSurface.componentsModel.addComponent(
        new ComponentModel('root', 'Parent', {child: 'leaf'}, childCatalog),
      );
      childSurface.componentsModel.addComponent(
        new ComponentModel('leaf', 'TestType', {text: 'Leaf'}, childCatalog),
      );
      mockSurfaceGroup.getSurface.and.returnValue(childSurface);

      const resolver = new NodeResolver(childSurface);
      const rootNode = getValue(resolver.rootNode)!;
      const childRef = TestBed.inject(ComponentBinder).bindNode(rootNode)['child'].value() as any;
      expect(childRef.id).toBe('leaf');
      expect(childRef.node).toBeTruthy();

      const testFixture = TestBed.createComponent(ComponentHostComponent);
      testFixture.componentRef.setInput('componentKey', childRef);
      testFixture.componentRef.setInput('surfaceId', 'child-surf');
      testFixture.detectChanges();

      const leaf = testFixture.debugElement.query(By.directive(TestChildComponent));
      expect(leaf).toBeTruthy();
      expect((leaf.componentInstance as TestChildComponent).props.text.value()).toBe('Leaf');
      expect((leaf.componentInstance as TestChildComponent).componentId).toBe('leaf');
      testFixture.destroy();
      resolver.dispose();
    });

    it('should share the resolver provided by SurfaceNodeResolver', () => {
      const shared = new SurfaceNodeResolver();
      const resolverForSpy = spyOn(shared, 'resolverFor').and.callThrough();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [ComponentHostComponent],
        providers: [
          {provide: A2uiRendererService, useValue: mockRendererService},
          {provide: SurfaceNodeResolver, useValue: shared},
        ],
      });
      initializeAngularReactivity(TestBed.inject(EnvironmentInjector));

      const first = TestBed.createComponent(ComponentHostComponent);
      first.componentRef.setInput('componentKey', 'root');
      first.componentRef.setInput('surfaceId', 'surf1');
      first.detectChanges();
      const second = TestBed.createComponent(ComponentHostComponent);
      second.componentRef.setInput('componentKey', 'root');
      second.componentRef.setInput('surfaceId', 'surf1');
      second.detectChanges();

      expect(resolverForSpy).toHaveBeenCalledTimes(2);
      expect(shared.resolverFor(surface)).toBe(shared.resolverFor(surface));
      expect(first.debugElement.query(By.directive(TestChildComponent))).toBeTruthy();
      expect(second.debugElement.query(By.directive(TestChildComponent))).toBeTruthy();
      first.destroy();
      second.destroy();
      shared.ngOnDestroy();
    });
  });

  describe('Template rendering', () => {
    it('should render the resolved component', () => {
      fixture.detectChanges();
      expect(fixture.nativeElement.innerHTML).toContain('Child Component');
    });

    class MockWcElement extends HTMLElement {
      context: any;
      node: any;
    }
    const mockWcImpl: WebComponentImplementation = {
      name: 'WcType',
      schema: z.object({label: z.string().optional()}),
      tagName: 'mock-host-wc',
      element: MockWcElement,
    };

    function useCatalog(entries: unknown[]): AngularCatalog {
      const next = new AngularCatalog('test-catalog', '0.9', entries as any);
      surface = new SurfaceModel('surf1', next);
      mockSurfaceGroup.getSurface.and.returnValue(surface);
      return next;
    }

    it('should render and update universal Web Components when useUniversalComponents is true', () => {
      if (!customElements.get('mock-host-wc')) {
        customElements.define('mock-host-wc', MockWcElement);
      }
      const wcCatalog = useCatalog([mockWcImpl]);
      surface.componentsModel.addComponent(
        new ComponentModel('root', 'WcType', {label: 'Click me'}, wcCatalog),
      );
      mockRendererConfig.useUniversalComponents = true;

      const testFixture = TestBed.createComponent(ComponentHostComponent);
      testFixture.componentRef.setInput('componentKey', 'root');
      testFixture.componentRef.setInput('surfaceId', 'surf1');
      testFixture.detectChanges();

      const wcEl = testFixture.nativeElement.querySelector('mock-host-wc') as MockWcElement;
      expect(wcEl).toBeTruthy();
      expect(wcEl.node.componentId).toBe('root');
      expect(wcEl.context.componentModel.id).toBe('root');

      surface.componentsModel.get('root')!.properties = {label: 'Updated label'};
      flush(testFixture);
      expect(wcEl.node.componentId).toBe('root');
      testFixture.destroy();
    });

    it('should render the placeholder instead of the Web Component when useUniversalComponents is false', () => {
      const wcCatalog = useCatalog([mockWcImpl]);
      surface.componentsModel.addComponent(new ComponentModel('root', 'WcType', {}, wcCatalog));

      fixture.componentRef.setInput('componentKey', {id: 'root', basePath: '/'});
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('mock-host-wc')).toBeNull();
      expect(fixture.debugElement.query(By.directive(UniversalOnlyComponent))).toBeTruthy();
    });

    it('should render the wrapped Web Component when useUniversalComponents is true', () => {
      mockRendererConfig.useUniversalComponents = true;
      const testFixture = TestBed.createComponent(ComponentHostComponent);
      testFixture.componentRef.setInput('componentKey', 'root');
      testFixture.componentRef.setInput('surfaceId', 'surf1');
      testFixture.detectChanges();

      const wcEl = testFixture.nativeElement.querySelector('a2ui-ng-testtype');
      expect(wcEl).toBeTruthy();
      expect(customElements.get('a2ui-ng-testtype')).toBeDefined();
      testFixture.destroy();
    });

    it('should render the native Angular component when useUniversalComponents is false', () => {
      mockRendererConfig.useUniversalComponents = false;
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.directive(TestChildComponent))).toBeTruthy();
      expect(fixture.nativeElement.querySelector('a2ui-ng-testtype')).toBeFalsy();
    });

    it('should render native Web Component when useUniversalComponents is true for basic catalog components', () => {
      const basicImpl = createComponentImplementation(
        A2uiText,
        TestChildComponent as unknown as Type<CatalogComponentInstance>,
      );
      const textCatalog = useCatalog([basicImpl]);
      surface.componentsModel.addComponent(
        new ComponentModel('root', 'Text', {text: 'Hi'}, textCatalog),
      );
      mockRendererConfig.useUniversalComponents = true;
      const testFixture = TestBed.createComponent(ComponentHostComponent);
      testFixture.componentRef.setInput('componentKey', 'root');
      testFixture.componentRef.setInput('surfaceId', 'surf1');
      testFixture.detectChanges();

      expect(testFixture.nativeElement.querySelector(A2uiText.tagName)).toBeTruthy();
      expect(testFixture.nativeElement.querySelector('a2ui-ng-testtype')).toBeFalsy();
      testFixture.destroy();
    });
  });
});
