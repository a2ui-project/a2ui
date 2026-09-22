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
import {resolveCatalogs} from '../../../src/utils/catalog_resolver.js';
import {CatalogConfig} from '../../../src/processor/catalog_config.js';
import {Catalog, V10RendererCapabilities} from '../../../src/internal/web_core.js';
import {A2uiCatalogError} from '../../../src/errors.js';

describe('resolveCatalogs', () => {
  const catBasic = new Catalog('id_basic', [], []);
  const catCustom1 = new Catalog('id_custom1', [], []);
  const catCustom2 = new Catalog('id_custom2', [], []);

  const configBasic = new CatalogConfig(catBasic);
  const configCustom1 = new CatalogConfig(catCustom1);
  const configCustom2 = new CatalogConfig(catCustom2);

  const supportedConfigs = [configBasic, configCustom1, configCustom2];

  it('test_select_catalog_default: returns first supported catalog if supportedCatalogIds is empty', () => {
    const caps: V10RendererCapabilities = {supportedCatalogIds: []};
    const resolved = resolveCatalogs(supportedConfigs, caps);
    expect(resolved.length).toBe(1);
    expect(resolved[0].id).toBe('id_basic');
  });

  it('test_select_catalog_intersection: finds intersection, returns matching catalog', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: ['id_custom2', 'id_custom1'],
    };
    const resolved = resolveCatalogs(supportedConfigs, caps);
    expect(resolved.length).toBe(1);
    expect(resolved[0].id).toBe('id_custom2'); // Priority goes to renderer capabilities ordering
  });

  it('test_select_catalog_priority: priority is determined by order in supportedCatalogIds', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: ['id_custom1', 'id_custom2'],
    };
    const resolved = resolveCatalogs(supportedConfigs, caps);
    expect(resolved.length).toBe(1);
    expect(resolved[0].id).toBe('id_custom1');
  });

  it('test_select_catalog_no_match: raises error if supported list is non-empty but no match exists', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: ['id_not_exists'],
    };
    expect(() => resolveCatalogs(supportedConfigs, caps)).toThrowError(A2uiCatalogError);
    expect(() => resolveCatalogs(supportedConfigs, caps)).toThrowError(
      'No client-supported catalog found',
    );
  });

  it('test_select_catalog_inline: inline catalog loading (adds to list)', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: [],
      inlineCatalogs: [{catalogId: 'id_inline', components: {}}],
    };
    const resolved = resolveCatalogs([configBasic], caps, true);
    expect(resolved.length).toBe(2);
    expect(resolved[0].id).toBe('id_basic');
    expect(resolved[1].id).toBe('id_inline');
  });

  it('test_select_catalog_inline_not_accepted: fails if not accepted', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: [],
      inlineCatalogs: [{catalogId: 'id_inline', components: {}}],
    };
    expect(() => resolveCatalogs([configBasic], caps, false)).toThrowError(A2uiCatalogError);
    expect(() => resolveCatalogs([configBasic], caps, false)).toThrowError(
      'the agent does not accept inline catalogs',
    );
  });

  it('test_select_catalog_multiple_inline: parses multiple inline catalogs', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: [],
      inlineCatalogs: [
        {catalogId: 'id_inline1', components: {}},
        {catalogId: 'id_inline2', components: {}},
      ],
    };
    const resolved = resolveCatalogs([configBasic], caps, true);
    expect(resolved.length).toBe(3);
    expect(resolved[0].id).toBe('id_basic');
    expect(resolved[1].id).toBe('id_inline1');
    expect(resolved[2].id).toBe('id_inline2');
  });

  it('test_select_catalog_no_match_with_inline: fallback to default catalog when no match in supported list but inline is present', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: ['id_not_exists'],
      inlineCatalogs: [{catalogId: 'id_inline', components: {}}],
    };
    const resolved = resolveCatalogs([configBasic, configCustom1], caps, true);
    expect(resolved.length).toBe(2);
    expect(resolved[0].id).toBe('id_basic'); // Default fallback
    expect(resolved[1].id).toBe('id_inline');
  });
});
