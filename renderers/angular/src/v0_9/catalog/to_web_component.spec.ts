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

import {Component, Injector} from '@angular/core';

import {TestBed} from '@angular/core/testing';
import {z} from 'zod';
import {ComponentContext, ComponentModel, SurfaceModel} from '@a2ui/web_core/v0_9';
import {setDefaultUniversalInjector, toWebComponent} from './to_web_component';
import {ComponentBinder} from '../core/component-binder.service';
import {CatalogComponent} from '../core/catalog_component';
import {AngularCatalog} from './types';
import {ComponentApi} from '@a2ui/web_core/v0_9';
import {registerUniversalElement} from '@a2ui/web_core/v0_9/universal';

@Component({
  selector: 'test-simple-wc',
  template: '<span class="test-text">{{ props()?.text }}</span>',
  standalone: true,
})
class TestSimpleWcComponent extends CatalogComponent<ComponentApi> {}

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
class TestBindContextComponent extends CatalogComponent<ComponentApi> {}

@Component({
  selector: 'test-reactive-wc',
  template: '<span class="test-text">{{ props()?.text?.value() }}</span>',
  standalone: true,
})
class TestReactiveUpdateComponent extends CatalogComponent<ComponentApi> {}

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
class TestLifecycleComponent extends CatalogComponent<ComponentApi> {}

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
    const impl = toWebComponent({
      name: 'DisplayContentsTest',
      schema: z.object({}),
      component: TestDisplayContentsComponent,
    });

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as any;
    el.injector = injector;
    document.body.appendChild(el);
    expect(el.style.display).toBe('contents');
    document.body.removeChild(el);
  });

  it('binds component context, props, and metadata to the underlying Angular component', () => {
    const impl = toWebComponent({
      name: 'BindContextTest',
      schema: z.object({text: z.string()}),
      component: TestBindContextComponent,
    });

    const catalog = new AngularCatalog('test-catalog', [impl]);
    const surface = new SurfaceModel('surface-1', catalog);
    const componentModel = new ComponentModel('comp-1', 'BindContextTest', {
      text: 'Hello World',
    });
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-1', '/');

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as any;
    el.injector = injector;
    el.context = context;

    document.body.appendChild(el);

    const span = el.querySelector('.test-text');
    expect(span).toBeTruthy();
    expect(span.textContent).toBe('Hello World');

    document.body.removeChild(el);
  });

  it('updates bound props reactively when componentModel emits onUpdated', () => {
    const impl = toWebComponent({
      name: 'ReactiveUpdateTest',
      schema: z.object({text: z.string()}),
      component: TestReactiveUpdateComponent,
    });

    const catalog = new AngularCatalog('test-catalog', [impl]);
    const surface = new SurfaceModel('surface-2', catalog);
    const componentModel = new ComponentModel('comp-2', 'ReactiveUpdateTest', {
      text: 'Initial Text',
    });
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-2', '/');

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as any;
    el.injector = injector;
    el.context = context;

    document.body.appendChild(el);

    expect(el.querySelector('.test-text').textContent).toBe('Initial Text');

    // Mutate and emit update
    componentModel.properties = {text: 'Updated Text'};

    expect(el.querySelector('.test-text').textContent).toBe('Updated Text');

    document.body.removeChild(el);
  });

  it('safely handles components without standard inputs', () => {
    const impl = toWebComponent({
      name: 'NoInputsTest',
      schema: z.object({}),
      component: TestNoInputsComponent,
    });

    const catalog = new AngularCatalog('test-catalog', [impl]);
    const surface = new SurfaceModel('surface-3', catalog);
    const componentModel = new ComponentModel('comp-3', 'NoInputsTest', {});
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-3', '/');

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as any;
    el.injector = injector;
    el.context = context;

    document.body.appendChild(el);

    const content = el.querySelector('.static-content');
    expect(content).toBeTruthy();
    expect(content.textContent).toBe('Static');

    document.body.removeChild(el);
  });

  it('cleans up views and subscriptions on disconnectedCallback and supports reattachment', () => {
    const impl = toWebComponent({
      name: 'LifecycleTest',
      schema: z.object({text: z.string()}),
      component: TestLifecycleComponent,
    });

    const catalog = new AngularCatalog('test-catalog', [impl]);
    const surface = new SurfaceModel('surface-4', catalog);
    const componentModel = new ComponentModel('comp-4', 'LifecycleTest', {
      text: 'First Attach',
    });
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-4', '/');

    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as any;
    el.injector = injector;
    el.context = context;

    document.body.appendChild(el);
    expect(el.querySelector('.test-text').textContent).toBe('First Attach');

    // Disconnect
    document.body.removeChild(el);

    // Reconnect
    document.body.appendChild(el);
    componentModel.properties = {text: 'Second Attach'};

    expect(el.querySelector('.test-text').textContent).toBe('Second Attach');
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
    class TestDefaultInjectorComponent extends CatalogComponent<ComponentApi> {}

    const impl = toWebComponent({
      name: 'DefaultInjectorTest',
      schema: z.object({text: z.string()}),
      component: TestDefaultInjectorComponent,
    });

    const catalog = new AngularCatalog('test-catalog', [impl]);
    const surface = new SurfaceModel('surface-5', catalog);
    const componentModel = new ComponentModel('comp-5', 'DefaultInjectorTest', {
      text: 'From default injector',
    });
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-5', '/');

    setDefaultUniversalInjector(injector);
    registerUniversalElement(impl);
    const el = document.createElement(impl.tagName) as any;
    el.context = context;

    document.body.appendChild(el);
    expect(el.querySelector('.test-text').textContent).toBe('From default injector');
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
    const el = document.createElement(impl.tagName) as any;
    // Exceptions thrown from custom element reactions do not propagate to `appendChild`, so the
    // callback is invoked directly.
    expect(() => el.connectedCallback()).toThrowError(/no Angular Injector available/);
  });
});
