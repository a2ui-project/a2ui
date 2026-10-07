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
  const catBasic = new Catalog('id_basic', 'v1.0', [], []);
  const catCustom1 = new Catalog('id_custom1', 'v1.0', [], []);
  const catCustom2 = new Catalog('id_custom2', 'v1.0', [], []);

  const configBasic = new CatalogConfig(catBasic);
  const configCustom1 = new CatalogConfig(catCustom1);
  const configCustom2 = new CatalogConfig(catCustom2);

  const supportedConfigs = [configBasic, configCustom1, configCustom2];

  const inline = (catalogId: string) => ({catalogId, protocolVersion: '1.0', components: {}});

  it('activates every catalog the renderer names, in its preference order', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: ['id_custom2', 'id_basic'],
    };
    const resolved = resolveCatalogs(supportedConfigs, caps);
    expect(resolved.map(c => c.id)).toEqual(['id_custom2', 'id_basic']);
  });

  it('ignores ids the agent does not hold', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: ['id_not_exists', 'id_custom1'],
    };
    const resolved = resolveCatalogs(supportedConfigs, caps);
    expect(resolved.map(c => c.id)).toEqual(['id_custom1']);
  });

  it('throws when the renderer names nothing the agent holds', () => {
    const caps: V10RendererCapabilities = {supportedCatalogIds: ['id_not_exists']};
    expect(() => resolveCatalogs(supportedConfigs, caps)).toThrowError(A2uiCatalogError);
  });

  it('throws when supportedCatalogIds is empty and nothing is declared inline', () => {
    const caps: V10RendererCapabilities = {supportedCatalogIds: []};
    expect(() => resolveCatalogs(supportedConfigs, caps)).toThrowError(A2uiCatalogError);
  });

  it('adds each accepted inline catalog as an active catalog of its own', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: ['id_basic'],
      inlineCatalogs: [inline('id_inline1'), inline('id_inline2')],
    };
    const resolved = resolveCatalogs([configBasic], caps, true);
    expect(resolved.map(c => c.id)).toEqual(['id_basic', 'id_inline1', 'id_inline2']);
  });

  it('accepts an inline catalog alone when no registered id matches', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: [],
      inlineCatalogs: [inline('id_inline')],
    };
    const resolved = resolveCatalogs([configBasic], caps, true);
    expect(resolved.map(c => c.id)).toEqual(['id_inline']);
  });

  it('drops inline catalogs the agent does not accept', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: ['id_basic'],
      inlineCatalogs: [inline('id_inline')],
    };
    const resolved = resolveCatalogs([configBasic], caps, false);
    expect(resolved.map(c => c.id)).toEqual(['id_basic']);
  });

  it('throws when an accepted inline catalog states no protocol version', () => {
    const caps: V10RendererCapabilities = {
      supportedCatalogIds: [],
      inlineCatalogs: [{catalogId: 'id_inline', components: {}}],
    };
    expect(() => resolveCatalogs([configBasic], caps, true)).toThrowError(A2uiCatalogError);
  });

  it('activates every registered catalog when capabilities are absent', () => {
    const resolved = resolveCatalogs(supportedConfigs, undefined);
    expect(resolved.map(c => c.id)).toEqual(['id_basic', 'id_custom1', 'id_custom2']);
  });
});
