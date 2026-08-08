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

import {Inject, Injectable, InjectionToken, Injector, Optional} from '@angular/core';
import {AngularCatalog, AngularComponentImplementation} from '../types';
import {
  basicCatalog,
  BASIC_FUNCTIONS,
  createBasicCatalogFunctions,
} from '@a2ui/web_core/v0_9/basic_catalog';
import {FunctionImplementation, WebComponentImplementation} from '@a2ui/web_core/v0_9';

/**
 * A component implementation supported by the basic catalog, which can be
 * either a native W3C Custom Element or an Angular `@Component` declaration.
 */
export type BasicCatalogComponent = WebComponentImplementation | AngularComponentImplementation;

/**
 * Interface for specifying overrides and configuration for the basic catalog.
 */
export interface BasicCatalogOptions {
  /**
   * An optional override for the catalog's unique identifier.
   */
  id?: string;

  /**
   * An optional locale to configure catalog-level formatting.
   */
  locale?: string;

  /**
   * Optional overrides for individual components in the catalog.
   */
  components?: Partial<Record<string, BasicCatalogComponent>>;

  /**
   * Optional additional components to include in the catalog beyond
   * the standard basic catalog components.
   *
   * @deprecated Use AngularCatalog constructor directly to combine BASIC_COMPONENTS with custom ones.
   */
  extraComponents?: BasicCatalogComponent[];

  /**
   * An optional set of function implementations to use instead of the defaults.
   *
   * @deprecated Use AngularCatalog constructor directly to combine BASIC_FUNCTIONS with custom ones.
   */
  functions?: FunctionImplementation[];
}

/**
 * The set of Angular UI components provided by the basic catalog.
 */
export const BASIC_COMPONENTS: BasicCatalogComponent[] = Array.from(
  basicCatalog.components.values(),
);

/**
 * The set of client-side functions provided by the basic catalog.
 */
export {BASIC_FUNCTIONS};

/**
 * A base class for basic catalogs, providing extensibility for non-DI use cases.
 */
export class BasicCatalogBase extends AngularCatalog {
  constructor(options: BasicCatalogOptions = {}, injector?: Injector) {
    const id = options.id ?? basicCatalog.id;
    const functions =
      options.functions ??
      (options.locale
        ? createBasicCatalogFunctions({locale: options.locale})
        : Array.from(basicCatalog.functions.values()));

    const baseComponents = new Map<string, BasicCatalogComponent>(basicCatalog.components);
    if (options.components) {
      for (const [key, comp] of Object.entries(options.components)) {
        if (comp) {
          baseComponents.set(key, comp);
        }
      }
    }

    const components: BasicCatalogComponent[] = [
      ...Array.from(baseComponents.values()),
      ...(options.extraComponents ?? []),
    ];

    super(id, components, functions, injector);
  }
}

export const BASIC_CATALOG_OPTIONS = new InjectionToken<BasicCatalogOptions>(
  'BASIC_CATALOG_OPTIONS',
);

/**
 * A basic catalog of components and functions for v0.9 verification.
 *
 * This catalog includes a wide range of UI components (Text, Button, Row, etc.)
 * and utility functions (formatString) defined in the A2UI v0.9
 * basic catalog specification.
 */
@Injectable({
  providedIn: 'root',
})
export class BasicCatalog extends BasicCatalogBase {
  constructor(
    @Optional() @Inject(BASIC_CATALOG_OPTIONS) options?: BasicCatalogOptions,
    @Optional() injector?: Injector,
  ) {
    super(options ?? {}, injector);
  }
}

export const BASIC_CATALOG = new BasicCatalog();
