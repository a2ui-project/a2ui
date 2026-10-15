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

import * as fs from 'fs';
import {describe, expect, test} from 'vitest';

import {
  A2uiCatalogError,
  A2uiCompilationError,
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiGenerator,
  A2uiValidationError,
  AgentToRendererMessage,
  CatalogConfig,
  CatalogTransformer,
  ComponentPruningTransformer,
  DirectJsonFormat,
  DirectJsonFormatFactory,
  ExpressFormat,
  ExpressFormatFactory,
  FileSystemCatalogProvider,
  FunctionPruningTransformer,
  InMemoryCatalogProvider,
  InferenceFormat,
  InferenceFormatFactory,
  ParseError,
  Parser,
  ResponsePart,
} from '../../src/index.js';
import {CatalogApi, RendererCapabilities} from '../../src/internal/web-core.js';
import {loadCases, LoadedCase} from './loader.js';
import {CatalogRegistration, conformancePath, expectCatalogContents} from './suite-helpers.js';

const CONFORMANCE_SURFACE_ID = 'default_surface';
const DEFAULT_CATALOG = 'test_data/catalogs/simplified_catalog_v1_0.json';

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
    const message = thrownError instanceof Error ? thrownError.message : String(thrownError);
    expect(message).toMatch(new RegExp(expectError.message as string));
  }
}

function loadCatalogConfig(entry: unknown): CatalogConfig {
  const transformers: CatalogTransformer[] = [];
  let ref: unknown = entry;
  if (ref && typeof ref === 'object' && 'catalog' in (ref as Record<string, unknown>)) {
    const reg = ref as CatalogRegistration;
    for (const t of reg.transformers ?? []) {
      if (t.component_pruning) {
        transformers.push(new ComponentPruningTransformer(t.component_pruning));
      }
      if (t.function_pruning) {
        transformers.push(new FunctionPruningTransformer(t.function_pruning));
      }
    }
    ref = reg.catalog;
  }

  if (ref && typeof ref === 'object') {
    const rawDoc = ref as Record<string, unknown>;
    const doc = {
      protocolVersion: 'v1.0',
      catalogId: 'inline',
      ...rawDoc,
    };
    const catalog = new InMemoryCatalogProvider(doc).load();
    return new CatalogConfig(catalog, transformers);
  }

  if (typeof ref !== 'string') {
    throw new Error(`Invalid catalog reference: expected string, got ${typeof ref}`);
  }
  const catalog = new FileSystemCatalogProvider(conformancePath(ref)).load();
  return new CatalogConfig(catalog, transformers);
}

function loadCatalogs(args: Record<string, unknown>): CatalogApi[] {
  if (Array.isArray(args.catalogs)) {
    return args.catalogs.map(entry => loadCatalogConfig(entry).transformedCatalog);
  }
  if (args.catalog !== undefined) {
    return [loadCatalogConfig(args.catalog).transformedCatalog];
  }
  return [];
}

function loadExamples(
  examplePaths: string[] | undefined,
  catalogs: CatalogApi[],
): Record<string, AgentToRendererMessage[]> | undefined {
  if (!examplePaths || examplePaths.length === 0) {
    return undefined;
  }
  const examples: Record<string, AgentToRendererMessage[]> = {};
  for (let i = 0; i < examplePaths.length; i++) {
    const fullPath = conformancePath(examplePaths[i]);
    const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const messages: AgentToRendererMessage[] = Array.isArray(content) ? content : [content];
    const firstSurfaceCatId = (messages[0] as {createSurface?: {catalogId?: string}} | undefined)
      ?.createSurface?.catalogId;
    const key = firstSurfaceCatId || catalogs[0]?.id || `example_${i}`;
    if (examples[key]) {
      examples[`${key}_${i}`] = messages;
    } else {
      examples[key] = messages;
    }
  }
  return examples;
}

function makeFormat(args: Record<string, unknown>): InferenceFormat {
  const catalogs =
    'catalogs' in args || 'catalog' in args
      ? loadCatalogs(args)
      : loadCatalogs({catalog: DEFAULT_CATALOG});

  if (catalogs.length === 0) {
    throw new A2uiCatalogError('At least one active catalog is required.');
  }

  const examples = loadExamples(args.examples as string[] | undefined, catalogs);
  const formatName = (args.format as string) ?? 'direct_json';

  if (formatName === 'express') {
    return new ExpressFormat(catalogs, {
      surfaceId: CONFORMANCE_SURFACE_ID,
      examples,
    });
  }
  if (formatName === 'direct_json') {
    return new DirectJsonFormat(catalogs, examples);
  }
  throw new Error(`Unsupported format: ${formatName}`);
}

function makeFactory(formatName: string): InferenceFormatFactory {
  if (formatName === 'express') {
    return new ExpressFormatFactory({surfaceId: CONFORMANCE_SURFACE_ID});
  }
  if (formatName === 'direct_json') {
    return new DirectJsonFormatFactory();
  }
  throw new Error(`Unsupported format: ${formatName}`);
}

function sortComponentsById(
  messages: AgentToRendererMessage[] | undefined,
): AgentToRendererMessage[] {
  return (messages ?? []).map(msg => {
    if (!msg || typeof msg !== 'object') {
      return msg;
    }
    const cloned = structuredClone(msg) as Record<string, unknown>;
    for (const key of ['createSurface', 'updateComponents']) {
      const body = cloned[key] as Record<string, unknown> | undefined;
      if (body && Array.isArray(body.components)) {
        body.components = [...body.components].sort((a, b) =>
          String((a as {id?: unknown}).id ?? '').localeCompare(
            String((b as {id?: unknown}).id ?? ''),
          ),
        );
      }
    }
    return cloned as unknown as AgentToRendererMessage;
  });
}

function expectSnippet(
  snippet: string,
  contains?: string[] | null,
  absent?: string[] | null,
): void {
  for (const fragment of contains ?? []) {
    expect(snippet, `Expected snippet to contain ${JSON.stringify(fragment)}`).toContain(fragment);
  }
  for (const fragment of absent ?? []) {
    expect(snippet, `Expected snippet NOT to contain ${JSON.stringify(fragment)}`).not.toContain(
      fragment,
    );
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
      expect(sortComponentsById(actual.a2ui)).toEqual(
        sortComponentsById(expected.a2ui as AgentToRendererMessage[]),
      );
    }
  }
}

function describeConfigs(
  configs: CatalogConfig[],
): Array<{id: string; components: string[]; functions: string[]}> {
  return configs.map(config => {
    const cat = config.transformedCatalog;
    return {
      id: cat.id,
      components: [...cat.components.keys()].sort(),
      functions: [...cat.functions.keys()].sort(),
    };
  });
}

function runFormatCase(testCase: LoadedCase): void {
  const action = testCase.action;
  const args = (testCase.args as Record<string, unknown>) || {};

  if (action === 'compile') {
    const parser: Parser = makeFormat(args).createParser();
    if (testCase.expect_error) {
      assertThrows(
        () => {
          parser.compile(testCase.input as string);
        },
        testCase.expect_error as Record<string, unknown>,
      );
      return;
    }
    const compiled = parser.compile(testCase.input as string);
    expect(sortComponentsById(compiled)).toEqual(
      sortComponentsById(testCase.expect as AgentToRendererMessage[]),
    );
  } else if (action === 'decompile') {
    const parser: Parser = makeFormat(args).createParser();
    const messages = testCase.messages as AgentToRendererMessage[];
    const notation = parser.decompile(messages);
    expectSnippet(
      notation,
      testCase.expect_contains as string[] | undefined,
      testCase.expect_absent as string[] | undefined,
    );
    if (testCase.expect_round_trip) {
      const recompiled = parser.compile(notation);
      expect(sortComponentsById(recompiled)).toEqual(sortComponentsById(messages));
    }
  } else if (action === 'parse_response') {
    const parser: Parser = makeFormat(args).createParser();
    if (testCase.expect_error) {
      assertThrows(
        () => {
          parser.parseResponse(testCase.input as string);
        },
        testCase.expect_error as Record<string, unknown>,
      );
      return;
    }
    const parts = parser.parseResponse(testCase.input as string);
    assertPartsMatch(parts, testCase.expect as Array<Record<string, unknown>>);
  } else if (action === 'generate_prompt_snippet') {
    if (testCase.expect_error) {
      assertThrows(
        () => {
          makeFormat(args).promptGenerator.generate();
        },
        testCase.expect_error as Record<string, unknown>,
      );
      return;
    }
    const fmt = makeFormat(args);
    const snippet = fmt.promptGenerator.generate();
    expectSnippet(
      snippet,
      testCase.expect_contains as string[] | undefined,
      testCase.expect_absent as string[] | undefined,
    );
    if (testCase.expect_deterministic) {
      expect(fmt.promptGenerator.generate()).toBe(snippet);
    }
  } else if (action === 'create_format') {
    if (testCase.expect_error) {
      assertThrows(
        () => {
          makeFormat(args);
        },
        testCase.expect_error as Record<string, unknown>,
      );
      return;
    }
    const fmt = makeFormat(args);
    const expected = (testCase.expect as Record<string, unknown>) || {};

    if (expected.parsers_are_distinct) {
      expect(fmt.createParser()).not.toBe(fmt.createParser());
    }
    if (expected.parser_state_isolated) {
      const chunks = args.probe_chunks as string[];
      const read = (p: Parser) => chunks.map(chunk => p.parseChunk(chunk));
      const firstParts = read(fmt.createParser());
      expect(firstParts.some(arr => arr.length > 0)).toBe(true);
      expect(read(fmt.createParser())).toEqual(firstParts);
    }
    const snippet = fmt.promptGenerator.generate();
    expectSnippet(
      snippet,
      expected.prompt_snippet_contains as string[] | undefined,
      expected.prompt_snippet_absent as string[] | undefined,
    );
  } else if (action === 'create_processor') {
    const configs = ((args.catalogs as unknown[]) || []).map(loadCatalogConfig);
    const before = describeConfigs(configs);
    const catalogs = configs.map(c => c.transformedCatalog);
    const examples = loadExamples(args.examples as string[] | undefined, catalogs);
    const baseFactory = makeFactory((args.format as string) ?? 'direct_json');
    const overrideFactory = args.format_override
      ? makeFactory(args.format_override as string)
      : undefined;

    const generator = new A2uiGenerator(configs, examples, baseFactory);

    const rawCaps = args.renderer_capabilities as Record<string, RendererCapabilities> | undefined;
    const byVersion = rawCaps ? Object.values(rawCaps) : [];
    const capabilities = byVersion[0];

    const create = () => {
      const processor = generator.createProcessor(
        capabilities as RendererCapabilities,
        overrideFactory,
      );
      const snippet = processor.promptSnippet;
      return {processor, snippet};
    };

    if (testCase.expect_error) {
      assertThrows(create, testCase.expect_error as Record<string, unknown>);
      return;
    }

    const {processor, snippet} = create();
    const active = processor.activeCatalogs;
    const expected = (testCase.expect as Record<string, unknown>) || {};

    if (expected.active_catalog_ids) {
      expect(active.map(c => c.id)).toEqual(expected.active_catalog_ids);
    }
    if (Array.isArray(expected.catalogs)) {
      const expCats = expected.catalogs as Array<{
        catalog_id?: string;
        components?: string[];
        functions?: string[];
      }>;
      for (let i = 0; i < expCats.length; i++) {
        if (expCats[i].catalog_id) {
          expect(active[i].id).toBe(expCats[i].catalog_id);
        }
        expectCatalogContents(active[i], expCats[i]);
      }
    }
    expectSnippet(
      snippet,
      expected.prompt_snippet_contains as string[] | undefined,
      expected.prompt_snippet_absent as string[] | undefined,
    );
    if (expected.generator_catalogs_unchanged) {
      expect(describeConfigs(configs)).toEqual(before);
    }

    const thenParse = testCase.then_parse as Record<string, unknown> | undefined;
    if (thenParse) {
      if (thenParse.expect_error) {
        assertThrows(
          () => {
            processor.parseResponse(thenParse.input as string);
          },
          thenParse.expect_error as Record<string, unknown>,
        );
      } else {
        const parts = processor.parseResponse(thenParse.input as string);
        assertPartsMatch(parts, thenParse.expect as Array<Record<string, unknown>>);
      }
    }
  } else {
    throw new Error(`Unsupported action: ${action}`);
  }
}

describe('Conformance: multi_catalog_formats.yaml & request_processor.yaml', () => {
  const files = [
    conformancePath('agent/multi_catalog_formats.yaml'),
    conformancePath('agent/request_processor.yaml'),
  ];

  for (const testCase of loadCases(files)) {
    const args = (testCase.args as Record<string, unknown>) || {};
    const fmt = (args.format as string) ?? 'direct_json';
    const fmtOverride = args.format_override as string | undefined;
    const isUnsupportedFormat =
      (fmt !== 'express' && fmt !== 'direct_json') ||
      (fmtOverride !== undefined && fmtOverride !== 'express' && fmtOverride !== 'direct_json');

    const title = `${testCase.action} · ${testCase.name}`;
    if (isUnsupportedFormat) {
      test.skip(title, () => {
        runFormatCase(testCase);
      });
    } else {
      test(title, () => {
        runFormatCase(testCase);
      });
    }
  }
});
