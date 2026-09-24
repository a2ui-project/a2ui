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

import {SchemaCatalog} from '../types.js';
import {CatalogTransformer} from './base.js';
import {Catalog} from '../internal/web_core.js';
import {
  hasCatalogDocument,
  getCatalogDocument,
  registerCatalogDocument,
} from '../utils/catalog_document.js';

/**
 * Registers a pruned copy of the source catalog's JSON document for the
 * pruned catalog, keeping only the allowed entries of one section.
 *
 * Does nothing if the source catalog has no registered document.
 */
function registerPrunedDocument(
  source: SchemaCatalog,
  pruned: SchemaCatalog,
  section: 'components' | 'functions',
  allowed: Set<string>,
): void {
  if (!hasCatalogDocument(source)) {
    return;
  }
  const doc = getCatalogDocument(source);
  const entries = doc[section];
  const kept: Record<string, unknown> = {};
  if (entries && typeof entries === 'object') {
    for (const [name, schema] of Object.entries(entries as Record<string, unknown>)) {
      if (allowed.has(name)) {
        kept[name] = schema;
      }
    }
  }
  registerCatalogDocument(pruned, {...doc, [section]: kept});
}

/**
 * Prunes catalog component definitions to an allowlist of allowed components.
 */
export class ComponentPruningTransformer implements CatalogTransformer {
  /** The set of allowed component names. */
  readonly allowedComponents: Set<string>;

  /**
   * Initializes a ComponentPruningTransformer.
   *
   * @param allowedComponents List of allowed component names.
   */
  constructor(allowedComponents: string[]) {
    this.allowedComponents = new Set(allowedComponents);
  }

  /**
   * Returns a new Catalog filtered to only include components in allowedComponents.
   *
   * @param catalog The catalog to prune.
   * @returns A new, pruned catalog instance.
   */
  transform(catalog: SchemaCatalog): SchemaCatalog {
    const prunedComponents = Array.from(catalog.components.values()).filter(c =>
      this.allowedComponents.has(c.name),
    );
    const functions = Array.from(catalog.functions.values());

    const result = new Catalog(
      catalog.id,
      prunedComponents,
      functions,
      catalog.themeSchema,
      catalog.instructions,
      catalog.protocolVersion,
    );

    registerPrunedDocument(catalog, result, 'components', this.allowedComponents);

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
   * @param allowedFunctions List of allowed function names.
   */
  constructor(allowedFunctions: string[]) {
    this.allowedFunctions = new Set(allowedFunctions);
  }

  /**
   * Returns a new Catalog filtered to only include functions in allowedFunctions.
   *
   * @param catalog The catalog to prune.
   * @returns A new, pruned catalog instance.
   */
  transform(catalog: SchemaCatalog): SchemaCatalog {
    const components = Array.from(catalog.components.values());
    const prunedFunctions = Array.from(catalog.functions.values()).filter(f =>
      this.allowedFunctions.has(f.name),
    );

    const result = new Catalog(
      catalog.id,
      components,
      prunedFunctions,
      catalog.themeSchema,
      catalog.instructions,
      catalog.protocolVersion,
    );

    registerPrunedDocument(catalog, result, 'functions', this.allowedFunctions);

    return result;
  }
}
