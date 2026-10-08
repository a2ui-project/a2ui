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
import {DirectJsonParser} from '../../../../src/inference-formats/direct-json/parser.js';
import {DirectJsonStreamProcessorImpl} from '../../../../src/inference-formats/direct-json/streaming.js';
import {DirectJsonFormatFactory} from '../../../../src/inference-formats/direct-json/format.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {ParseError, A2uiCatalogError, A2uiValidationError} from '../../../../src/errors.js';

const basicCatalogV10 = loadBasicCatalog('v1.0');

describe('DirectJsonParser', () => {
  const catalog = basicCatalogV10;

  it('hasFormatContent requires a closed block only when complete is set', () => {
    const parser = new DirectJsonParser([catalog]);
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
    const parser = new DirectJsonParser([catalog]);
    const content = 'Text before\n<a2ui-json>\n[{"action": "test"}]\n</a2ui-json>\nText after';
    const parts = parser.unwrap(content);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({type: 'text', text: 'Text before', isFinal: true});
    expect(parts[1]).toEqual({type: 'a2ui', a2uiRaw: '[{"action": "test"}]', isFinal: true});
    expect(parts[2]).toEqual({type: 'text', text: 'Text after', isFinal: true});
  });

  it('throws ParseError on missing close tag', () => {
    const parser = new DirectJsonParser([catalog]);
    const content = 'Text before\n<a2ui-json>\n[{"action": "test"}]';
    expect(() => parser.unwrap(content)).toThrow(ParseError);
  });

  it('throws ParseError on empty JSON part', () => {
    const parser = new DirectJsonParser([catalog]);
    const content = 'Text before\n<a2ui-json>\n</a2ui-json>';
    expect(() => parser.unwrap(content)).toThrow(ParseError);
  });

  it('throws ParseError when no tags are found', () => {
    const parser = new DirectJsonParser([catalog]);
    const content = 'Text before\nNo tags here';
    expect(() => parser.unwrap(content)).toThrow(ParseError);
  });

  it('compiles raw format content', () => {
    const parser = new DirectJsonParser([catalog]);
    const payload = `[{"version": "v1.0", "createSurface": {"surfaceId": "1", "catalogId": "${catalog.id}"}}]`;
    const compiled = parser.compile(payload);
    expect(compiled).toEqual([
      {version: 'v1.0', createSurface: {surfaceId: '1', catalogId: catalog.id}},
    ]);
  });

  it('parseChunk throws without a stream processor', () => {
    const parser = new DirectJsonParser([catalog]);
    expect(() => parser.parseChunk('<a2ui-json>')).toThrow(
      'DirectJsonParser was constructed without a stream processor, so streaming is unavailable.',
    );
  });

  it('supportsStreaming is false without a stream processor and true with one', () => {
    const parserWithout = new DirectJsonParser([catalog]);
    expect(parserWithout.supportsStreaming).toBe(false);

    const streamProcessor = new DirectJsonStreamProcessorImpl([catalog]);
    const parserWith = new DirectJsonParser([catalog], streamProcessor);
    expect(parserWith.supportsStreaming).toBe(true);
  });

  it('DirectJsonFormatFactory creates format with supportsStreaming true', () => {
    const factory = new DirectJsonFormatFactory();
    const format = factory.createFormat([catalog]);
    expect(format.supportsStreaming).toBe(true);
  });

  it('gets every active catalog from the format', async () => {
    const catalogs = [catalog, catalog];
    const parser = new DirectJsonFormatFactory().createFormat(catalogs).createParser();
    expect((parser as DirectJsonParser).catalogs).toEqual(catalogs);
  });

  describe('validation', () => {
    it('throws A2uiCatalogError on empty catalog list', () => {
      expect(() => new DirectJsonParser([])).toThrow(A2uiCatalogError);
    });

    it('throws A2uiCatalogError on mixed v0.9 and v1.0 catalogs', () => {
      expect(() => new DirectJsonParser([catalog, loadBasicCatalog('v0.9')])).toThrow(
        A2uiCatalogError,
      );
    });

    it('throws A2uiValidationError on missing version', () => {
      const parser = new DirectJsonParser([catalog]);
      const payload = `[{"createSurface": {"surfaceId": "1", "catalogId": "${catalog.id}"}}]`;
      expect(() => parser.compile(payload)).toThrow(A2uiValidationError);
    });

    it('throws A2uiValidationError on mismatched version', () => {
      const parser = new DirectJsonParser([catalog]);
      const payload = `[{"version": "v0.9", "createSurface": {"surfaceId": "1", "catalogId": "${catalog.id}"}}]`;
      expect(() => parser.compile(payload)).toThrow(A2uiValidationError);
    });

    it('throws A2uiValidationError on unknown component', () => {
      const parser = new DirectJsonParser([catalog]);
      const payload = `[{"version": "v1.0", "createSurface": {"surfaceId": "1", "catalogId": "${catalog.id}"}}, {"updateComponents": {"surfaceId": "1", "components": [{"component": "unknown", "id": "1"}]}}]`;
      expect(() => parser.compile(payload)).toThrow(A2uiValidationError);
    });

    it('throws A2uiValidationError on unknown component property', () => {
      const parser = new DirectJsonParser([catalog]);
      const payload = `[{"version": "v1.0", "createSurface": {"surfaceId": "1", "catalogId": "${catalog.id}"}}, {"updateComponents": {"surfaceId": "1", "components": [{"component": "text", "id": "1", "unknownProp": 1}]}}]`;
      expect(() => parser.compile(payload)).toThrow(A2uiValidationError);
    });

    it('throws A2uiValidationError on unknown catalogId', () => {
      const parser = new DirectJsonParser([catalog]);
      const payload = `[{"version": "v1.0", "createSurface": {"surfaceId": "1", "catalogId": "unknown-catalog"}}]`;
      expect(() => parser.compile(payload)).toThrow(A2uiValidationError);
    });

    it('compile(raw, false) skips schema validation', () => {
      const parser = new DirectJsonParser([catalog]);
      const payload = `[{"version": "1.0", "createSurface": {"surfaceId": "1", "catalogId": "unknown"}}]`;
      expect(() => parser.compile(payload, false)).not.toThrow();
    });
  });
});
