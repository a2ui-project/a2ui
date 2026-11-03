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

import {expect} from 'vitest';

import {
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiValidationError,
  DirectJsonFormatFactory,
  ExpressFormatFactory,
  InferenceFormat,
  ParseError,
  RendererState,
} from '../../src/index.js';
import {CatalogApi} from '../../src/internal/web-core.js';
import {loadCases} from './loader.js';
import {firstCatalogId, loadCatalogFromRelativePath, lowerText} from './lowering.js';
import {conformancePath, forEachSuiteVersion} from './suite-helpers.js';

const DEFAULT_CATALOG = 'test_data/catalogs/simplified_catalog_v1_0.json';

const RENDERER_STATE_CASE_KEYS = new Set([
  'name',
  'description',
  'sourceFile',
  'action',
  'catalogs',
  'turns',
]);
const RENDERER_STATE_TURN_KEYS = new Set([
  'format',
  'payload',
  'response',
  'expect_surfaces',
  'expectError',
  'expect_error',
]);

const ERRORS_BY_CATEGORY: Record<string, Array<new (...args: never[]) => Error>> = {
  ParseError: [ParseError, A2uiCompilationParseError],
  ValidationError: [A2uiValidationError, A2uiCompilationValidationError],
};

function assertKnownKeys(obj: Record<string, unknown>, allowed: Set<string>, where: string): void {
  const unknown = Object.keys(obj).filter(k => !allowed.has(k));
  expect(unknown, `Unknown ${where} keys`).toEqual([]);
}

function expectThrowsCategory(
  fn: () => void,
  expectError: {category: string; message?: string},
): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `Expected error ${JSON.stringify(expectError)}`).toBeInstanceOf(Error);
  const classes = ERRORS_BY_CATEGORY[expectError.category];
  expect(classes, `Unknown error category ${expectError.category}`).toBeDefined();
  expect(classes.some(errorClass => thrown instanceof errorClass)).toBe(true);
  if (expectError.message) {
    expect((thrown as Error).message).toContain(expectError.message);
  }
}

function makeFormat(formatName: unknown, catalogs: CatalogApi[]): InferenceFormat {
  if (formatName === 'express') {
    return new ExpressFormatFactory().createFormat(catalogs);
  }
  return new DirectJsonFormatFactory().createFormat(catalogs);
}

function assertExpectedSurfaces(
  state: RendererState,
  expectSurfaces: Record<string, unknown>,
): void {
  expect(new Set(state.surfaceIds)).toEqual(new Set(Object.keys(expectSurfaces)));
  for (const [surfaceId, rawExpected] of Object.entries(expectSurfaces)) {
    const expectedSurface = rawExpected as Record<string, unknown>;
    const surface = state.getSurface(surfaceId);
    expect(surface).toBeDefined();
    if (!surface) continue;
    if (expectedSurface.components !== undefined) {
      const expectedComps = expectedSurface.components as Record<string, Record<string, unknown>>;
      expect(new Set(surface.componentsModel.keys)).toEqual(new Set(Object.keys(expectedComps)));
      for (const [compId, expectedComp] of Object.entries(expectedComps)) {
        const comp = surface.componentsModel.get(compId);
        expect(comp).toBeDefined();
        if (!comp) continue;
        expect({component: comp.type, ...comp.properties}).toEqual(expectedComp);
      }
    }
    if (expectedSurface.data !== undefined) {
      const actualData = surface.dataModel.get('/') ?? {};
      expect(actualData).toEqual(expectedSurface.data);
    }
  }
}

forEachSuiteVersion(
  'RendererState Conformance (agent/renderer_state.yaml)',
  loadCases([conformancePath('agent/renderer_state.yaml')]),
  (tc, version) => {
    expect(tc.action).toBe('renderer_state_turns');
    assertKnownKeys(
      tc as Record<string, unknown>,
      RENDERER_STATE_CASE_KEYS,
      'renderer_state_turns case',
    );

    const isLowered = version === 'v0.9-lowered';
    const rawCatalogs = Array.isArray(tc.catalogs) ? (tc.catalogs as string[]) : [DEFAULT_CATALOG];
    const injId = isLowered ? firstCatalogId({catalogs: rawCatalogs}) : undefined;
    const catalogs = rawCatalogs.map(p => loadCatalogFromRelativePath(p, isLowered));
    const state = new RendererState(catalogs);

    const turns = tc.turns as Array<Record<string, unknown>>;
    for (const turn of turns) {
      assertKnownKeys(turn, RENDERER_STATE_TURN_KEYS, 'renderer_state_turns turn');
      const formatName = turn.format ?? 'direct_json';
      const isExpress = formatName === 'express';
      const format = makeFormat(formatName, catalogs);
      const parser = format.createParser();

      const rawResponse = turn.response as string;
      const turnInput = isLowered && !isExpress ? lowerText(rawResponse, injId) : rawResponse;

      const expectErr = (turn.expect_error ?? turn.expectError) as
        | {category: string; message?: string}
        | undefined;
      if (expectErr !== undefined) {
        expectThrowsCategory(() => parser.parseResponse(turnInput, {state}), expectErr);
        continue;
      }

      parser.parseResponse(turnInput, {state});
      if (turn.expect_surfaces !== undefined) {
        assertExpectedSurfaces(state, turn.expect_surfaces as Record<string, unknown>);
      }
    }
  },
);
