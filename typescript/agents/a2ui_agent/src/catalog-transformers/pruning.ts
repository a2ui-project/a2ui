/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {CatalogTransformer} from './base.js';
import {CatalogApi} from '../internal/web-core.js';

/**
 * Prunes catalog component definitions to an allowlist of allowed components.
 */
export class ComponentPruningTransformer implements CatalogTransformer {
  /** The set of allowed component names. */
  readonly allowedComponents: Set<string>;

  /**
   * Initializes a ComponentPruningTransformer.
   *
   * @param allowedComponents List of allowed component names, or null to allow none.
   */
  constructor(allowedComponents: string[] | null) {
    this.allowedComponents = new Set(allowedComponents ?? []);
  }

  /**
   * Returns a new Catalog filtered to only include components in allowedComponents.
   *
   * @param catalog The catalog to prune.
   * @returns A new, pruned catalog instance.
   */
  transform(catalog: CatalogApi): CatalogApi {
    const prunedComponents = Array.from(catalog.components.values()).filter(c =>
      this.allowedComponents.has(c.name),
    );
    const functions = Array.from(catalog.functions.values());

    // The kept entries keep their definitions, so `toJson()` of the pruned
    // catalog emits them as written; definitions only pruned entries
    // referenced are dropped.
    const result = catalog.withEntries(prunedComponents, functions);

    return result;
  }
}

/**
 * Prunes catalog function definitions to an allowlist of allowed functions.
 */
export class FunctionPruningTransformer implements CatalogTransformer {
  /** The set of allowed function names. */
  readonly allowedFunctions: Set<string>;

  /**
   * Initializes a FunctionPruningTransformer.
   *
   * @param allowedFunctions List of allowed function names, or null to allow none.
   */
  constructor(allowedFunctions: string[] | null) {
    this.allowedFunctions = new Set(allowedFunctions ?? []);
  }

  /**
   * Returns a new Catalog filtered to only include functions in allowedFunctions.
   *
   * @param catalog The catalog to prune.
   * @returns A new, pruned catalog instance.
   */
  transform(catalog: CatalogApi): CatalogApi {
    const components = Array.from(catalog.components.values());
    const prunedFunctions = Array.from(catalog.functions.values()).filter(f =>
      this.allowedFunctions.has(f.name),
    );

    const result = catalog.withEntries(components, prunedFunctions);

    return result;
  }
}
