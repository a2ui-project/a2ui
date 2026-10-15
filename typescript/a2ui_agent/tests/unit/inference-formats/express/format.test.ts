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
import {
  buildSchemaHelpers,
  catalogsDefining,
  surfaceCatalogId,
} from '../../../../src/inference-formats/express/catalogs.js';
import {
  ExpressFormat,
  ExpressFormatFactory,
} from '../../../../src/inference-formats/express/format.js';
import {ExpressParser} from '../../../../src/inference-formats/express/parser.js';
import {ExpressPromptGenerator} from '../../../../src/inference-formats/express/prompt-generator.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {
  catalogFromTestDocument,
  loadConformanceCatalog,
} from '../../../helpers/conformance-catalogs.js';
import {A2uiCatalogError} from '../../../../src/errors.js';

const basicCatalogV10 = loadBasicCatalog('v1.0');
const basicCatalogV09 = loadBasicCatalog('v0.9');

describe('ExpressFormat', () => {
  const catalog1 = basicCatalogV10;
  const catalog2 = basicCatalogV09;

  it('throws A2uiCatalogError when no catalogs are provided', () => {
    expect(() => new ExpressFormat([])).toThrow(A2uiCatalogError);
    expect(() => new ExpressFormat([])).toThrow('Express requires at least one catalog.');
  });

  it('throws A2uiCatalogError when catalogs have different protocol versions', () => {
    expect(() => new ExpressFormat([catalog1, catalog2])).toThrow(A2uiCatalogError);
    expect(() => new ExpressFormat([catalog1, catalog2])).toThrow(
      `Express catalogs must share one protocol version, but '${catalog1.id}' is 'v1.0' and '${catalog2.id}' is 'v0.9'.`,
    );
  });

  it('throws A2uiCatalogError when duplicate catalog IDs are provided', () => {
    expect(() => new ExpressFormat([catalog1, catalog1])).toThrow(A2uiCatalogError);
    expect(() => new ExpressFormat([catalog1, catalog1])).toThrow(
      `Duplicate catalog ID: '${catalog1.id}'`,
    );
  });

  it('throws A2uiCatalogError when multiple v0.9 catalogs are provided', () => {
    const customV09 = catalogFromTestDocument({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      catalogId: 'test/custom_v0_9',
      protocolVersion: '0.9',
      components: {},
      functions: {},
    });
    expect(() => new ExpressFormat([catalog2, customV09])).toThrow(A2uiCatalogError);
    expect(() => new ExpressFormat([catalog2, customV09])).toThrow(
      /Several catalogs need A2UI v1\.0 or later/,
    );
  });

  it('surfaceCatalogId returns catalog id for single catalog and undefined for multiple', () => {
    const customV10 = loadConformanceCatalog('custom_catalog_v1_0.json');
    expect(surfaceCatalogId([catalog1])).toBe(catalog1.id);
    expect(surfaceCatalogId([catalog1, customV10])).toBeUndefined();
  });

  it('catalogsDefining returns catalog ids that define a component or function in order', () => {
    const simplified = loadConformanceCatalog('simplified_catalog_v1_0.json');
    const custom = loadConformanceCatalog('custom_catalog_v1_0.json');
    const helpers = buildSchemaHelpers([simplified, custom], 'v1.0');
    expect(catalogsDefining(helpers, 'component', 'Text')).toEqual([simplified.id]);
    expect(catalogsDefining(helpers, 'component', 'Chart')).toEqual([custom.id]);
    expect(catalogsDefining(helpers, 'component', 'NonExistent')).toEqual([]);
    expect(catalogsDefining(helpers, 'function', 'percent')).toEqual([custom.id]);
  });

  it('constructs successfully with exactly one catalog', () => {
    const format = new ExpressFormat([catalog1], {
      surfaceId: 'custom_surface',
      version: 'v1.0',
    });
    expect(format.supportsStreaming).toBe(false);
    expect(format.promptGenerator).toBeInstanceOf(ExpressPromptGenerator);
  });

  it('createParser returns configured ExpressParser', () => {
    const format = new ExpressFormat([catalog1], {
      surfaceId: 'custom_surface',
      version: 'v1.0',
    });
    const parser = format.createParser();
    expect(parser).toBeInstanceOf(ExpressParser);
    expect((parser as ExpressParser).surfaceId).toBe('custom_surface');
    expect((parser as ExpressParser).version).toBe('v1.0');
    expect((parser as ExpressParser).catalogs[0]).toBe(catalog1);
  });

  it('createParser result has supportsStreaming false and parseChunk throws', () => {
    const format = new ExpressFormat([catalog1]);
    const parser = format.createParser();
    expect(parser.supportsStreaming).toBe(false);
    expect(() => parser.parseChunk('chunk')).toThrow('Streaming is not supported by ExpressParser');
  });

  describe('Version handling', () => {
    it('defaults to catalog version v0.9', () => {
      const format = new ExpressFormat([catalog2]);
      const parser = format.createParser();
      expect((parser as unknown as {version: string}).version).toBe('v0.9');
    });

    it('throws A2uiCatalogError on explicit version mismatch', () => {
      expect(() => new ExpressFormat([catalog2], {version: 'v1.0'})).toThrow(
        /Requested protocol version 'v1.0' does not match catalog version 'v0.9'/,
      );
    });

    it('accepts v0.9.1 for a v0.9 catalog', () => {
      const parser = new ExpressFormat([catalog2], {version: 'v0.9.1'}).createParser();
      expect((parser as ExpressParser).version).toBe('v0.9.1');
    });
  });

  describe('ExpressFormatFactory', () => {
    it('creates an ExpressFormat instance with factory options', () => {
      const factory = new ExpressFormatFactory({surfaceId: 'factory_surface', version: 'v1.0'});
      const format = factory.createFormat([catalog1]);
      expect(format).toBeInstanceOf(ExpressFormat);
      const parser = format.createParser() as ExpressParser;
      expect(parser.surfaceId).toBe('factory_surface');
      expect(parser.version).toBe('v1.0');
    });

    it('factory propagates single-catalog error on invalid catalogs', () => {
      const factory = new ExpressFormatFactory();
      expect(() => factory.createFormat([])).toThrow(A2uiCatalogError);
    });
  });
});
