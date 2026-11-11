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
  AgentToRendererMessage,
  DirectJsonFormatFactory,
  ExpressFormatFactory,
  InferenceFormat,
  RendererState,
} from '../../src/index.js';
import {CatalogSchemaHelper} from '../../src/inference-formats/express/schema-helper.js';
import {CatalogApi} from '../../src/internal/web-core.js';
import {loadCases} from './loader.js';
import {
  firstCatalogId,
  liftComponentProperties,
  lowerMessages,
  lowerText,
  toV10SchemaHelpers,
} from './lowering.js';
import {
  assertKnownKeys,
  CASE_METADATA_KEYS,
  conformancePath,
  expectThrowsCategory,
  forEachSuiteVersion,
  loadCatalogEntry,
} from './suite-helpers.js';

const DEFAULT_CATALOG = 'test_data/catalogs/simplified_catalog_v1_0.json';

const RENDERER_STATE_CASE_KEYS = new Set([...CASE_METADATA_KEYS, 'catalogs', 'turns']);
const RENDERER_STATE_TURN_KEYS = new Set([
  'format',
  'payload',
  'response',
  'expect_surfaces',
  'expectError',
  'expect_error',
]);
const RENDERER_STATE_SURFACE_EXPECT_KEYS = new Set(['components', 'data']);

function makeFormat(formatName: unknown, catalogs: CatalogApi[]): InferenceFormat {
  if (formatName === 'express') {
    return new ExpressFormatFactory().createFormat(catalogs);
  }
  return new DirectJsonFormatFactory().createFormat(catalogs);
}

function assertExpectedSurfaces(
  state: RendererState,
  expectSurfaces: Record<string, unknown>,
  isLowered: boolean,
  v10Helpers: readonly CatalogSchemaHelper[],
): void {
  expect(new Set(state.surfaceIds)).toEqual(new Set(Object.keys(expectSurfaces)));
  for (const [surfaceId, rawExpected] of Object.entries(expectSurfaces)) {
    const expectedSurface = rawExpected as Record<string, unknown>;
    assertKnownKeys(
      expectedSurface,
      RENDERER_STATE_SURFACE_EXPECT_KEYS,
      `expect_surfaces.${surfaceId}`,
    );
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
        const props = isLowered
          ? liftComponentProperties(comp.type, comp.properties, v10Helpers)
          : comp.properties;
        expect({component: comp.type, ...props}).toEqual(expectedComp);
      }
    }
    if (expectedSurface.data !== undefined) {
      const val = surface.dataModel.get('/');
      const actualData = val === undefined || val === null ? {} : val;
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
    const rawCatalogs = Array.isArray(tc.catalogs) ? tc.catalogs : [DEFAULT_CATALOG];
    const injId = isLowered ? firstCatalogId({catalogs: rawCatalogs}, DEFAULT_CATALOG) : undefined;
    const catalogs = rawCatalogs.map(
      entry => loadCatalogEntry(entry, isLowered).transformedCatalog,
    );
    const v10Helpers = isLowered
      ? toV10SchemaHelpers(
          rawCatalogs.map(entry => loadCatalogEntry(entry, false).transformedCatalog),
        )
      : [];
    const state = new RendererState(catalogs);

    const turns = tc.turns as Array<Record<string, unknown>>;
    for (const turn of turns) {
      assertKnownKeys(turn, RENDERER_STATE_TURN_KEYS, 'renderer_state_turns turn');
      const expectErr = (turn.expect_error ?? turn.expectError) as
        | Record<string, unknown>
        | string
        | undefined;

      let applyTurn: () => void;
      if (turn.payload !== undefined) {
        const rawPayload = turn.payload as Array<Record<string, unknown>>;
        const messages = isLowered
          ? lowerMessages(rawPayload, injId)
          : (rawPayload as unknown as AgentToRendererMessage[]);
        applyTurn = () => {
          state.transaction(() => {
            state.checkTopology(state.apply(messages));
          });
        };
      } else {
        const formatName = turn.format ?? 'direct_json';
        const isExpress = formatName === 'express';
        const format = makeFormat(formatName, catalogs);
        const parser = format.createParser();

        const rawResponse = turn.response as string;
        const catId = rawResponse.includes('"catalogId"') ? undefined : injId;
        const turnInput = isLowered && !isExpress ? lowerText(rawResponse, catId) : rawResponse;
        applyTurn = () => {
          parser.parseResponse(turnInput, {state});
        };
      }

      if (expectErr !== undefined) {
        expectThrowsCategory(applyTurn, expectErr);
        continue;
      }

      applyTurn();
      if (turn.expect_surfaces !== undefined) {
        assertExpectedSurfaces(
          state,
          turn.expect_surfaces as Record<string, unknown>,
          isLowered,
          v10Helpers,
        );
      }
    }
  },
);
