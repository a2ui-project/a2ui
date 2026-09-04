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

import {Injector, Type} from '@angular/core';
import type {ZodTypeAny} from 'zod';
import {Catalog, ComponentApi, WebComponentImplementation} from '@a2ui/web_core/v0_9';
import {CatalogComponentInstance} from '../core/catalog_component_instance';

export {isWebComponentImplementation, type WebComponentImplementation} from '@a2ui/web_core/v0_9';

/**
 * Describes an Angular-specific component implementation.
 *
 * In addition to the standard A2UI ComponentApi, this interface accepts
 * an Angular component class (`component`).
 */
export interface AngularComponentImplementation<
  Schema extends ZodTypeAny = ZodTypeAny,
> extends ComponentApi<Schema> {
  /**
   * The Angular component class used to render this component.
   */
  readonly component: Type<CatalogComponentInstance>;

  /**
   * Optional custom element tag name. Populated when prepared for universal rendering.
   */
  readonly tagName?: string;
}

/**
 * A component implementation supported by the Angular catalog, which can be
 * either a native W3C Custom Element or an Angular `@Component` declaration.
 */
export type CatalogComponentDeclaration =
  | WebComponentImplementation
  | AngularComponentImplementation;

/**
 * A collection of component and function implementations mapped to
 * A2UI protocol types.
 *
 * Supports both native Angular component declarations (`.component`) and
 * W3C Custom Elements (`WebComponentImplementation`).
 */
export class AngularCatalog<
  T extends CatalogComponentDeclaration = CatalogComponentDeclaration,
> extends Catalog<T> {
  /**
   * The Angular Injector associated with this catalog, used for universal Web Component bridging.
   */
  injector?: Injector;
}

/**
 * Type guard to check if a component declaration is an AngularComponentImplementation.
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
 * Helper function to create an {@link AngularComponentImplementation}.
 *
 * @param api The ComponentApi defining the schema and name.
 * @param component The Angular Component class.
 * @returns The structured AngularComponentImplementation.
 */
export function createComponentImplementation<Schema extends ZodTypeAny = ZodTypeAny>(
  api: ComponentApi<Schema>,
  component: Type<CatalogComponentInstance>,
): AngularComponentImplementation<Schema> {
  return {
    ...api,
    component,
  };
}
