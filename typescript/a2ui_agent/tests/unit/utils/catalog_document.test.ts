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

import {describe, it, expect} from 'vitest';
import {Catalog} from '../../../src/internal/web_core.js';
import {basicCatalog} from '../../../src/types.js';
import {A2uiCatalogError} from '../../../src/errors.js';
import {
  registerCatalogDocument,
  getCatalogDocument,
  hasCatalogDocument,
} from '../../../src/utils/catalog_document.js';
import {
  ComponentPruningTransformer,
  FunctionPruningTransformer,
} from '../../../src/catalog_transformers/pruning.js';

describe('catalog_document registry', () => {
  it('registers and retrieves catalog source JSON document', () => {
    const catalog = new Catalog('custom_id', [], []);
    expect(hasCatalogDocument(catalog)).toBe(false);

    const doc = {catalogId: 'custom_id', components: {Text: {type: 'object'}}};
    registerCatalogDocument(catalog, doc);

    expect(hasCatalogDocument(catalog)).toBe(true);
    expect(getCatalogDocument(catalog)).toBe(doc);
  });

  it('throws A2uiCatalogError with exact message when no document registered', () => {
    const catalog = new Catalog('unregistered_catalog_id', [], []);
    expect(() => getCatalogDocument(catalog)).toThrow(A2uiCatalogError);
    expect(() => getCatalogDocument(catalog)).toThrow(
      "Catalog 'unregistered_catalog_id' has no source JSON document registered. Express reads component schemas from the catalog JSON, so the catalog must be loaded through @a2ui/agent (basicCatalog, a catalog provider, or CatalogConfig).",
    );
  });

  it('basicCatalog(v1.0) and basicCatalog(v0.9) have registered documents', () => {
    const catV10 = basicCatalog('v1.0');
    expect(hasCatalogDocument(catV10)).toBe(true);
    const docV10 = getCatalogDocument(catV10);
    expect(docV10).toBeDefined();
    expect(typeof docV10.components).toBe('object');
    expect(Object.keys(docV10.components as Record<string, unknown>)).toContain('Button');

    const catV09 = basicCatalog('v0.9');
    expect(hasCatalogDocument(catV09)).toBe(true);
    const docV09 = getCatalogDocument(catV09);
    expect(docV09).toBeDefined();
    expect(typeof docV09.components).toBe('object');
    expect(Object.keys(docV09.components as Record<string, unknown>)).toContain('Button');
  });

  it('pruning keeps only the kept components in the document', () => {
    const cat = basicCatalog('v1.0');
    const transformer = new ComponentPruningTransformer(['Text', 'Button']);
    const prunedCat = transformer.transform(cat);

    expect(hasCatalogDocument(prunedCat)).toBe(true);
    const prunedDoc = getCatalogDocument(prunedCat);
    const components = prunedDoc.components as Record<string, unknown>;
    expect(Object.keys(components)).toEqual(['Text', 'Button']);
    // Check that original keys and definitions were preserved for kept components
    expect(components.Text).toBeDefined();
    expect(components.Button).toBeDefined();
    expect(components.Image).toBeUndefined();

    // Other top-level fields like instructions and $defs should be preserved
    const origDoc = getCatalogDocument(cat);
    expect(prunedDoc.instructions).toEqual(origDoc.instructions);
    expect(prunedDoc.catalogId).toEqual(origDoc.catalogId);
  });

  it('function pruning keeps only the kept functions in the document', () => {
    const cat = basicCatalog('v1.0');
    const transformer = new FunctionPruningTransformer(['required']);
    const prunedCat = transformer.transform(cat);

    expect(hasCatalogDocument(prunedCat)).toBe(true);
    const prunedDoc = getCatalogDocument(prunedCat);
    const functions = prunedDoc.functions as Record<string, unknown>;
    expect(Object.keys(functions)).toEqual(['required']);
    expect(functions.required).toBeDefined();
    expect(functions.regex).toBeUndefined();
  });

  it('pruning works without registering document if input catalog has no document', () => {
    const bareCatalog = new Catalog('bare', [], []);
    expect(hasCatalogDocument(bareCatalog)).toBe(false);

    const transformer = new ComponentPruningTransformer(['Text']);
    const transformed = transformer.transform(bareCatalog);

    expect(hasCatalogDocument(transformed)).toBe(false);
    expect(() => getCatalogDocument(transformed)).toThrow(A2uiCatalogError);
  });
});
