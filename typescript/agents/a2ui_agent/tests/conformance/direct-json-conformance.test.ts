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

import {resolve} from 'path';

import {expect} from 'vitest';

import {
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiValidationError,
  DirectJsonParser,
  ParseError,
  RawResponsePart,
  ResponsePart,
} from '../../src/index.js';
import {AgentToRendererMessage} from '../../src/internal/web-core.js';
import {CONFORMANCE_ROOT, loadCases} from './loader.js';
import {
  firstCatalogId,
  injectedCatalogId,
  liftMessages,
  liftParts,
  loadCatalogFromRelativePath,
  lowerMessages,
  lowerText,
} from './lowering.js';
import {compileChecked, forEachSuiteVersion} from './suite-helpers.js';

/** The error classes that count as each category the suites name. */
const ERRORS_BY_CATEGORY: Record<string, Array<new (...args: never[]) => Error>> = {
  ParseError: [ParseError, A2uiCompilationParseError],
  ValidationError: [A2uiValidationError, A2uiCompilationValidationError],
};

function assertThrows(fn: () => void, expectError: Record<string, unknown> | string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `Expected error ${JSON.stringify(expectError)}`).toBeInstanceOf(Error);
  const message = (thrown as Error).message;
  if (typeof expectError === 'string') {
    expect(message).toContain(expectError);
    return;
  }
  if (expectError.message) {
    if (expectError.message_is_regex) {
      expect(message).toMatch(new RegExp(expectError.message as string));
    } else {
      expect(message).toContain(expectError.message as string);
    }
  }
  if (expectError.category) {
    const classes = ERRORS_BY_CATEGORY[expectError.category as string];
    expect(classes, `Unknown error category ${String(expectError.category)}`).toBeDefined();
    expect(classes.some(errorClass => thrown instanceof errorClass)).toBe(true);
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
  lower = false,
  injId?: string,
): void {
  const liftedActual = lower ? liftParts(actualParts, {injectedCatalogId: injId}) : actualParts;
  expect(liftedActual.length).toBe(expectedParts.length);
  for (let i = 0; i < liftedActual.length; i++) {
    const actual = liftedActual[i];
    const expected = expectedParts[i];
    if (actual.type === 'text') {
      expect(actual.text).toBe(expected.text ?? '');
    } else {
      expect(actual.a2ui).toEqual(expected.a2ui);
    }
  }
}

const UNSUPPORTED = new Map<string, string>([]);
const KNOWN_FAILURES = new Map<string, string>([]);

forEachSuiteVersion(
  'Direct JSON Conformance Suite',
  loadCases([
    resolve(CONFORMANCE_ROOT, 'agent/direct_json/compiler.yaml'),
    resolve(CONFORMANCE_ROOT, 'agent/direct_json/decompiler.yaml'),
    resolve(CONFORMANCE_ROOT, 'agent/direct_json/response_parser.yaml'),
  ]),
  async (testCase, version) => {
    const isLowered = version === 'v0.9-lowered';
    const {action} = testCase;
    const args = (testCase.args as Record<string, unknown>) || {};
    const catalogPaths: string[] = [];
    if (Array.isArray(args.catalogs)) {
      catalogPaths.push(...(args.catalogs as string[]));
    } else if (typeof args.catalog === 'string') {
      catalogPaths.push(args.catalog);
    } else {
      catalogPaths.push('test_data/catalogs/simplified_catalog_v1_0.json');
    }
    const catalogs = catalogPaths.map(p => loadCatalogFromRelativePath(p, isLowered));
    const parser = new DirectJsonParser(catalogs);
    const injId = isLowered ? injectedCatalogId(testCase) : undefined;

    if (action === 'compile') {
      const rawInput = testCase.input as string;
      const payload = isLowered ? lowerText(rawInput, injId) : rawInput;

      if (testCase.expect_error) {
        assertThrows(
          () => {
            compileChecked(parser, payload);
          },
          testCase.expect_error as Record<string, unknown>,
        );
        return;
      }

      const rawCompiled = compileChecked(parser, payload);
      const compiled = isLowered
        ? liftMessages(rawCompiled, {injectedCatalogId: injId})
        : rawCompiled;

      if (testCase.expect_present) {
        for (const pointer of testCase.expect_present as string[]) {
          const val = resolvePointer(compiled, pointer);
          expect(val !== null && val !== undefined && val !== '').toBe(true);
          deletePointer(compiled, pointer);
        }
      }

      expect(compiled).toEqual(testCase.expect);
    } else if (action === 'decompile') {
      const origMessages = testCase.messages as AgentToRendererMessage[];
      const hasExplicitCatalogId = origMessages.some(
        m =>
          typeof m === 'object' &&
          m !== null &&
          'createSurface' in m &&
          typeof m.createSurface === 'object' &&
          m.createSurface !== null &&
          'catalogId' in m.createSurface,
      );
      const defaultCatId = firstCatalogId(args);
      const messages = isLowered
        ? lowerMessages(origMessages as unknown as Record<string, unknown>[], defaultCatId)
        : origMessages;

      const notation = parser.decompile(messages);

      if (testCase.expect_contains) {
        for (const fragment of testCase.expect_contains as string[]) {
          expect(notation).toContain(fragment);
        }
      }

      if (testCase.expect_round_trip) {
        const recompiled = compileChecked(parser, notation);
        const lifted = isLowered
          ? liftMessages(recompiled, {
              injectedCatalogId: hasExplicitCatalogId ? undefined : defaultCatId,
            })
          : recompiled;
        expect(lifted).toEqual(origMessages);
      }
    } else if (action === 'unwrap') {
      const expected = testCase.expect as Array<Record<string, unknown>>;
      const actual = parser.unwrap(testCase.input as string);
      assertRawPartsMatch(actual, expected);
      const hasAny = expected.some(p => 'a2ui_raw' in p);
      const hasComplete = expected.some(p => 'a2ui_raw' in p && (p.is_final ?? true) === true);
      expect(parser.hasFormatContent(testCase.input as string)).toBe(hasAny);
      expect(parser.hasFormatContent(testCase.input as string, {complete: true})).toBe(hasComplete);
    } else if (action === 'has_format_content') {
      const complete = (args.complete as boolean) ?? false;
      expect(parser.hasFormatContent(testCase.input as string, {complete})).toBe(testCase.expect);
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
      const rawInput = testCase.input as string;
      const payload = isLowered ? lowerText(rawInput, injId) : rawInput;

      if (testCase.expect_error) {
        assertThrows(
          () => {
            parser.parseResponse(payload, {wrapped});
          },
          testCase.expect_error as Record<string, unknown>,
        );
        return;
      }

      const parts = parser.parseResponse(payload, {wrapped});
      assertPartsMatch(parts, testCase.expect as Array<Record<string, unknown>>, isLowered, injId);
    } else {
      throw new Error(`Unsupported action in direct_json conformance: ${action}`);
    }
  },
  {
    knownFailures: KNOWN_FAILURES,
    skipReason: testCase => UNSUPPORTED.get(testCase.name),
  },
);
