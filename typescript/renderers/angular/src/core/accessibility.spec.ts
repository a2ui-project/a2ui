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

import {Component, EnvironmentInjector, Injector, Type} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {z} from 'zod';
import {
  CommonSchemas,
  ComponentApi,
  ComponentModel,
  NodeResolver,
  SurfaceModel,
  getValue,
} from '@a2ui/web_core/v0_9';
import {
  isWebComponentImplementation,
  registerUniversalElement,
} from '@a2ui/web_core/v0_9/universal';
import {AccessibilityTargetDirective, ValidationErrorsDirective} from './accessibility';
import {A2uiRendererService} from './a2ui-renderer.service';
import {CatalogComponent} from './catalog_component';
import {CatalogComponentInstance} from './catalog_component_instance';
import {ComponentBinder} from './component-binder.service';
import {ComponentHostComponent} from './component-host.component';
import {initializeAngularReactivity} from './reactivity';
import {AngularWcHost} from '../catalog/angular_wc_host';
import {
  AngularCatalog,
  type AngularComponentImplementation,
  createComponentImplementation,
} from '../catalog/types';

const CardApi = {name: 'Card', schema: z.object({})} satisfies ComponentApi;
const FieldApi = {
  name: 'Field',
  schema: z.object({checks: CommonSchemas.Checkable.shape.checks}),
} satisfies ComponentApi;

/** Marks no element, so its host is labelled. */
@Component({selector: 'test-card', template: '<div class="card">Card</div>'})
class TestCardComponent extends CatalogComponent<typeof CardApi> {}

/** Labels its input and shows its validation errors below it. */
@Component({
  selector: 'test-field',
  imports: [AccessibilityTargetDirective, ValidationErrorsDirective],
  template: `
    <input class="input" a2uiAccessibilityTarget />
    <div class="errors" a2uiValidationErrors>Fix this</div>
  `,
})
class TestFieldComponent extends CatalogComponent<typeof FieldApi> {}

const catalog = new AngularCatalog('a11y', '0.9', [
  createComponentImplementation(
    CardApi,
    TestCardComponent as unknown as Type<CatalogComponentInstance>,
  ),
  createComponentImplementation(
    FieldApi,
    TestFieldComponent as unknown as Type<CatalogComponentInstance>,
  ),
]);

function flush(fixture: ComponentFixture<unknown>) {
  TestBed.tick();
  fixture.detectChanges();
}

describe('host accessibility', () => {
  let surface: SurfaceModel<AngularComponentImplementation>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ComponentHostComponent],
      providers: [
        ComponentBinder,
        {
          provide: A2uiRendererService,
          useValue: {
            surfaceGroup: {getSurface: () => surface},
            useUniversalComponents: false,
          },
        },
      ],
    });
    initializeAngularReactivity(TestBed.inject(EnvironmentInjector));
    surface = new SurfaceModel('a11y', catalog);
  });

  function renderRoot(type: string, props: Record<string, unknown>) {
    surface.componentsModel.addComponent(new ComponentModel('root', type, props, catalog));
    const fixture = TestBed.createComponent(ComponentHostComponent);
    fixture.componentRef.setInput('componentKey', 'root');
    fixture.componentRef.setInput('surfaceId', 'a11y');
    flush(fixture);
    return fixture;
  }

  describe('ComponentHostComponent', () => {
    it('labels the host as a group when the component marks no element', () => {
      const fixture = renderRoot('Card', {
        accessibility: {label: 'Featured Deal', description: 'Ends today', live: 'polite'},
      });

      const host = fixture.nativeElement as HTMLElement;
      expect(host.getAttribute('role')).toBe('group');
      expect(host.getAttribute('aria-label')).toBe('Featured Deal');
      expect(host.getAttribute('aria-description')).toBe('Ends today');
      expect(host.getAttribute('aria-live')).toBe('polite');
    });

    it('hides the host and makes it inert', () => {
      const fixture = renderRoot('Card', {accessibility: {hidden: true}});

      const host = fixture.nativeElement as HTMLElement;
      expect(host.getAttribute('aria-hidden')).toBe('true');
      expect(host.inert).toBeTrue();
    });

    it('puts the label on the a2uiAccessibilityTarget element', () => {
      const fixture = renderRoot('Field', {accessibility: {label: 'Email', live: 'polite'}});

      const host = fixture.nativeElement as HTMLElement;
      const input = host.querySelector('.input')!;
      expect(input.getAttribute('aria-label')).toBe('Email');
      expect(host.hasAttribute('aria-label')).toBeFalse();
      expect(host.hasAttribute('role')).toBeFalse();
      expect(host.getAttribute('aria-live')).toBe('polite');
    });

    it('marks the target invalid and describes it by the errors element', () => {
      surface.dataModel.set('/ok', false);
      const fixture = renderRoot('Field', {
        checks: [{condition: {path: '/ok'}, message: 'Fix this'}],
      });

      const host = fixture.nativeElement as HTMLElement;
      const input = host.querySelector('.input')!;
      const errors = host.querySelector('.errors')!;
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(errors.id).not.toBe('');
      expect(input.getAttribute('aria-describedby')).toBe(errors.id);

      surface.dataModel.set('/ok', true);
      flush(fixture);

      expect(input.hasAttribute('aria-invalid')).toBeFalse();
      expect(input.hasAttribute('aria-describedby')).toBeFalse();
    });

    it('follows accessibility changes and removal', () => {
      const fixture = renderRoot('Card', {accessibility: {label: 'Before'}});
      const host = fixture.nativeElement as HTMLElement;

      surface.componentsModel.get('root')!.properties = {accessibility: {label: 'After'}};
      flush(fixture);
      expect(host.getAttribute('aria-label')).toBe('After');

      surface.componentsModel.get('root')!.properties = {};
      flush(fixture);
      expect(host.hasAttribute('aria-label')).toBeFalse();
      expect(host.hasAttribute('role')).toBeFalse();
    });
  });

  describe('AngularWcHost', () => {
    function mountUnderLit(type: string, props: Record<string, unknown>) {
      surface.componentsModel.addComponent(new ComponentModel('root', type, props, catalog));
      const impl = catalog.components.get(type)!;
      if (!isWebComponentImplementation(impl)) {
        throw new Error('expected a Web Component implementation');
      }
      const resolver = new NodeResolver(surface, catalog);
      registerUniversalElement(impl);
      const el = document.createElement(impl.tagName) as AngularWcHost;
      el.injector = TestBed.inject(Injector);
      el.node = getValue(resolver.rootNode)!;
      document.body.appendChild(el);
      // web_core effects run as Angular effects, on the next tick.
      TestBed.tick();
      return {el, resolver};
    }

    it('labels itself as a group when the component marks no element', () => {
      const {el, resolver} = mountUnderLit('Card', {accessibility: {label: 'Featured Deal'}});

      expect(el.getAttribute('role')).toBe('group');
      expect(el.getAttribute('aria-label')).toBe('Featured Deal');

      el.remove();
      expect(el.hasAttribute('aria-label')).toBeFalse();
      resolver.dispose();
    });

    it("puts the label on its component's a2uiAccessibilityTarget element", () => {
      const {el, resolver} = mountUnderLit('Field', {accessibility: {label: 'Email'}});

      expect(el.querySelector('.input')!.getAttribute('aria-label')).toBe('Email');
      expect(el.hasAttribute('aria-label')).toBeFalse();

      el.remove();
      resolver.dispose();
    });
  });
});
