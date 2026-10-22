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

import {Catalog} from '../../../../src/internal/web-core.js';
import {
  A2uiCatalogError,
  A2uiValidationError,
  DirectJsonFormat,
  DirectJsonFormatFactory,
  DirectJsonParser,
  ParseError,
} from '../../../../src/index.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';

const basicCatalogV10 = loadBasicCatalog('v1.0');
const customCatalogV10 = new Catalog('https://a2ui.org/catalogs/custom', 'v1.0', [], []);

/** Compiles one block and checks its messages against a new renderer state. */
function check(parser: DirectJsonParser, payload: string): unknown {
  return parser.parseResponse(payload, {wrapped: false});
}

describe('DirectJsonParser', () => {
  it('hasFormatContent requires a closed block only when complete is set', () => {
    const parser = new DirectJsonParser([basicCatalogV10]);
    const closed = '<a2ui-json>\n{"a": 1}\n</a2ui-json>';
    const unterminated = '<a2ui-json>\n{"a": 1}';

    expect(parser.hasFormatContent('No tags here')).toBe(false);
    expect(parser.hasFormatContent(closed)).toBe(true);
    expect(parser.hasFormatContent(unterminated)).toBe(true);

    expect(parser.hasFormatContent('No tags here', {complete: true})).toBe(false);
    expect(parser.hasFormatContent(closed, {complete: true})).toBe(true);
    expect(parser.hasFormatContent(unterminated, {complete: true})).toBe(false);
    expect(parser.hasFormatContent('</a2ui-json> <a2ui-json>', {complete: true})).toBe(false);
  });

  it('unwraps valid A2UI JSON payload', () => {
    const parser = new DirectJsonParser([basicCatalogV10]);
    const content = 'Text before\n<a2ui-json>\n[{"action": "test"}]\n</a2ui-json>\nText after';
    const parts = parser.unwrap(content);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({type: 'text', text: 'Text before', isFinal: true});
    expect(parts[1]).toEqual({type: 'a2ui', a2uiRaw: '[{"action": "test"}]', isFinal: true});
    expect(parts[2]).toEqual({type: 'text', text: 'Text after', isFinal: true});
  });

  it('unwraps a block still open at the end as a block that is not final', () => {
    const parser = new DirectJsonParser([basicCatalogV10]);
    const content = 'Text before\n<a2ui-json>\n[{"action": "test"}]';
    expect(parser.unwrap(content)).toEqual([
      {type: 'text', text: 'Text before', isFinal: true},
      {type: 'a2ui', a2uiRaw: '[{"action": "test"}]', isFinal: false},
    ]);
  });

  it('unwraps an empty block as an empty raw part', () => {
    const parser = new DirectJsonParser([basicCatalogV10]);
    const content = 'Text before\n<a2ui-json>\n</a2ui-json>';
    expect(parser.unwrap(content)).toEqual([
      {type: 'text', text: 'Text before', isFinal: true},
      {type: 'a2ui', a2uiRaw: '', isFinal: true},
    ]);
    expect(() => parser.parseResponse(content)).toThrow(ParseError);
  });

  it('unwraps a response without tags as one text part', () => {
    const parser = new DirectJsonParser([basicCatalogV10]);
    const content = 'Text before\nNo tags here';
    expect(parser.unwrap(content)).toEqual([{type: 'text', text: content, isFinal: true}]);
    expect(parser.parseResponse(content)).toEqual([{type: 'text', text: content}]);
  });

  it('unwraps an empty response as no parts', () => {
    const parser = new DirectJsonParser([basicCatalogV10]);
    expect(parser.unwrap('')).toEqual([]);
  });

  it('throws ParseError on an empty block or one that is not JSON', () => {
    const parser = new DirectJsonParser([basicCatalogV10]);
    expect(() => parser.compile('')).toThrow(ParseError);
    expect(() => parser.compile('not json')).toThrow(ParseError);
  });

  it('compiles raw format content', () => {
    const parser = new DirectJsonParser([basicCatalogV10]);
    const payload = `[{"version": "v1.0", "createSurface": {"surfaceId": "1", "catalogId": "${basicCatalogV10.id}"}}]`;
    const compiled = parser.compile(payload);
    expect(compiled).toEqual([
      {version: 'v1.0', createSurface: {surfaceId: '1', catalogId: basicCatalogV10.id}},
    ]);
  });

  it('compiles a block that holds one message on its own', () => {
    const parser = new DirectJsonParser([basicCatalogV10]);
    const payload = `{"version": "v1.0", "createSurface": {"surfaceId": "1", "catalogId": "${basicCatalogV10.id}"}}`;
    expect(parser.compile(payload)).toEqual([
      {version: 'v1.0', createSurface: {surfaceId: '1', catalogId: basicCatalogV10.id}},
    ]);
  });

  it('supports streaming', () => {
    expect(new DirectJsonParser([basicCatalogV10]).supportsStreaming).toBe(true);
  });

  it('gives the format its progressive keys', () => {
    const format = new DirectJsonFormat([basicCatalogV10], undefined, {progressiveKeys: ['label']});
    expect([...format.createParser().progressiveKeys]).toEqual(['label']);
    expect([...new DirectJsonFormat([basicCatalogV10]).createParser().progressiveKeys]).toEqual([
      'text',
    ]);
    expect([...new DirectJsonParser([basicCatalogV10]).progressiveKeys]).toEqual([]);
  });

  it('DirectJsonFormatFactory creates format with supportsStreaming true', () => {
    const factory = new DirectJsonFormatFactory();
    const format = factory.createFormat([basicCatalogV10]);
    expect(format.supportsStreaming).toBe(true);
  });

  it('gets every active catalog from the format', async () => {
    const catalogs = [basicCatalogV10, customCatalogV10];
    const parser = new DirectJsonFormatFactory().createFormat(catalogs).createParser();
    expect((parser as DirectJsonParser).catalogs).toEqual(catalogs);
  });

  describe('validation', () => {
    it('throws A2uiCatalogError on empty catalog list', () => {
      expect(() => new DirectJsonParser([])).toThrow(A2uiCatalogError);
      expect(() => new DirectJsonFormatFactory().createFormat([])).toThrow(A2uiCatalogError);
    });

    it('throws A2uiCatalogError on duplicate catalogs', () => {
      expect(() => new DirectJsonParser([basicCatalogV10, basicCatalogV10])).toThrow(
        A2uiCatalogError,
      );
      expect(() =>
        new DirectJsonFormatFactory().createFormat([basicCatalogV10, basicCatalogV10]),
      ).toThrow(A2uiCatalogError);
    });

    it('throws A2uiCatalogError on mixed v0.9 and v1.0 catalogs', () => {
      expect(() => new DirectJsonParser([basicCatalogV10, loadBasicCatalog('v0.9')])).toThrow(
        A2uiCatalogError,
      );
    });

    it.each(['v0.9', 'v0.9.1', 'v1.0'] as const)(
      'accepts multiple catalogs for protocol version %s',
      version => {
        const catalogs = [
          new Catalog('https://a2ui.org/catalogs/basic', version, [], []),
          new Catalog('https://a2ui.org/catalogs/custom', version, [], []),
        ];
        expect(new DirectJsonParser(catalogs).catalogs).toEqual(catalogs);
        expect(
          new DirectJsonFormatFactory().createFormat(catalogs).createParser().catalogs,
        ).toEqual(catalogs);
      },
    );

    it('accepts mixed v0.9 and v0.9.1 catalogs since they share a release line', () => {
      const catalogs = [
        new Catalog('https://a2ui.org/catalogs/basic', 'v0.9', [], []),
        new Catalog('https://a2ui.org/catalogs/custom', 'v0.9.1', [], []),
      ];
      expect(new DirectJsonParser(catalogs).catalogs).toEqual(catalogs);
      expect(new DirectJsonFormatFactory().createFormat(catalogs).createParser().catalogs).toEqual(
        catalogs,
      );
    });

    it('throws A2uiValidationError on missing version', () => {
      const parser = new DirectJsonParser([basicCatalogV10]);
      const payload = `[{"createSurface": {"surfaceId": "1", "catalogId": "${basicCatalogV10.id}"}}]`;
      expect(() => check(parser, payload)).toThrow(A2uiValidationError);
      expect(() => check(parser, payload)).toThrow(/Message 0 states no version/);
    });

    it('throws A2uiValidationError on mismatched version', () => {
      const parser = new DirectJsonParser([basicCatalogV10]);
      const payload = `[{"version": "v0.9", "createSurface": {"surfaceId": "1", "catalogId": "${basicCatalogV10.id}"}}]`;
      expect(() => check(parser, payload)).toThrow(A2uiValidationError);
      expect(() => check(parser, payload)).toThrow(/Message 0 states version 'v0\.9'/);
    });

    it('throws A2uiValidationError on unknown component', () => {
      const parser = new DirectJsonParser([basicCatalogV10]);
      const payload = `[{"version": "v1.0", "createSurface": {"surfaceId": "1", "catalogId": "${basicCatalogV10.id}"}}, {"version": "v1.0", "updateComponents": {"surfaceId": "1", "components": [{"id": "root", "component": "UnknownWidget"}]}}]`;
      expect(() => check(parser, payload)).toThrow(A2uiValidationError);
      expect(() => check(parser, payload)).toThrow(/UnknownWidget/);
    });

    it('throws A2uiValidationError on unknown component property', () => {
      const parser = new DirectJsonParser([basicCatalogV10]);
      const payload = `[{"version": "v1.0", "createSurface": {"surfaceId": "1", "catalogId": "${basicCatalogV10.id}"}}, {"version": "v1.0", "updateComponents": {"surfaceId": "1", "components": [{"id": "root", "component": "Text", "text": "hello", "unknownProp": 1}]}}]`;
      expect(() => check(parser, payload)).toThrow(A2uiValidationError);
      expect(() => check(parser, payload)).toThrow(/unknownProp/);
    });

    it('throws A2uiValidationError on unknown catalogId', () => {
      const parser = new DirectJsonParser([basicCatalogV10]);
      const payload = `[{"version": "v1.0", "createSurface": {"surfaceId": "1", "catalogId": "unknown-catalog"}}]`;
      expect(() => check(parser, payload)).toThrow(A2uiValidationError);
      expect(() => check(parser, payload)).toThrow(/unknown-catalog/);
    });

    it('compile only translates the block', () => {
      const parser = new DirectJsonParser([basicCatalogV10]);
      const payload = `[{"version": "1.0", "createSurface": {"surfaceId": "1", "catalogId": "unknown"}}]`;
      expect(parser.compile(payload)).toEqual([
        {version: '1.0', createSurface: {surfaceId: '1', catalogId: 'unknown'}},
      ]);
      expect(() => check(parser, payload)).toThrow(A2uiValidationError);
    });
  });
});
