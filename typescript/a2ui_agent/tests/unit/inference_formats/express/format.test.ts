/*
 * Copyright 2026 Google LLC
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
  ExpressFormat,
  ExpressFormatFactory,
} from '../../../../src/inference_formats/express/format.js';
import {ExpressParser} from '../../../../src/inference_formats/express/parser.js';
import {ExpressPromptGenerator} from '../../../../src/inference_formats/express/prompt_generator.js';
import {basicCatalog} from '../../../../src/types.js';
import {A2uiCatalogError} from '../../../../src/errors.js';

describe('ExpressFormat', () => {
  const catalog1 = basicCatalog('v1.0');
  const catalog2 = basicCatalog('v0.9');

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
