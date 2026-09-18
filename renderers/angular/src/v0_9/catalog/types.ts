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

import {Type} from '@angular/core';
import {Catalog, ComponentApi} from '@a2ui/web_core/v0_9';
import {
  WebComponentImplementation,
  isWebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import {CatalogComponentInstance} from '../core/catalog_component_instance';
import {toWebComponent} from './to_web_component';

/**
 * Temporary type used during basic catalog schema alignment to bypass strict type checking.
 *
 * To be removed once all properties implemented in Angular basic catalog components conform
 * to the basic catalog schema.
 * @see https://github.com/a2ui-project/a2ui/issues/1303
 */
export type AnyDuringSchemaAlignment = any;

/**
 * Extends the generic {@link ComponentApi} to include Angular-specific component metadata.
 */
export interface AngularComponentImplementation extends ComponentApi {
  /**
   * The Angular component class used to render this component.
   *
   * This class must be an Angular {@link Type} (e.g., a standalone component class)
   * that accepts `props`, `surfaceId`, and `dataContextPath` as inputs.
   */
  readonly component: Type<CatalogComponentInstance>;
}

/**
 * A component implementation supported by the Angular catalog, which can be
 * either a native W3C Custom Element or an Angular `@Component` declaration.
 */
export type CatalogComponentImplementation =
  | WebComponentImplementation
  | AngularComponentImplementation;

/**
 * A collection of component and function implementations mapped to
 * A2UI protocol types.
 *
 * Supports both native Angular component declarations (`.component`) and
 * W3C Custom Elements (`WebComponentImplementation`).
 *
 * Catalogs are used by the {@link MessageProcessor} to resolve component
 * definitions and by {@link ComponentHostComponent} to instantiate the
 * correct Angular components.
 */
export class AngularCatalog extends Catalog<CatalogComponentImplementation> {}

/**
 * Type guard to check if a component declaration is an AngularComponentImplementation.
 *
 * Uses structural duck-typing (`'component' in api && typeof api.component === 'function'`)
 * to preserve backwards compatibility with existing applications and catalogs constructed
 * using plain JavaScript/TypeScript object literals without requiring class inheritance or
 * private brand symbols.
 *
 * @note This duck-typing check may be replaced or removed in a future major version release.
 */
export function isAngularComponentImplementation(
  api: unknown,
): api is AngularComponentImplementation {
  return (
    typeof api === 'object' &&
    api !== null &&
    'component' in api &&
    typeof (api as {component?: unknown}).component === 'function'
  );
}

/**
 * Creates a catalog entry for an Angular component that can be rendered both natively and as a
 * universal Web Component.
 *
 * The returned implementation is an {@link AngularComponentImplementation} (via `component`) and a
 * {@link WebComponentImplementation} (via `tagName` and `element`) at the same time. The Angular
 * renderer picks the native component or the Web Component depending on
 * `RendererConfiguration.useUniversalComponents`, while universal container components, which
 * resolve their children by tag name, can always render it.
 *
 * When `componentApi` is already a `WebComponentImplementation` (for example a `@a2ui/web_core`
 * basic catalog component), its element is used for universal rendering. Otherwise `component` is
 * wrapped into a Custom Element with {@link toWebComponent}.
 *
 * @param componentApi The ComponentApi or WebComponentImplementation defining the schema and name.
 * @param component The Angular Component class.
 * @returns The structured implementation.
 */
export function createComponentImplementation(
  componentApi: ComponentApi | WebComponentImplementation,
  component: Type<CatalogComponentInstance>,
): AngularComponentImplementation & WebComponentImplementation {
  const webComponent = isWebComponentImplementation(componentApi)
    ? componentApi
    : toWebComponent({name: componentApi.name, schema: componentApi.schema, component});

  return {
    name: componentApi.name,
    schema: componentApi.schema,
    tagName: webComponent.tagName,
    element: webComponent.element,
    component,
  };
}
