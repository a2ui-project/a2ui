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
import {toWebComponent} from './to_web_component';
import {ComponentBinder} from '../core/component-binder.service';
import {CatalogComponent} from '../core/catalog_component';
import {AngularCatalog} from './types';
import {ComponentApi} from '@a2ui/web_core/v0_9';

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

  it('converts an AngularComponentImplementation to a WebComponentImplementation', () => {
    const impl = toWebComponent(
      {
        name: 'SimpleTest',
        schema: z.object({text: z.string()}),
        component: TestSimpleWcComponent,
      },
      injector,
    );

    expect(impl.name).toBe('SimpleTest');
    expect(impl.tagName).toBe('a2ui-ng-simpletest');
    expect(customElements.get(impl.tagName)).toBeDefined();
  });

  it('uses custom tagName if defined on the component implementation', () => {
    class CustomTagClass extends CatalogComponent<ComponentApi> {}
    const impl = toWebComponent(
      {
        name: 'CustomTagTest',
        schema: z.object({}),
        component: CustomTagClass,
        tagName: 'custom-tag-element',
      },
      injector,
    );

    expect(impl.tagName).toBe('custom-tag-element');
    expect(customElements.get('custom-tag-element')).toBeDefined();
  });

  it('returns cached WebComponentImplementation on subsequent calls with the same component class', () => {
    const impl1 = toWebComponent(
      {
        name: 'CachedTest',
        schema: z.object({}),
        component: TestCachedWcComponent,
      },
      injector,
    );

    const impl2 = toWebComponent(
      {
        name: 'CachedTest',
        schema: z.object({}),
        component: TestCachedWcComponent,
      },
      injector,
    );

    expect(impl1).toBe(impl2);
  });

  it('instantiates custom element and sets up display: contents', () => {
    const impl = toWebComponent(
      {
        name: 'DisplayContentsTest',
        schema: z.object({}),
        component: TestDisplayContentsComponent,
      },
      injector,
    );

    const el = document.createElement(impl.tagName);
    document.body.appendChild(el);
    expect(el.style.display).toBe('contents');
    document.body.removeChild(el);
  });

  it('binds component context, props, and metadata to the underlying Angular component', () => {
    const impl = toWebComponent(
      {
        name: 'BindContextTest',
        schema: z.object({text: z.string()}),
        component: TestBindContextComponent,
      },
      injector,
    );

    const catalog = new AngularCatalog('test-catalog', [impl]);
    const surface = new SurfaceModel('surface-1', catalog);
    const componentModel = new ComponentModel('comp-1', 'BindContextTest', {
      text: 'Hello World',
    });
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-1', '/');

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
    const impl = toWebComponent(
      {
        name: 'ReactiveUpdateTest',
        schema: z.object({text: z.string()}),
        component: TestReactiveUpdateComponent,
      },
      injector,
    );

    const catalog = new AngularCatalog('test-catalog', [impl]);
    const surface = new SurfaceModel('surface-2', catalog);
    const componentModel = new ComponentModel('comp-2', 'ReactiveUpdateTest', {
      text: 'Initial Text',
    });
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-2', '/');

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
    const impl = toWebComponent(
      {
        name: 'NoInputsTest',
        schema: z.object({}),
        component: TestNoInputsComponent,
      },
      injector,
    );

    const catalog = new AngularCatalog('test-catalog', [impl]);
    const surface = new SurfaceModel('surface-3', catalog);
    const componentModel = new ComponentModel('comp-3', 'NoInputsTest', {});
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-3', '/');

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
    const impl = toWebComponent(
      {
        name: 'LifecycleTest',
        schema: z.object({text: z.string()}),
        component: TestLifecycleComponent,
      },
      injector,
    );

    const catalog = new AngularCatalog('test-catalog', [impl]);
    const surface = new SurfaceModel('surface-4', catalog);
    const componentModel = new ComponentModel('comp-4', 'LifecycleTest', {
      text: 'First Attach',
    });
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-4', '/');

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

    const impl1 = toWebComponent(
      {
        name: 'DuplicateName',
        schema: z.object({}),
        component: CompClassA,
      },
      injector,
    );

    const impl2 = toWebComponent(
      {
        name: 'DuplicateName',
        schema: z.object({}),
        component: CompClassB,
      },
      injector,
    );

    expect(impl1.tagName).toBe('a2ui-ng-duplicatename');
    expect(impl2.tagName).toBe('a2ui-ng-duplicatename-1');
    expect(impl1.tagName).not.toBe(impl2.tagName);
    expect(customElements.get(impl1.tagName)).toBeDefined();
    expect(customElements.get(impl2.tagName)).toBeDefined();
  });
});
