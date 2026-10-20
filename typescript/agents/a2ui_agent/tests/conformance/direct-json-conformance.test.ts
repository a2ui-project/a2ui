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

import {describe, test, expect} from 'vitest';
import * as path from 'path';
import {loadCases, CONFORMANCE_ROOT} from './loader.js';
import {createFileCatalogConfig} from './fixtures.js';
import {AgentToRendererMessage} from '../../src/internal/web-core.js';
import {DirectJsonParser} from '../../src/inference-formats/direct-json/parser.js';
import {RawResponsePart, ResponsePart} from '../../src/parser/response-part.js';

function assertThrows(fn: () => void, expectError: Record<string, unknown> | string): void {
  try {
    fn();
    expect.fail(`Expected error ${JSON.stringify(expectError)} but function succeeded`);
  } catch (e: any) {
    if (typeof expectError === 'string') {
      expect(e.message).toContain(expectError);
    } else if (expectError.message) {
      if (expectError.message_is_regex) {
        expect(e.message).toMatch(new RegExp(expectError.message as string));
      } else {
        expect(e.message).toContain(expectError.message as string);
      }
    }
    if (typeof expectError === 'object' && expectError.category) {
      expect(e.name).toContain(expectError.category as string);
    }
  }
}

function resolvePointer(obj: any, pointer: string): any {
  if (pointer === '') return obj;
  const parts = pointer.split('/').slice(1);
  let current = obj;
  for (const part of parts) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === undefined || current === null) return undefined;
    current = current[key];
  }
  return current;
}

function deletePointer(obj: any, pointer: string): void {
  if (pointer === '') return;
  const parts = pointer.split('/').slice(1);
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i].replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === undefined || current === null) return;
    current = current[key];
  }
  const lastKey = parts[parts.length - 1].replace(/~1/g, '/').replace(/~0/g, '~');
  if (current) delete current[lastKey];
}

function assertRawPartsMatch(
  actualParts: RawResponsePart[],
  expectedParts: Array<Record<string, unknown>>,
): void {
  expect(actualParts.length).toBe(expectedParts.length);
  for (let i = 0; i < actualParts.length; i++) {
    const actual = actualParts[i];
    const expected = expectedParts[i];
    if (actual.type === 'text') {
      expect(actual.text).toBe(expected.text ?? '');
    } else {
      expect(actual.a2uiRaw).toBe(expected.a2ui_raw);
      if (expected.is_final !== undefined) {
        expect(actual.isFinal).toBe(expected.is_final);
      }
    }
  }
}

function assertPartsMatch(
  actualParts: ResponsePart[],
  expectedParts: Array<Record<string, unknown>>,
): void {
  expect(actualParts.length).toBe(expectedParts.length);
  for (let i = 0; i < actualParts.length; i++) {
    const actual = actualParts[i];
    const expected = expectedParts[i];
    if (actual.type === 'text') {
      expect(actual.text).toBe(expected.text ?? '');
    } else {
      expect(actual.a2ui).toEqual(expected.a2ui);
    }
  }
}

describe('Direct JSON Conformance Suite', () => {
  const files = [
    path.resolve(CONFORMANCE_ROOT, 'agent/direct_json/compiler.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/direct_json/decompiler.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/direct_json/response_parser.yaml'),
  ];

  const cases = loadCases(files);
  const UNSUPPORTED = new Set<string>([]);
  const KNOWN_FAILURES = new Map<string, string>([
    [
      'unwrap · test_unwrap_response_without_tags_is_one_text_part',
      'Bypasses standard format parsing rules',
    ],
    ['unwrap · test_unwrap_empty_response_has_no_parts', 'Bypasses standard format parsing rules'],
    [
      'unwrap · test_unwrap_unterminated_block_is_not_final',
      'Bypasses standard format parsing rules',
    ],
    [
      'parse_response · test_parse_response_without_tags_is_one_text_part',
      'Bypasses standard format parsing rules',
    ],
  ]);

  for (const testCase of cases) {
    const {name, action} = testCase;
    const isUnsupported = UNSUPPORTED.has(name);

    const runCase = async () => {
      const args = (testCase.args as Record<string, unknown>) || {};
      const catalogPaths: string[] = [];
      if (Array.isArray(args.catalogs)) {
        catalogPaths.push(...(args.catalogs as string[]));
      } else if (typeof args.catalog === 'string') {
        catalogPaths.push(args.catalog);
      } else {
        catalogPaths.push('test_data/catalogs/simplified_catalog_v1_0.json');
      }
      const catalogs = catalogPaths.map(p => createFileCatalogConfig(p).catalog);
      const parser = new DirectJsonParser(catalogs);

      if (action === 'compile') {
        const payload = testCase.input as string;

        if (testCase.expect_error) {
          assertThrows(
            () => {
              parser.compile(payload);
            },
            testCase.expect_error as Record<string, unknown>,
          );
          return;
        }

        const compiled = parser.compile(payload);

        if (testCase.expect_present) {
          for (const pointer of testCase.expect_present as string[]) {
            const val = resolvePointer(compiled, pointer);
            expect(val !== null && val !== undefined && val !== '').toBe(true);
            deletePointer(compiled, pointer);
          }
        }

        expect(compiled).toEqual(testCase.expect);
      } else if (action === 'decompile') {
        const messages = testCase.messages as AgentToRendererMessage[];

        const notation = parser.decompile(messages);

        if (testCase.expect_contains) {
          for (const fragment of testCase.expect_contains as string[]) {
            expect(notation).toContain(fragment);
          }
        }

        if (testCase.expect_round_trip) {
          expect(parser.compile(notation)).toEqual(messages);
        }
      } else if (action === 'unwrap') {
        const actual = parser.unwrap(testCase.input as string);
        assertRawPartsMatch(actual, testCase.expect as Array<Record<string, unknown>>);
      } else if (action === 'wrap') {
        const parts = testCase.parts as Array<Record<string, unknown>>;
        const rawParts: RawResponsePart[] = parts.map(p => {
          if ('text' in p) {
            return {type: 'text', text: p.text as string, isFinal: (p.is_final as boolean) ?? true};
          }
          return {
            type: 'a2ui',
            a2uiRaw: p.a2ui_raw as string,
            isFinal: (p.is_final as boolean) ?? true,
          };
        });

        const output = parser.wrap(rawParts);

        if (testCase.expect_output !== undefined) {
          expect(output).toBe(testCase.expect_output);
        }
        if (testCase.expect_contains) {
          for (const fragment of testCase.expect_contains as string[]) {
            expect(output).toContain(fragment);
          }
        }
        if (testCase.expect_round_trip) {
          const unwrapped = parser.unwrap(output);
          assertRawPartsMatch(unwrapped, parts);
        }
      } else if (action === 'parse_response') {
        const wrapped = (args.wrapped as boolean) ?? true;

        if (testCase.expect_error) {
          assertThrows(
            () => {
              parser.parseResponse(testCase.input as string, wrapped);
            },
            testCase.expect_error as Record<string, unknown>,
          );
          return;
        }

        const parts = parser.parseResponse(testCase.input as string, wrapped);
        assertPartsMatch(parts, testCase.expect as Array<Record<string, unknown>>);
      } else {
        throw new Error(`Unsupported action in direct_json conformance: ${action}`);
      }
    };

    if (isUnsupported) {
      test.skip(`${action} · ${name}`, runCase);
    } else if (KNOWN_FAILURES.has(`${action} · ${name}`)) {
      test.fails(
        `${action} · ${name} (known gap: ${KNOWN_FAILURES.get(`${action} · ${name}`)})`,
        runCase,
      );
    } else if (KNOWN_FAILURES.has(name)) {
      test.fails(`${action} · ${name} (known gap: ${KNOWN_FAILURES.get(name)})`, runCase);
    } else {
      test(`${action} · ${name}`, runCase);
    }
  }
});
