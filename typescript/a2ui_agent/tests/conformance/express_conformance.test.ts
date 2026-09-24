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

import * as fs from 'fs';
import * as path from 'path';
import {describe, test, expect} from 'vitest';
import {CONFORMANCE_ROOT, loadCases} from './loader.js';
import {createFileCatalogConfig} from './fixtures.js';
import {Catalog} from '../../src/internal/web_core.js';
import {registerCatalogDocument} from '../../src/utils/catalog_document.js';
import {
  A2uiCatalogError,
  A2uiCompilationError,
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiValidationError,
  AgentToRendererMessage,
  ComponentPruningTransformer,
  ExpressFormat,
  ExpressParser,
  ExpressPromptGenerator,
  FunctionPruningTransformer,
  ParseError,
  RawResponsePart,
  ResponsePart,
  SchemaCatalog,
} from '../../src/index.js';
import type {ExpressPromptOptions} from '../../src/inference_formats/express/prompt_generator.js';

const CONFORMANCE_SURFACE_ID = 'default_surface';
const DEFAULT_CATALOG = 'test_data/catalogs/simplified_catalog_v1_0.json';

/**
 * Conformance cases that fail because TS follows Python's behavior.
 * Registered with test.fails and Python's reason.
 */
const KNOWN_FAILURES = new Map<string, string>([]);

/**
 * Cases Python skips as UNSUPPORTED.
 */
const UNSUPPORTED = new Map<string, string>([
  [
    'test_compile_express_surface_targeting_names_a_catalog',
    'a parser holds one catalog, so a block targeting a second catalog by id cannot be compiled',
  ],
]);

function assertThrows(fn: () => void, expectError: Record<string, unknown> | string): void {
  if (typeof expectError === 'string') {
    expect(fn).toThrowError(expectError);
    return;
  }

  const category = expectError.category as string;
  let thrownError: unknown;
  try {
    fn();
  } catch (e) {
    thrownError = e;
  }

  expect(thrownError, `Expected error of category ${category} to be thrown`).toBeDefined();

  if (category === 'ParseError') {
    const isParseErr =
      thrownError instanceof A2uiCompilationParseError || thrownError instanceof ParseError;
    expect(isParseErr, `Expected ParseError or A2uiCompilationParseError, got ${thrownError}`).toBe(
      true,
    );
  } else if (category === 'ValidationError') {
    const isValidationErr =
      thrownError instanceof A2uiCompilationValidationError ||
      thrownError instanceof A2uiValidationError;
    expect(
      isValidationErr,
      `Expected ValidationError or A2uiCompilationValidationError, got ${thrownError}`,
    ).toBe(true);
  } else if (category === 'CatalogError') {
    expect(thrownError).toBeInstanceOf(A2uiCatalogError);
  } else if (category === 'CompilationError') {
    expect(thrownError).toBeInstanceOf(A2uiCompilationError);
  } else {
    expect(thrownError).toBeInstanceOf(Error);
  }

  if (expectError.message) {
    expect((thrownError as Error).message).toMatch(new RegExp(expectError.message as string));
  }
}

function resolvePointer(payload: unknown, pointer: string): unknown {
  let current: unknown = payload;
  for (const token of pointer.replace(/^\/|\/$/g, '').split('/')) {
    if (Array.isArray(current)) {
      current = current[parseInt(token, 10)];
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current;
}

function deletePointer(payload: unknown, pointer: string): void {
  const tokens = pointer.replace(/^\/|\/$/g, '').split('/');
  let current: unknown = payload;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      current = current[parseInt(token, 10)];
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    }
  }
  const lastToken = tokens[tokens.length - 1];
  if (Array.isArray(current)) {
    current.splice(parseInt(lastToken, 10), 1);
  } else if (current && typeof current === 'object') {
    delete (current as Record<string, unknown>)[lastToken];
  }
}

async function getParser(args: Record<string, unknown> = {}): Promise<ExpressParser> {
  const catalogPath = (args.catalog as string) || DEFAULT_CATALOG;
  const config = await createFileCatalogConfig(catalogPath);
  return new ExpressParser(config.catalog, CONFORMANCE_SURFACE_ID, 'v1.0');
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

describe('Express Conformance Suite', () => {
  const files = [
    path.resolve(CONFORMANCE_ROOT, 'agent/express/compiler.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/express/decompiler.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/express/response_parser.yaml'),
    path.resolve(CONFORMANCE_ROOT, 'agent/express/prompt_generator.yaml'),
  ];

  const cases = loadCases(files);

  for (const testCase of cases) {
    const {name, action} = testCase;
    const isUnsupported = UNSUPPORTED.has(name);
    const isKnownFailure = KNOWN_FAILURES.has(name);

    const runCase = async () => {
      const args = (testCase.args as Record<string, unknown>) || {};

      if (action === 'compile') {
        const parser = await getParser(args);
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
        const parser = await getParser(args);
        const messages = testCase.messages as AgentToRendererMessage[];

        const notation = parser.decompile(messages.length > 1 ? messages : messages[0]);

        if (testCase.expect_contains) {
          for (const fragment of testCase.expect_contains as string[]) {
            expect(notation).toContain(fragment);
          }
        }

        if (testCase.expect_round_trip) {
          expect(parser.compile(notation)).toEqual(messages);
        }
      } else if (action === 'unwrap') {
        const parser = await getParser(args);
        const actual = parser.unwrap(testCase.input as string);
        assertRawPartsMatch(actual, testCase.expect as Array<Record<string, unknown>>);
      } else if (action === 'wrap') {
        const parser = await getParser(args);
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
        const parser = await getParser(args);
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
      } else if (action === 'generate_prompt_snippet') {
        const catEntries =
          (args.catalogs as Array<{
            catalog: string;
            transformers?: Array<Record<string, string[]>>;
          }>) || [];

        if (testCase.expect_error) {
          assertThrows(
            () => {
              new ExpressFormat([]);
            },
            testCase.expect_error as Record<string, unknown>,
          );
          return;
        }

        const loadedCatalogs: SchemaCatalog[] = [];
        for (const entry of catEntries) {
          const fullPath = path.resolve(CONFORMANCE_ROOT, entry.catalog);
          const schema = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          let catalog = Catalog.fromSchema(schema);
          registerCatalogDocument(catalog, schema);

          if (entry.transformers) {
            for (const trans of entry.transformers) {
              if (trans.component_pruning) {
                catalog = new ComponentPruningTransformer(trans.component_pruning).transform(
                  catalog,
                );
              }
              if (trans.function_pruning) {
                catalog = new FunctionPruningTransformer(trans.function_pruning).transform(catalog);
              }
            }
          }
          loadedCatalogs.push(catalog);
        }

        let examples: Record<string, AgentToRendererMessage[]> | undefined;
        if (Array.isArray(args.examples) && args.examples.length > 0) {
          examples = {};
          for (const exPath of args.examples as string[]) {
            const fullExPath = path.resolve(CONFORMANCE_ROOT, exPath);
            const exContent = JSON.parse(fs.readFileSync(fullExPath, 'utf8'));
            const messages = Array.isArray(exContent) ? exContent : [exContent];
            const catId = messages[0]?.createSurface?.catalogId || loadedCatalogs[0]?.id;
            if (catId) {
              examples[catId] = messages;
            }
          }
        }

        const generator = new ExpressPromptGenerator(loadedCatalogs, examples);
        const options: ExpressPromptOptions = {};
        if (args.allowed_messages) {
          options.allowedMessages = args.allowed_messages as string[];
        }
        if (args.examples) {
          options.includeExamples = true;
        }

        const output = generator.generate(options);

        if (testCase.expect_contains) {
          for (const fragment of testCase.expect_contains as string[]) {
            expect(output).toContain(fragment);
          }
        }
        if (testCase.expect_absent) {
          for (const fragment of testCase.expect_absent as string[]) {
            expect(output).not.toContain(fragment);
          }
        }
        if (testCase.expect_deterministic) {
          const secondOutput = generator.generate(options);
          expect(output).toBe(secondOutput);
        }
      } else {
        throw new Error(`Unsupported action in express conformance: ${action}`);
      }
    };

    if (isUnsupported) {
      test.skip(`${action} · ${name}`, runCase);
    } else if (isKnownFailure) {
      test.fails(`${action} · ${name}`, runCase);
    } else {
      test(`${action} · ${name}`, runCase);
    }
  }
});
