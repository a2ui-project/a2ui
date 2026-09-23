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
import {loadCases, classify, CONFORMANCE_ROOT, KNOWN_FAILURES} from './loader.js';
import {createCatalogConfig, createFileCatalogConfig} from './fixtures.js';
import {
  A2uiValidationError,
  A2uiCatalogError,
  A2uiRecursionError,
  ParseError,
  ResponsePart,
  basicCatalog,
  resolveCatalogs,
} from '../../src/index.js';
import {V10RendererCapabilities} from '../../src/internal/web_core.js';
import {DirectJsonParser} from '../../src/inference_formats/direct_json/parser.js';
import {DirectJsonStreamProcessorImpl} from '../../src/inference_formats/direct_json/streaming.js';

import {parseAndFix} from '../../src/parser/payload_fixer.js';

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
    const ErrorClass = CATEGORY_TO_ERROR[expectError.category as string] || Error;
    expect(fn).toThrowError(ErrorClass);
    if (expectError.message) {
      expect(fn).toThrowError(expectError.message as string);
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
      const adapted: any = {a2ui: part.a2ui};
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

describe('Conformance Harness', () => {
  const yamlFiles = [
    path.resolve(CONFORMANCE_ROOT, 'agent/parser.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/streaming_parser.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/inference_format.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/skill.yaml'),
  ];

  const allCases = loadCases(yamlFiles);

  for (const testCase of allCases) {
    const verdict = classify(testCase);
    const {action, name} = testCase;
    const input = testCase.input as string;
    const expected = testCase.expect as Record<string, unknown> | Record<string, unknown>[];
    const expectError = testCase.expectError as Record<string, unknown> | string;
    const testName = `${action} · ${name}`;

    const testFn = async () => {
      if (action === 'parse_full') {
        const catalog = testCase.catalog
          ? (await createCatalogConfig(testCase.catalog as Record<string, unknown>)).catalog
          : basicCatalog();
        const parser = new DirectJsonParser(catalog);

        if (expectError) {
          assertThrows(() => {
            parser.parseResponse(input);
          }, expectError);
        } else {
          const parts = parser.parseResponse(input);
          const adapted = adaptParts(parts);
          const expectedParts = expected as Record<string, unknown>[];
          expect(adapted.length).toBe(expectedParts.length);
          for (let i = 0; i < adapted.length; i++) {
            expect(((adapted[i].text as string) || '').trim()).toBe(
              ((expectedParts[i].text as string) || '').trim(),
            );
            expect(adapted[i].a2ui).toEqual(expectedParts[i].a2ui);
          }
        }
      } else if (action === 'fix_payload') {
        if (expectError) {
          assertThrows(() => {
            parseAndFix(input);
          }, expectError);
        } else {
          const result = parseAndFix(input);
          expect(result).toEqual(expected);
        }
      } else if (action === 'has_parts') {
        const catalog = basicCatalog();
        const parser = new DirectJsonParser(catalog);
        const result = parser.hasA2uiParts(input);
        expect(result).toBe(expected);
      } else if (action === 'load_catalog') {
        const expectedObj = expected as Record<string, unknown>;
        const configs = await Promise.all(
          ((testCase.catalogConfigs as Record<string, unknown>[]) || []).map(async cfg => {
            return await createFileCatalogConfig(
              cfg.path as string,
              (testCase.modifiers as string[]) || [],
            );
          }),
        );
        if (expectedObj.supportedCatalogIds) {
          expect(configs.map(c => c.catalog.id)).toEqual(expectedObj.supportedCatalogIds);
        } else {
          const selected = resolveCatalogs(configs, {
            supportedCatalogIds: [],
          } as unknown as V10RendererCapabilities)[0];
          expect(selected.id).toBe(expectedObj.catalogId);
          if (expectedObj.components) {
            for (const [k, v] of Object.entries(
              expectedObj.components as Record<string, unknown>,
            )) {
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
      } else if (action === 'select_catalog') {
        const args = (testCase.args as Record<string, unknown>) || {};
        const supportedCatalogs = (args.supportedCatalogs as Record<string, unknown>[]) || [];
        const configs = await Promise.all(
          supportedCatalogs.map(async c => {
            return await createCatalogConfig({
              name: c.catalogId,
              protocolVersion: 'v1.0',
              catalogSchema: {components: c.components || {}},
            });
          }),
        );
        const capabilities = (args.clientCapabilities || {}) as unknown as V10RendererCapabilities;
        const acceptsInline = (args.acceptsInlineCatalogs as boolean) || false;
        const expectedObj = expected as Record<string, unknown>;

        if (expectError) {
          assertThrows(() => resolveCatalogs(configs, capabilities, acceptsInline), expectError);
        } else {
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
      } else if (action === 'process_chunk') {
        const catalogConfig = testCase.catalog
          ? await createCatalogConfig(testCase.catalog as Record<string, unknown>)
          : undefined;
        const catalog = catalogConfig?.catalog || basicCatalog();
        const processor = new DirectJsonStreamProcessorImpl(catalog, {
          progressiveKeys: ['text', 'literalString'],
        });

        for (const step of testCase.steps as any[]) {
          if (step.expectError) {
            assertThrows(() => processor.processChunk(step.input), step.expectError);
          } else if (step.expect) {
            const result = processor.processChunk(step.input);
            const adapted = adaptParts(result);
            expect(adapted).toEqual(step.expect);
          } else {
            processor.processChunk(step.input);
          }
        }
      } else if (action === 'generate_prompt' || action === 'skill') {
        throw new Error('Should not be executed');
      }
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
