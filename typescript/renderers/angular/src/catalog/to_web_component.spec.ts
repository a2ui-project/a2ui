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

import {Component, InjectionToken, Injector, inject} from '@angular/core';

import {TestBed} from '@angular/core/testing';
import * as z from 'zod/v4';
import {
  Catalog,
  ComponentApi,
  ComponentContext,
  ComponentModel,
  NodeResolver,
  SurfaceGroupModel,
  SurfaceModel,
  getValue,
} from '@a2ui/web_core';
import {
  isWebComponentImplementation,
  registerUniversalElement,
  WebComponentImplementation,
} from '@a2ui/web_core/universal';
import {DynamicStringSchema} from '@a2ui/web_core/v0_9';
import {toWebComponent} from './to_web_component';
import {
  AngularWcHost,
  clearDefaultUniversalInjector,
  registerSurfaceGroupInjector,
  registerUniversalHostInjector,
  setDefaultUniversalInjector,
} from './angular_wc_host';
import {ComponentBinder} from '../core/component-binder.service';
import {CatalogComponent} from '../core/catalog_component';
import {
  AngularCatalog,
  AngularComponentImplementation,
  createComponentImplementation,
} from './types';

// Typed api for the test components that read `props().text`, so that the
// template type checker sees a concrete property rather than an index signature.
type TextTestApi = ComponentApi<z.ZodObject<{text: z.ZodString}>>;

// `createComponentImplementation` returns an `AngularComponentImplementation`;
// these tests exercise the Custom Element it also carries, so narrow once here.
function createUniversalImplementation(
  ...args: Parameters<typeof createComponentImplementation>
): AngularComponentImplementation & WebComponentImplementation {
  const impl = createComponentImplementation(...args);
  if (!isWebComponentImplementation(impl)) {
    throw new Error('expected a Web Component implementation');
  }
  return impl;
}

@Component({
  selector: 'test-simple-wc',
  template: '<span class="test-text">{{ props()?.text }}</span>',
  standalone: true,
})
class TestSimpleWcComponent extends CatalogComponent<TextTestApi> {}

@Component({
  selector: 'test-cached-wc',
  template: '<span>Cached</span>',
  standalone: true,
})
class TestCachedWcComponent extends CatalogComponent<ComponentApi> {}

@Component({
  selector: 'test-display-wc',
  template: '<div>Display</div>',
  standalone: true,
})
class TestDisplayContentsComponent extends CatalogComponent<ComponentApi> {}

@Component({
  selector: 'test-bind-ctx-wc',
  template: '<span class="test-text">{{ props()?.text?.value() }}</span>',
  standalone: true,
})
class TestBindContextComponent extends CatalogComponent<TextTestApi> {}

@Component({
  selector: 'test-reactive-wc',
  template: '<span class="test-text">{{ props()?.text?.value() }}</span>',
  standalone: true,
})
class TestReactiveUpdateComponent extends CatalogComponent<TextTestApi> {}

@Component({
  selector: 'test-no-inputs-wc',
  template: '<div class="static-content">Static</div>',
  standalone: true,
})
class TestNoInputsComponent extends CatalogComponent<ComponentApi> {}

@Component({
  selector: 'test-lifecycle-wc',
  template: '<span class="test-text">{{ props()?.text?.value() }}</span>',
  standalone: true,
})
class TestLifecycleComponent extends CatalogComponent<TextTestApi> {}

describe('toWebComponent', () => {
  let injector: Injector;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TestSimpleWcComponent,
        TestCachedWcComponent,
        TestDisplayContentsComponent,
        TestBindContextComponent,
        TestReactiveUpdateComponent,
        TestNoInputsComponent,
        TestLifecycleComponent,
      ],
      providers: [ComponentBinder],
    });
    injector = TestBed.inject(Injector);
  });

  afterEach(() => {
    setDefaultUniversalInjector(undefined);
  });

  it('converts an AngularComponentImplementation to a WebComponentImplementation', () => {
    const impl = toWebComponent({
      name: 'SimpleTest',
      schema: z.object({text: z.string()}),
      component: TestSimpleWcComponent,
    });

    expect(impl.name).toBe('SimpleTest');
    expect(impl.tagName).toBe('a2ui-ng-simpletest');
    expect(typeof impl.element).toBe('function');
  });

  it('keeps allowedParents and allowedChildren', () => {
    @Component({
      selector: 'test-constrained-wc',
      template: '',
      standalone: true,
    })
    class TestConstrainedComponent extends CatalogComponent<ComponentApi> {}

    const impl = toWebComponent({
      name: 'ConstrainedTest',
      schema: z.object({}),
      allowedParents: ['Card'],
      allowedChildren: ['Text'],
      component: TestConstrainedComponent,
    });

    expect(impl.allowedParents).toEqual(['Card']);
    expect(impl.allowedChildren).toEqual(['Text']);
  });

  it('does not define the custom element until registerUniversalElement is called', () => {
    @Component({
      selector: 'test-lazy-define-wc',
      template: '<span>Lazy</span>',
      standalone: true,
    })
    class TestLazyDefineComponent extends CatalogComponent<ComponentApi> {}

    const impl = toWebComponent({
      name: 'LazyDefineTest',
      schema: z.object({}),
      component: TestLazyDefineComponent,
    });

    expect(customElements.get(impl.tagName)).toBeUndefined();
    registerUniversalElement(impl);
    expect(customElements.get(impl.tagName)).toBe(impl.element);
  });

  it('returns cached WebComponentImplementation on subsequent calls with the same component class', () => {
    const impl1 = toWebComponent({
      name: 'CachedTest',
      schema: z.object({}),
      component: TestCachedWcComponent,
    });

    const impl2 = toWebComponent({
      name: 'CachedTest',
      schema: z.object({}),
      component: TestCachedWcComponent,
    });

    expect(impl1).toBe(impl2);
  });

  it('instantiates custom element and sets up display: contents', () => {
    const impl = createUniversalImplementation(
      {name: 'DisplayContentsTest', schema: z.object({})},
      TestDisplayContentsComponent,
    );

    const catalog = new AngularCatalog('test-catalog', '0.9', [impl]);
    const surface = new SurfaceModel('surface-1', catalog);
    surface.componentsModel.addComponent(
      new ComponentModel('comp-0', 'DisplayContentsTest', {}, catalog),
    );

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.injector = injector;
    el.context = new ComponentContext(surface, 'comp-0', '/');
    document.body.appendChild(el);
    expect(el.style.display).toBe('contents');
    document.body.removeChild(el);
  });

  it('binds component context, props, and metadata to the underlying Angular component', () => {
    const impl = createUniversalImplementation(
      {name: 'BindContextTest', schema: z.object({text: z.string()})},
      TestBindContextComponent,
    );

    const catalog = new AngularCatalog('test-catalog', '0.9', [impl]);
    const surface = new SurfaceModel('surface-1', catalog);
    const componentModel = new ComponentModel(
      'comp-1',
      'BindContextTest',
      {
        text: 'Hello World',
      },
      catalog,
    );
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-1', '/');

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.injector = injector;
    el.context = context;

    document.body.appendChild(el);

    const span = el.querySelector('.test-text');
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe('Hello World');

    document.body.removeChild(el);
  });

  it('updates bound props reactively when componentModel emits onUpdated', () => {
    const impl = createUniversalImplementation(
      {name: 'ReactiveUpdateTest', schema: z.object({text: z.string()})},
      TestReactiveUpdateComponent,
    );

    const catalog = new AngularCatalog('test-catalog', '0.9', [impl]);
    const surface = new SurfaceModel('surface-2', catalog);
    const componentModel = new ComponentModel(
      'comp-2',
      'ReactiveUpdateTest',
      {
        text: 'Initial Text',
      },
      catalog,
    );
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-2', '/');

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.injector = injector;
    el.context = context;

    document.body.appendChild(el);

    expect(el.querySelector('.test-text')!.textContent).toBe('Initial Text');

    // Mutate and emit update
    componentModel.properties = {text: 'Updated Text'};

    expect(el.querySelector('.test-text')!.textContent).toBe('Updated Text');

    document.body.removeChild(el);
  });

  it('safely handles components without standard inputs', () => {
    const impl = createUniversalImplementation(
      {name: 'NoInputsTest', schema: z.object({})},
      TestNoInputsComponent,
    );

    const catalog = new AngularCatalog('test-catalog', '0.9', [impl]);
    const surface = new SurfaceModel('surface-3', catalog);
    const componentModel = new ComponentModel('comp-3', 'NoInputsTest', {}, catalog);
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-3', '/');

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.injector = injector;
    el.context = context;

    document.body.appendChild(el);

    const content = el.querySelector('.static-content');
    expect(content).toBeTruthy();
    expect(content!.textContent).toBe('Static');

    document.body.removeChild(el);
  });

  it('cleans up views and subscriptions on disconnectedCallback and supports reattachment', () => {
    const impl = createUniversalImplementation(
      {name: 'LifecycleTest', schema: z.object({text: z.string()})},
      TestLifecycleComponent,
    );

    const catalog = new AngularCatalog('test-catalog', '0.9', [impl]);
    const surface = new SurfaceModel('surface-4', catalog);
    const componentModel = new ComponentModel(
      'comp-4',
      'LifecycleTest',
      {
        text: 'First Attach',
      },
      catalog,
    );
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-4', '/');

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.injector = injector;
    el.context = context;

    document.body.appendChild(el);
    expect(el.querySelector('.test-text')!.textContent).toBe('First Attach');

    // Disconnect
    document.body.removeChild(el);

    // Reconnect
    document.body.appendChild(el);
    componentModel.properties = {text: 'Second Attach'};

    expect(el.querySelector('.test-text')!.textContent).toBe('Second Attach');
    document.body.removeChild(el);
  });

  it('disambiguates tag names when two different component classes share the same name', () => {
    class CompClassA extends CatalogComponent<ComponentApi> {}
    class CompClassB extends CatalogComponent<ComponentApi> {}

    const impl1 = toWebComponent({
      name: 'DuplicateName',
      schema: z.object({}),
      component: CompClassA,
    });

    const impl2 = toWebComponent({
      name: 'DuplicateName',
      schema: z.object({}),
      component: CompClassB,
    });

    expect(impl1.tagName).toBe('a2ui-ng-duplicatename');
    expect(impl2.tagName).toBe('a2ui-ng-duplicatename-2');
    expect(impl1.element).not.toBe(impl2.element);
  });

  it('falls back to the default injector registered with setDefaultUniversalInjector', () => {
    @Component({
      selector: 'test-default-injector-wc',
      template: '<span class="test-text">{{ props()?.text?.value() }}</span>',
      standalone: true,
    })
    class TestDefaultInjectorComponent extends CatalogComponent<TextTestApi> {}

    const impl = createUniversalImplementation(
      {name: 'DefaultInjectorTest', schema: z.object({text: z.string()})},
      TestDefaultInjectorComponent,
    );

    const catalog = new AngularCatalog('test-catalog', '0.9', [impl]);
    const surface = new SurfaceModel('surface-5', catalog);
    const componentModel = new ComponentModel(
      'comp-5',
      'DefaultInjectorTest',
      {
        text: 'From default injector',
      },
      catalog,
    );
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-5', '/');

    setDefaultUniversalInjector(injector);
    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.context = context;

    document.body.appendChild(el);
    expect(el.querySelector('.test-text')!.textContent).toBe('From default injector');
    document.body.removeChild(el);
  });

  it('throws on connect when no injector is available', () => {
    @Component({
      selector: 'test-no-injector-wc',
      template: '<span>No injector</span>',
      standalone: true,
    })
    class TestNoInjectorComponent extends CatalogComponent<ComponentApi> {}

    const impl = toWebComponent({
      name: 'NoInjectorTest',
      schema: z.object({}),
      component: TestNoInjectorComponent,
    });

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    // Exceptions thrown from custom element reactions do not propagate to `appendChild`, so the
    // callback is invoked directly.
    expect(() => el.connectedCallback()).toThrowError(/no Angular Injector available/);
  });

  it('throws on connect when no context is set', () => {
    @Component({
      selector: 'test-no-context-wc',
      template: '<span>No context</span>',
      standalone: true,
    })
    class TestNoContextComponent extends CatalogComponent<ComponentApi> {}

    const impl = toWebComponent({
      name: 'NoContextTest',
      schema: z.object({}),
      component: TestNoContextComponent,
    });

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.injector = injector;
    expect(() => el.connectedCallback()).toThrowError(/'context' must be set/);
  });

  it('throws on connect when the catalog entry has no Angular component', () => {
    const impl = toWebComponent({
      name: 'OwningEntryTest',
      schema: z.object({}),
      component: TestNoInputsComponent,
    });
    // `AngularCatalog` would give this entry a placeholder component; use the base class to keep
    // exercising the runtime guard.
    const wcOnlyEntry: WebComponentImplementation = {
      name: 'OwningEntryTest',
      schema: z.object({}),
      tagName: impl.tagName,
      element: impl.element,
    };
    const catalog = new Catalog<AngularComponentImplementation>('test-catalog', '0.9', [
      wcOnlyEntry as unknown as AngularComponentImplementation,
    ]);
    const surface = new SurfaceModel('surface-1', catalog);
    surface.componentsModel.addComponent(
      new ComponentModel('comp-6', 'OwningEntryTest', {}, catalog),
    );

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.injector = injector;
    el.context = new ComponentContext(surface, 'comp-6', '/');
    expect(() => el.connectedCallback()).toThrowError(/has no Angular component/);
  });

  it('binds via binder.bindNode when el.node is assigned from NodeResolver', () => {
    // Inject the binder first so Angular reactivity is in place before the resolver
    // creates any signals.
    const binder = TestBed.inject(ComponentBinder);
    const impl = createUniversalImplementation(
      {name: 'NodeHostTest', schema: z.object({text: DynamicStringSchema})},
      TestBindContextComponent,
    );
    const catalog = new AngularCatalog('test-catalog', '0.9', [impl]);
    const surface = new SurfaceModel('surface-node-wc', catalog);
    surface.dataModel.set('/text', 'From Node');
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'NodeHostTest', {text: {path: '/text'}}, catalog),
    );
    const resolver = new NodeResolver(surface, catalog);
    const rootNode = getValue(resolver.rootNode)!;

    const bindNodeSpy = spyOn(binder, 'bindNode').and.callThrough();
    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.injector = injector;
    el.node = rootNode;

    document.body.appendChild(el);
    expect(bindNodeSpy).toHaveBeenCalledWith(rootNode);
    expect(el.node).toBe(rootNode);
    expect(el.querySelector('.test-text')!.textContent).toBe('From Node');

    // A data change after mount reaches the DOM through the node's props.
    surface.dataModel.set('/text', 'Updated Node');
    TestBed.tick();
    (el as any).componentRef?.changeDetectorRef.detectChanges();
    expect(el.querySelector('.test-text')!.textContent).toBe('Updated Node');

    // Clearing `node` keeps the current context and bindings in place; parents assign
    // `node` and then `context`, and `set context` performs the rebind.
    el.node = undefined;
    expect(el.node).toBeUndefined();
    expect(el.context).toBe(rootNode.context!);
    expect(el.querySelector('.test-text')!.textContent).toBe('Updated Node');

    document.body.removeChild(el);
    resolver.dispose();
  });

  it('retains earlier active fallback injectors when a newer injector is cleared', () => {
    const LABEL_TOKEN = new InjectionToken<string>('LABEL_TOKEN');

    @Component({
      selector: 'test-stacked-injector-wc',
      template: '<span class="token-val">{{ label }}</span>',
      standalone: true,
    })
    class TestStackedInjectorComponent extends CatalogComponent<ComponentApi> {
      readonly label = inject(LABEL_TOKEN);
    }

    const impl = createUniversalImplementation(
      {name: 'StackedInjectorTest', schema: z.object({})},
      TestStackedInjectorComponent,
    );
    const catalog = new AngularCatalog('test-catalog', '0.9', [impl]);
    const surface = new SurfaceModel('surface-stacked', catalog);
    surface.componentsModel.addComponent(
      new ComponentModel('comp-stacked', 'StackedInjectorTest', {}, catalog),
    );

    const injectorA = Injector.create({
      providers: [{provide: LABEL_TOKEN, useValue: 'from-A'}],
      parent: injector,
    });
    const injectorB = Injector.create({
      providers: [{provide: LABEL_TOKEN, useValue: 'from-B'}],
      parent: injector,
    });

    setDefaultUniversalInjector(injectorA);
    setDefaultUniversalInjector(injectorB);
    clearDefaultUniversalInjector(injectorB);

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as AngularWcHost;
    el.context = new ComponentContext(surface, 'comp-stacked', '/');
    document.body.appendChild(el);

    expect(el.querySelector('.token-val')!.textContent).toBe('from-A');
    document.body.removeChild(el);
  });

  it('resolves distinct injectors from enclosing DOM hosts and SurfaceGroupModels', () => {
    const LABEL_TOKEN = new InjectionToken<string>('LABEL_TOKEN');

    @Component({
      selector: 'test-scoped-injector-wc',
      template: '<span class="token-val">{{ label }}</span>',
      standalone: true,
    })
    class TestScopedInjectorComponent extends CatalogComponent<ComponentApi> {
      readonly label = inject(LABEL_TOKEN);
    }

    const impl = createUniversalImplementation(
      {name: 'ScopedInjectorTest', schema: z.object({})},
      TestScopedInjectorComponent,
    );
    const catalog = new AngularCatalog('test-catalog', '0.9', [impl]);
    const groupA = new SurfaceGroupModel<AngularComponentImplementation>();
    const groupB = new SurfaceGroupModel<AngularComponentImplementation>();
    const surfaceA = new SurfaceModel('surf-a', catalog);
    const surfaceB = new SurfaceModel('surf-b', catalog);
    surfaceA.componentsModel.addComponent(
      new ComponentModel('comp-a', 'ScopedInjectorTest', {}, catalog),
    );
    surfaceB.componentsModel.addComponent(
      new ComponentModel('comp-b', 'ScopedInjectorTest', {}, catalog),
    );
    groupA.addSurface(surfaceA);
    groupB.addSurface(surfaceB);

    const injectorA = Injector.create({
      providers: [{provide: LABEL_TOKEN, useValue: 'bubble-A'}],
      parent: injector,
    });
    const injectorB = Injector.create({
      providers: [{provide: LABEL_TOKEN, useValue: 'bubble-B'}],
      parent: injector,
    });

    const hostContainerA = document.createElement('div');
    const hostContainerB = document.createElement('div');
    document.body.appendChild(hostContainerA);
    document.body.appendChild(hostContainerB);
    registerUniversalHostInjector(hostContainerA, injectorA);
    registerSurfaceGroupInjector(groupB, injectorB);

    registerUniversalElement(impl);
    const elA = document.createElement(impl.tagName) as AngularWcHost;
    elA.context = new ComponentContext(surfaceA, 'comp-a', '/');
    hostContainerA.appendChild(elA);

    const elB = document.createElement(impl.tagName) as AngularWcHost;
    elB.context = new ComponentContext(surfaceB, 'comp-b', '/');
    hostContainerB.appendChild(elB);

    expect(elA.querySelector('.token-val')!.textContent).toBe('bubble-A');
    expect(elB.querySelector('.token-val')!.textContent).toBe('bubble-B');

    registerUniversalHostInjector(hostContainerA, undefined);
    registerSurfaceGroupInjector(groupB, undefined);
    document.body.removeChild(hostContainerA);
    document.body.removeChild(hostContainerB);
    groupA.dispose();
    groupB.dispose();
  });
});
