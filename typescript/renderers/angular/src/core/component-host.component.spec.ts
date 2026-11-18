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
  A2uiMetadata,
  ComponentApi,
  ComponentContext,
  ComponentModel,
  NodeResolver,
  SurfaceModel,
  getValue,
} from '@a2ui/web_core';
import {A2UI_ELEMENT_CONNECTED_EVENT, WebComponentImplementation} from '@a2ui/web_core/universal';
import {ComponentIdSchema, DynamicStringSchema} from '@a2ui/web_core/v0_9';
import {A2uiColumn, A2uiText} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  Component,
  EnvironmentInjector,
  EventEmitter,
  InjectionToken,
  Injector,
  Input,
  NgZone,
  Type,
  computed,
  inject,
  input,
} from '@angular/core';
import {CatalogComponent} from './catalog_component';
import {CatalogComponentInstance} from './catalog_component_instance';
import {A2UI_RENDERER_CONFIG} from './a2ui-renderer.service';
import {SurfaceComponent} from './surface.component';
import {
  AngularCatalog,
  type AngularComponentImplementation,
  createComponentImplementation,
} from '../catalog/types';
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
  readonly metadata = input<A2uiMetadata | undefined>(undefined);
  readonly extensions = computed(() => this.metadata()?.extensions);
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
const OtherTypeApi = {
  name: 'OtherType',
  schema: z.object({text: DynamicStringSchema.optional()}),
};

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

    it('should bind and update metadata and extensions when component metadata changes', () => {
      const rootModel = surface.componentsModel.get('root')!;
      rootModel.metadata = {extensions: {badge: 'initial'}};
      fixture.detectChanges();

      const childInstance = fixture.debugElement.query(By.directive(TestChildComponent))
        .componentInstance as TestChildComponent;
      expect(childInstance.metadata()).toEqual({extensions: {badge: 'initial'}});
      expect(childInstance.extensions()).toEqual({badge: 'initial'});

      rootModel.setExtension('badge', 'updated');
      flush(fixture);
      expect(childInstance.metadata()).toEqual({extensions: {badge: 'updated'}});
      expect(childInstance.extensions()).toEqual({badge: 'updated'});

      rootModel.removeExtension('badge');
      flush(fixture);
      expect(childInstance.metadata()).toBeUndefined();
      expect(childInstance.extensions()).toBeUndefined();
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
      expect(wcEl.context).toBeUndefined();

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

    it('should render native Web Component when useUniversalComponents is true for basic catalog components', async () => {
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
      await settle();

      expect(testFixture.nativeElement.querySelector(A2uiText.tagName)).toBeTruthy();
      expect(testFixture.nativeElement.querySelector('a2ui-ng-testtype')).toBeFalsy();
      testFixture.destroy();
    });

    it('renders plain object-literal Angular components inside universal containers and isolates multi-instance injectors', async () => {
      const BUBBLE_LABEL = new InjectionToken<string>('BUBBLE_LABEL');

      @Component({
        selector: 'test-plain-custom-leaf',
        template: '<span class="plain-leaf">{{ bubbleLabel }}:{{ props()?.text?.value() }}</span>',
      })
      class PlainCustomLeafComponent extends CatalogComponent<typeof TestTypeApi> {
        readonly bubbleLabel = inject(BUBBLE_LABEL);
      }

      const compositeCatalog = new AngularCatalog('composite-catalog', '0.9', [
        A2uiColumn,
        {
          ...TestTypeApi,
          component: PlainCustomLeafComponent,
        },
      ]);

      @Component({
        selector: 'test-bubble-host-a',
        imports: [SurfaceComponent],
        providers: [
          {provide: BUBBLE_LABEL, useValue: 'bubble-1'},
          {
            provide: A2UI_RENDERER_CONFIG,
            useValue: {catalogs: [compositeCatalog], useUniversalComponents: true},
          },
          A2uiRendererService,
        ],
        template: '<a2ui-v09-surface surfaceId="s1" />',
      })
      class TestBubbleHostAComponent {
        readonly renderer = inject(A2uiRendererService);
      }

      @Component({
        selector: 'test-bubble-host-b',
        imports: [SurfaceComponent],
        providers: [
          {provide: BUBBLE_LABEL, useValue: 'bubble-2'},
          {
            provide: A2UI_RENDERER_CONFIG,
            useValue: {catalogs: [compositeCatalog], useUniversalComponents: true},
          },
          A2uiRendererService,
        ],
        template: '<a2ui-v09-surface surfaceId="s2" />',
      })
      class TestBubbleHostBComponent {
        readonly renderer = inject(A2uiRendererService);
      }

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [TestBubbleHostAComponent, TestBubbleHostBComponent],
      });

      const fixtureA = TestBed.createComponent(TestBubbleHostAComponent);
      const fixtureB = TestBed.createComponent(TestBubbleHostBComponent);
      document.body.appendChild(fixtureA.nativeElement);
      document.body.appendChild(fixtureB.nativeElement);

      fixtureA.componentInstance.renderer.processMessages([
        {version: 'v0.9', createSurface: {surfaceId: 's1', catalogId: 'composite-catalog'}},
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [
              {id: 'root', component: 'Column', children: ['leaf-1']},
              {id: 'leaf-1', component: 'TestType', text: 'First'},
            ],
          },
        },
      ]);
      fixtureB.componentInstance.renderer.processMessages([
        {version: 'v0.9', createSurface: {surfaceId: 's2', catalogId: 'composite-catalog'}},
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's2',
            components: [
              {id: 'root', component: 'Column', children: ['leaf-2']},
              {id: 'leaf-2', component: 'TestType', text: 'Second'},
            ],
          },
        },
      ]);

      flush(fixtureA);
      flush(fixtureB);
      await settle();
      flush(fixtureA);
      flush(fixtureB);

      expect(fixtureA.nativeElement.querySelector('.plain-leaf')?.textContent).toBe(
        'bubble-1:First',
      );
      expect(fixtureB.nativeElement.querySelector('.plain-leaf')?.textContent).toBe(
        'bubble-2:Second',
      );

      // Destroy the second bubble and dynamically append another child to the first bubble.
      fixtureB.destroy();
      fixtureA.componentInstance.renderer.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [
              {id: 'root', component: 'Column', children: ['leaf-1', 'leaf-3']},
              {id: 'leaf-3', component: 'TestType', text: 'AfterDestroy'},
            ],
          },
        },
      ]);
      await settle();
      flush(fixtureA);
      await settle();
      flush(fixtureA);

      const leaves = Array.from<HTMLElement>(
        fixtureA.nativeElement.querySelectorAll('.plain-leaf'),
      ).map(el => el.textContent);
      expect(leaves).toEqual(['bubble-1:First', 'bubble-1:AfterDestroy']);
      fixtureA.destroy();
      fixtureA.nativeElement.remove();
      fixtureB.nativeElement.remove();
    });

    it('calls onElementConnected once for root and nested universal elements', async () => {
      const LOG_LABEL = new InjectionToken<string>('LOG_LABEL');
      const connected: string[] = [];
      const onElementConnected = (
        element: HTMLElement,
        context: ComponentContext,
        injector: Injector,
      ) => {
        connected.push(
          `${element.localName}:${context.componentModel.id}:${injector.get(LOG_LABEL)}`,
        );
      };
      const column: WebComponentImplementation &
        Pick<AngularComponentImplementation, 'onElementConnected'> = {
        ...A2uiColumn,
        onElementConnected,
      };
      const text: WebComponentImplementation &
        Pick<AngularComponentImplementation, 'onElementConnected'> = {
        ...A2uiText,
        onElementConnected,
      };
      const hookCatalog = new AngularCatalog('hook-catalog', '0.9', [column, text]);

      @Component({
        selector: 'test-hook-host',
        imports: [SurfaceComponent],
        providers: [
          {provide: LOG_LABEL, useValue: 'host'},
          {
            provide: A2UI_RENDERER_CONFIG,
            useValue: {catalogs: [hookCatalog], useUniversalComponents: true},
          },
          A2uiRendererService,
        ],
        template: '<a2ui-v09-surface surfaceId="hook" />',
      })
      class TestHookHostComponent {
        readonly renderer = inject(A2uiRendererService);
      }

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({imports: [TestHookHostComponent]});
      const hookFixture = TestBed.createComponent(TestHookHostComponent);
      document.body.appendChild(hookFixture.nativeElement);

      hookFixture.componentInstance.renderer.processMessages([
        {version: 'v0.9', createSurface: {surfaceId: 'hook', catalogId: 'hook-catalog'}},
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'hook',
            components: [
              {id: 'root', component: 'Column', children: ['title']},
              {id: 'title', component: 'Text', text: 'Hi'},
            ],
          },
        },
      ]);
      flush(hookFixture);
      await settle();
      flush(hookFixture);

      expect(connected).toEqual([
        `${A2uiColumn.tagName}:root:host`,
        `${A2uiText.tagName}:title:host`,
      ]);
      hookFixture.destroy();
      hookFixture.nativeElement.remove();
    });

    it('calls onElementConnected once when the element sits below nested component hosts', async () => {
      @Component({
        selector: 'test-hook-wrapper',
        imports: [ComponentHostComponent],
        template:
          '<a2ui-v09-component-host [componentKey]="props.child.value()" [surfaceId]="surfaceId!" />',
      })
      class TestHookWrapperComponent {
        @Input() props: any;
        @Input() surfaceId?: string;
        @Input() componentId?: string;
        @Input() dataContextPath?: string;
      }
      const onElementConnected = jasmine.createSpy('onElementConnected');
      const text: WebComponentImplementation &
        Pick<AngularComponentImplementation, 'onElementConnected'> = {
        ...A2uiText,
        onElementConnected,
      };
      const nestedCatalog = new AngularCatalog('nested-hook-catalog', '0.9', [
        createComponentImplementation(
          {name: 'Wrapper', schema: z.object({child: ComponentIdSchema})},
          TestHookWrapperComponent as unknown as Type<CatalogComponentInstance>,
        ),
        text,
      ]);

      @Component({
        selector: 'test-nested-hook-host',
        imports: [SurfaceComponent],
        providers: [
          {
            provide: A2UI_RENDERER_CONFIG,
            useValue: {catalogs: [nestedCatalog], useUniversalComponents: true},
          },
          A2uiRendererService,
        ],
        template: '<a2ui-v09-surface surfaceId="nested-hook" />',
      })
      class TestNestedHookHostComponent {
        readonly renderer = inject(A2uiRendererService);
      }

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({imports: [TestNestedHookHostComponent]});
      const nestedFixture = TestBed.createComponent(TestNestedHookHostComponent);
      document.body.appendChild(nestedFixture.nativeElement);

      nestedFixture.componentInstance.renderer.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 'nested-hook', catalogId: 'nested-hook-catalog'},
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'nested-hook',
            components: [
              {id: 'root', component: 'Wrapper', child: 'title'},
              {id: 'title', component: 'Text', text: 'Hi'},
            ],
          },
        },
      ]);
      flush(nestedFixture);
      await settle();
      flush(nestedFixture);

      const textElement: HTMLElement = nestedFixture.nativeElement.querySelector(A2uiText.tagName);
      const innerHost = textElement.closest('a2ui-v09-component-host');
      expect(innerHost?.parentElement?.closest('a2ui-v09-component-host')).toBeTruthy();
      expect(onElementConnected).toHaveBeenCalledOnceWith(
        textElement,
        jasmine.objectContaining({componentModel: jasmine.objectContaining({id: 'title'})}),
        jasmine.anything(),
      );
      nestedFixture.destroy();
      nestedFixture.nativeElement.remove();
    });

    it('calls onElementConnected once for plain HTMLElement universal elements', async () => {
      class PlainElement extends HTMLElement {}
      const onElementConnected = jasmine.createSpy('onElementConnected');
      const plain: WebComponentImplementation &
        Pick<AngularComponentImplementation, 'onElementConnected'> = {
        name: 'Plain',
        schema: z.object({}),
        tagName: 'test-hook-plain-element',
        element: PlainElement,
        onElementConnected,
      };
      const plainCatalog = new AngularCatalog('plain-hook-catalog', '0.9', [A2uiColumn, plain]);

      @Component({
        selector: 'test-plain-hook-host',
        imports: [SurfaceComponent],
        providers: [
          {
            provide: A2UI_RENDERER_CONFIG,
            useValue: {catalogs: [plainCatalog], useUniversalComponents: true},
          },
          A2uiRendererService,
        ],
        template:
          '<a2ui-v09-surface surfaceId="plain-root" /><a2ui-v09-surface surfaceId="plain-child" />',
      })
      class TestPlainHookHostComponent {
        readonly renderer = inject(A2uiRendererService);
      }

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({imports: [TestPlainHookHostComponent]});
      const plainFixture = TestBed.createComponent(TestPlainHookHostComponent);
      document.body.appendChild(plainFixture.nativeElement);

      plainFixture.componentInstance.renderer.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 'plain-root', catalogId: 'plain-hook-catalog'},
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'plain-root',
            components: [{id: 'root', component: 'Plain'}],
          },
        },
        {
          version: 'v0.9',
          createSurface: {surfaceId: 'plain-child', catalogId: 'plain-hook-catalog'},
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'plain-child',
            components: [
              {id: 'root', component: 'Column', children: ['leaf']},
              {id: 'leaf', component: 'Plain'},
            ],
          },
        },
      ]);
      flush(plainFixture);
      await settle();
      flush(plainFixture);
      await settle();

      const [rootElement, childElement] = Array.from(
        plainFixture.nativeElement.querySelectorAll('test-hook-plain-element'),
      ) as HTMLElement[];
      expect(rootElement.parentElement?.localName).toBe('a2ui-v09-component-host');
      expect(childElement.closest(A2uiColumn.tagName)).toBeTruthy();
      expect(onElementConnected.calls.allArgs()).toEqual([
        [
          rootElement,
          jasmine.objectContaining({componentModel: jasmine.objectContaining({id: 'root'})}),
          jasmine.anything(),
        ],
        [
          childElement,
          jasmine.objectContaining({componentModel: jasmine.objectContaining({id: 'leaf'})}),
          jasmine.anything(),
        ],
      ]);
      plainFixture.destroy();
      plainFixture.nativeElement.remove();
    });

    it('passes the dispatching element to onElementConnected when the event crosses a shadow root', () => {
      const onElementConnected = jasmine.createSpy('onElementConnected');
      const hookedCatalog = new AngularCatalog('shadow-hook-catalog', '0.9', [
        {
          ...createComponentImplementation(
            TestTypeApi,
            TestChildComponent as unknown as Type<CatalogComponentInstance>,
          ),
          onElementConnected,
        },
      ]);
      const context = {
        componentModel: new ComponentModel('inner', 'TestType', {}, hookedCatalog),
      } as unknown as ComponentContext;
      const shadowHost = document.createElement('div');
      const inner = Object.assign(document.createElement('span'), {context});
      shadowHost.attachShadow({mode: 'open'}).appendChild(inner);
      fixture.nativeElement.appendChild(shadowHost);

      inner.dispatchEvent(
        new CustomEvent(A2UI_ELEMENT_CONNECTED_EVENT, {bubbles: true, composed: true}),
      );

      expect(onElementConnected).toHaveBeenCalledOnceWith(inner, context, jasmine.anything());
    });
  });
});
