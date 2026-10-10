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
import {Catalog, CatalogApi, CatalogOptions} from '../internal/web-core.js';
import {
  hasCatalogDocument,
  getCatalogDocument,
  registerCatalogDocument,
} from '../utils/catalog-document.js';

/**
 * Registers a pruned copy of the source catalog's JSON document for the
 * pruned catalog, keeping only the allowed entries of one section.
 *
 * Does nothing if the source catalog has no registered document.
 */
function registerPrunedDocument(
  source: CatalogApi,
  pruned: CatalogApi,
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
 * Returns the options that carry a catalog's metadata, authored `$defs` and
 * source document over to a catalog derived from it.
 *
 * Pruning only drops entries, so the kept entries keep their `sourceJson` and
 * `toJson()` of the derived catalog emits them as authored. A transformer that
 * rewrites an entry's schema must drop that entry's `sourceJson` instead.
 */
function derivedCatalogOptions(catalog: CatalogApi): CatalogOptions {
  return {
    themeSchema: catalog.themeSchema,
    instructions: catalog.instructions,
    schemaUri: catalog.schemaUri,
    schemaId: catalog.schemaId,
    title: catalog.title,
    description: catalog.description,
    declaredProtocolVersion: catalog.declaredProtocolVersion,
    defs: catalog.defs,
    sourceDocument: catalog.sourceDocument,
  };
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
  transform(catalog: CatalogApi): CatalogApi {
    const prunedComponents = Array.from(catalog.components.values()).filter(c =>
      this.allowedComponents.has(c.name),
    );
    const functions = Array.from(catalog.functions.values());

    const result = new Catalog(
      catalog.id,
      catalog.protocolVersion,
      prunedComponents,
      functions,
      derivedCatalogOptions(catalog),
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
  transform(catalog: CatalogApi): CatalogApi {
    const components = Array.from(catalog.components.values());
    const prunedFunctions = Array.from(catalog.functions.values()).filter(f =>
      this.allowedFunctions.has(f.name),
    );

    const result = new Catalog(
      catalog.id,
      catalog.protocolVersion,
      components,
      prunedFunctions,
      derivedCatalogOptions(catalog),
    );

    registerPrunedDocument(catalog, result, 'functions', this.allowedFunctions);

    return result;
  }
}
