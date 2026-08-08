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
import {
  Catalog,
  ComponentApi,
  WebComponentImplementation,
  isWebComponentImplementation,
} from '@a2ui/web_core/v0_9';
import {CatalogComponentInstance} from '../core/catalog_component_instance';

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

// TEMPORARY WORKAROUND:
// Internal WeakMap to associate pre-built universal Web Component tag names with Angular components
// without increasing the public API surface of AngularComponentImplementation.
//
// This enables dynamic toggling between native Angular components and universal web_core basic catalog
// Web Components. This workaround will be removed once Angular uses the basic catalog from web_core
// and the Angular native implementation of the basic catalog is removed.
const componentToUniversalTagMap = new WeakMap<Type<CatalogComponentInstance>, string>();

/**
 * Internal helper to retrieve the pre-built universal Web Component tag name associated with an
 * AngularComponentImplementation, if one was provided during createComponentImplementation.
 *
 * @internal
 */
export function getUniversalTagName(impl: AngularComponentImplementation): string | undefined {
  return componentToUniversalTagMap.get(impl.component);
}

/**
 * Helper function to create an {@link AngularComponentImplementation}.
 *
 * @param componentApi The ComponentApi or WebComponentImplementation defining the schema and name.
 * @param component The Angular Component class.
 * @returns The structured AngularComponentImplementation.
 */
export function createComponentImplementation(
  componentApi: ComponentApi | WebComponentImplementation,
  component: Type<CatalogComponentInstance>,
): AngularComponentImplementation {
  if (isWebComponentImplementation(componentApi)) {
    componentToUniversalTagMap.set(component, componentApi.tagName);
  }

  return {
    name: componentApi.name,
    schema: componentApi.schema,
    component,
  };
}
