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

import {describe, expect, test} from 'vitest';

import {
  A2uiCatalogError,
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiRecursionError,
  A2uiValidationError,
  ExpressParser,
  ParseError,
  resolveCatalogs,
  ResponsePart,
} from '../../src/index.js';
import {DirectJsonParser} from '../../src/inference-formats/direct-json/parser.js';
import {V10RendererCapabilities} from '../../src/internal/web-core.js';
import {parseAndFix} from '../../src/parser/payload-fixer.js';
import {toWireProtocolVersion} from '../../src/utils/protocol-version.js';
import {loadBasicCatalog} from '../helpers/basic-catalogs.js';
import {createCatalogConfig, createFileCatalogConfig} from './fixtures.js';
import {classify, KNOWN_FAILURES, loadCases, LoadedCase} from './loader.js';
import {conformancePath} from './suite-helpers.js';

// Cases that name no catalog run against the v1.0 basic catalog.
const basicCatalogV10 = loadBasicCatalog('v1.0');
const basicCatalogV09 = loadBasicCatalog('v0.9');

// We map category strings to actual error classes for assertions
const CATEGORY_TO_ERROR: Record<string, new (...args: string[]) => Error> = {
  'ParseError': ParseError,
  'ValidationError': A2uiValidationError,
  'CatalogError': A2uiCatalogError,
  'RecursionError': A2uiRecursionError,
};

function assertThrows(fn: () => void, expectError: Record<string, unknown> | string) {
  if (typeof expectError === 'string') {
    expect(fn).toThrowError(expectError);
  } else {
    const category = expectError.category as string;
    let thrownError: unknown;
    try {
      fn();
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeDefined();
    if (category === 'ParseError') {
      expect(
        thrownError instanceof ParseError || thrownError instanceof A2uiCompilationParseError,
      ).toBe(true);
    } else if (category === 'ValidationError') {
      expect(
        thrownError instanceof A2uiValidationError ||
          thrownError instanceof A2uiCompilationValidationError,
      ).toBe(true);
    } else {
      const ErrorClass = CATEGORY_TO_ERROR[category] || Error;
      expect(thrownError).toBeInstanceOf(ErrorClass);
    }
    if (expectError.message) {
      expect((thrownError as Error).message).toContain(expectError.message as string);
    }
  }
}

// Adapts our TS structured union ResponsePart[] into the Python-flat shape expected by YAML.
function adaptParts(parts: ResponsePart[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let pendingText = '';

  for (const part of parts) {
    if (part.type === 'text') {
      pendingText += part.text;
    } else if (part.type === 'a2ui') {
      const adapted: Record<string, unknown> = {a2ui: part.a2ui};
      if (pendingText) adapted.text = pendingText;
      result.push(adapted);
      pendingText = '';
    }
  }

  if (pendingText) {
    result.push({text: pendingText});
  }

  return result;
}

function assertAdaptedPartsEqual(
  adapted: Record<string, unknown>[],
  expectedParts: Record<string, unknown>[],
): void {
  expect(adapted.length).toBe(expectedParts.length);
  for (let i = 0; i < adapted.length; i++) {
    expect(((adapted[i].text as string) || '').trim()).toBe(
      ((expectedParts[i].text as string) || '').trim(),
    );
    expect(adapted[i].a2ui).toEqual(expectedParts[i].a2ui);
  }
}

function runParseFullCase(testCase: LoadedCase): void {
  const input = testCase.input as string;
  const expected = testCase.expect as Record<string, unknown>[];
  const expectError = testCase.expectError as Record<string, unknown> | string | undefined;

  if (testCase.format === 'express') {
    const declared = (testCase.catalog as Record<string, unknown> | undefined)?.protocolVersion as
      | string
      | undefined;
    const version = declared ? toWireProtocolVersion(declared) : 'v1.0';
    const parser = new ExpressParser(version === 'v0.9' ? basicCatalogV09 : basicCatalogV10);

    if (expectError) {
      assertThrows(() => {
        parser.parseResponse(input);
      }, expectError);
    } else {
      const parts = parser.parseResponse(input);
      assertAdaptedPartsEqual(adaptParts(parts), expected);
    }
    return;
  }

  const catalog = testCase.catalog
    ? createCatalogConfig(testCase.catalog as Record<string, unknown>).catalog
    : basicCatalogV10;
  const parser = new DirectJsonParser([catalog]);

  const parseUnwrappedParts = (): ResponsePart[] => {
    const unwrapped = parser.unwrap(input);
    const parts: ResponsePart[] = [];
    for (const p of unwrapped) {
      if (p.type === 'a2ui') {
        const fixed = parseAndFix(p.a2uiRaw);
        parts.push({type: 'a2ui', a2uiRaw: p.a2uiRaw, a2ui: fixed, isFinal: true});
      } else {
        parts.push(p);
      }
    }
    return parts;
  };

  if (expectError) {
    assertThrows(parseUnwrappedParts, expectError);
  } else {
    assertAdaptedPartsEqual(adaptParts(parseUnwrappedParts()), expected);
  }
}

function runFixPayloadCase(testCase: LoadedCase): void {
  const input = testCase.input as string;
  const expected = testCase.expect;
  const expectError = testCase.expectError as Record<string, unknown> | string | undefined;

  if (expectError) {
    assertThrows(() => {
      parseAndFix(input);
    }, expectError);
  } else {
    expect(parseAndFix(input)).toEqual(expected);
  }
}

function runHasPartsCase(testCase: LoadedCase): void {
  const input = testCase.input as string;
  const expected = testCase.expect;
  const catalog = basicCatalogV10;
  const parser =
    testCase.format === 'express' ? new ExpressParser(catalog) : new DirectJsonParser([catalog]);
  expect(parser.hasFormatContent(input, {complete: true})).toBe(expected);
}

function runLoadCatalogCase(testCase: LoadedCase): void {
  const expectedObj = testCase.expect as Record<string, unknown>;
  const configs = ((testCase.catalogConfigs as Record<string, unknown>[]) || []).map(cfg =>
    createFileCatalogConfig(cfg.path as string),
  );
  if (expectedObj.supportedCatalogIds) {
    expect(configs.map(c => c.catalog.id)).toEqual(expectedObj.supportedCatalogIds);
    return;
  }

  // The legacy manager used the first configured catalog when nothing was negotiated.
  const selected = configs[0].transformedCatalog;
  expect(selected.id).toBe(expectedObj.catalogId);
  if (expectedObj.components) {
    for (const [k, v] of Object.entries(expectedObj.components as Record<string, unknown>)) {
      const comp = Array.from(selected.components.values()).find(c => c.name === k);
      expect(comp).toBeDefined();

      // Assert that the transformed schema correctly applies or drops strict validation
      if (comp && comp.schema) {
        // A payload with a known required field and an unknown field
        const testPayload = {text: 'test', unknownProp: 123};
        if ((v as Record<string, unknown>).additionalProperties === false) {
          expect(() => comp.schema!.parse(testPayload)).toThrow();
        } else {
          expect(() => comp.schema!.parse(testPayload)).not.toThrow();
        }
      }
    }
  }
}

function runSelectCatalogCase(testCase: LoadedCase): void {
  const args = (testCase.args as Record<string, unknown>) || {};
  const supportedCatalogs = (args.supportedCatalogs as Record<string, unknown>[]) || [];
  const configs = supportedCatalogs.map(c =>
    createCatalogConfig({
      name: c.catalogId,
      protocolVersion: 'v1.0',
      catalogSchema: {components: c.components || {}},
    }),
  );
  const capabilities = (args.clientCapabilities || {}) as unknown as V10RendererCapabilities;
  const acceptsInline = (args.acceptsInlineCatalogs as boolean) || false;
  const expectedObj = testCase.expect as Record<string, unknown> | undefined;
  const expectError = testCase.expectError as Record<string, unknown> | string | undefined;

  if (expectError) {
    assertThrows(() => resolveCatalogs(configs, capabilities, acceptsInline), expectError);
    return;
  }

  const activeCatalogs = resolveCatalogs(configs, capabilities, acceptsInline);
  const base = activeCatalogs[0];

  if (testCase.expectSelected) {
    expect(base.id).toBe(testCase.expectSelected);
  }
  if (expectedObj && expectedObj.catalogId) {
    expect(base.id).toBe(expectedObj.catalogId);
  }
  if (expectedObj && expectedObj.components) {
    for (const [k] of Object.entries(expectedObj.components as Record<string, unknown>)) {
      let found = false;
      for (const cat of activeCatalogs) {
        if (Array.from(cat.components.values()).find(c => c.name === k)) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  }
}

const LEGACY_ACTION_HANDLERS: Record<string, (testCase: LoadedCase) => void | Promise<void>> = {
  parse_full: runParseFullCase,
  fix_payload: runFixPayloadCase,
  has_parts: runHasPartsCase,
  load_catalog: runLoadCatalogCase,
  select_catalog: runSelectCatalogCase,
};

describe('Conformance Harness (Legacy Agent Suites)', () => {
  const yamlFiles = [
    conformancePath('agent/legacy/parser.yaml'),
    conformancePath('agent/legacy/inference_format.yaml'),
  ];

  const allCases = loadCases(yamlFiles);

  for (const testCase of allCases) {
    const verdict = classify(testCase);
    const {action, name} = testCase;
    const testName = `${action} · ${name}`;

    const testFn = async () => {
      const handler = LEGACY_ACTION_HANDLERS[action];
      if (!handler) {
        throw new Error(`Unhandled conformance action: ${action}`);
      }
      await handler(testCase);
    };

    if (!verdict.runnable) {
      test.skip(`${testName} (${verdict.reason})`, testFn);
    } else if (KNOWN_FAILURES.has(name)) {
      test.fails(`${testName} (known gap: ${KNOWN_FAILURES.get(name)})`, testFn);
    } else {
      test(testName, testFn);
    }
  }
});
