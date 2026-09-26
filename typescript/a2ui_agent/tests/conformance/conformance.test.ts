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
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiRecursionError,
  ExpressParser,
  ParseError,
  ResponsePart,
  basicCatalog,
  resolveCatalogs,
  DirectJsonPromptGenerator,
} from '../../src/index.js';
import {V10RendererCapabilities} from '../../src/internal/web_core.js';
import {DirectJsonParser} from '../../src/inference_formats/direct_json/parser.js';
import {DirectJsonStreamProcessorImpl} from '../../src/inference_formats/direct_json/streaming.js';
import {toWireProtocolVersion} from '../../src/utils/protocol_version.js';

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
    path.resolve(CONFORMANCE_ROOT, 'agent/legacy/parser.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/legacy/streaming_parser.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/legacy/inference_format.yaml'),
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
        let parser: DirectJsonParser | ExpressParser;
        if (testCase.format === 'express') {
          // As Python's harness does (python/a2ui_agent/tests/conformance/test_conformance.py:385-402),
          // formatted cases compile against the basic catalog of the case's protocol version.
          const version = toWireProtocolVersion(
            (testCase.catalog as Record<string, unknown> | undefined)?.protocolVersion as
              | string
              | undefined,
          );
          parser = new ExpressParser(basicCatalog(version));
        } else {
          const catalog = testCase.catalog
            ? (await createCatalogConfig(testCase.catalog as Record<string, unknown>)).catalog
            : basicCatalog();
          parser = new DirectJsonParser(catalog);
        }

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
        const parser =
          testCase.format === 'express'
            ? new ExpressParser(catalog)
            : new DirectJsonParser(catalog);
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
        const catalogObj = testCase.catalog as Record<string, unknown> | undefined;
        const progressiveKeys = (catalogObj?.customCuttableKeys as string[] | undefined) ?? [
          'text',
          'literalString',
        ];
        const processor = new DirectJsonStreamProcessorImpl(catalog, {
          progressiveKeys,
          disableValidation: Boolean(testCase.disableValidation),
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
      } else if (action === 'generate_prompt') {
        const args = (testCase.args as Record<string, unknown>) || {};

        // Python's runner also threads examplesPath, acceptsInlineCatalogs,
        // clientUiCapabilities, allowedComponents and allowedMessages into prompt
        // generation. This harness does not, and the TypeScript generator has no equivalent
        // for several of them. Every case that uses one is v0.8, which the loader skips, so
        // none currently reach here. Refuse them rather than quietly generating a prompt
        // that ignores them, so enabling those cases surfaces the gap instead of a
        // mysterious assertion failure.
        const unsupportedArgs = [
          'examplesPath',
          'acceptsInlineCatalogs',
          'clientUiCapabilities',
          'allowedComponents',
          'allowedMessages',
        ].filter(key => key in args);
        if (unsupportedArgs.length > 0) {
          throw new Error(
            `generate_prompt argument(s) not implemented by this harness: ` +
              `${unsupportedArgs.join(', ')}. See Python's runner for the intended semantics.`,
          );
        }

        const versionStr = (args.version as string) || 'v0.9';
        const catalog = basicCatalog(toWireProtocolVersion(versionStr));
        const generator = new DirectJsonPromptGenerator([catalog]);

        const output = generator.generate({
          roleDescription: args.roleDescription as string | undefined,
          workflowDescription: args.workflowDescription as string | undefined,
          uiDescription: args.uiDescription as string | undefined,
          includeSchema: args.includeSchema as boolean | undefined,
          includeExamples: args.includeExamples as boolean | undefined,
        });

        const outputNormalized = output.replace(/\s+/g, '');
        const expectContains = testCase.expectContains as string[] | undefined;
        if (expectContains) {
          for (const expectedStr of expectContains) {
            const expectedNormalized = expectedStr.replace(/\s+/g, '');
            expect(outputNormalized, `Expected prompt to contain '${expectedStr}'`).toContain(
              expectedNormalized,
            );
          }
        }
      } else if (action === 'skill') {
        throw new Error('Should not be executed');
      } else {
        throw new Error(`Unhandled conformance action: ${action}`);
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
