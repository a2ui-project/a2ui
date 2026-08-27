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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {loadConformanceSuite} from './harness.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {SurfaceModel} from '../state/surface-model.js';

/**
 * Runs the shared `conformance/core/message_processor.yaml` suite against
 * `MessageProcessor`.
 *
 * The suite's catalog is built natively rather than parsed from the case, as
 * the suite header explains: renderers construct catalogs from code, so the
 * case supplies only the catalog id.
 *
 * This is additive. The hand-written tests in
 * `src/v0_9/processing/message-processor.test.ts` still run, and cover
 * behaviour that is specific to this implementation, notably Zod-based
 * component schema validation and `REF:` handling in inline catalogs.
 */

interface SurfaceExpectation {
  catalogId?: string;
  sendDataModel?: boolean;
  components?: Record<string, {component?: string; properties?: Record<string, unknown>}>;
  data_model?: unknown;
}

interface ConformanceCase {
  name: string;
  catalog?: {catalog_schema?: {catalogId?: string}};
  payload: Array<Record<string, unknown>>;
  expect?: {
    surfaces?: Record<string, SurfaceExpectation>;
    absent_surfaces?: string[];
    client_data_model?: Record<string, unknown>;
    client_data_model_absent?: boolean;
    client_capabilities?: Record<string, Record<string, unknown>>;
  };
  expect_error?: {category?: string; message?: string} | string;
}

/** A catalog with no components, built natively as the suite requires. */
function emptyCatalog(id: string): Catalog<ComponentApi> {
  return new Catalog<ComponentApi>(id, []);
}

function catalogIdOf(testCase: ConformanceCase): string {
  return testCase.catalog?.catalog_schema?.catalogId ?? 'conformance-catalog';
}

function errorPattern(expectError: ConformanceCase['expect_error']): RegExp {
  const message = typeof expectError === 'string' ? expectError : (expectError?.message ?? '');
  return new RegExp(message);
}

function checkComponents(
  surface: SurfaceModel<ComponentApi>,
  expected: NonNullable<SurfaceExpectation['components']>,
  reason: string,
): void {
  for (const [id, expectation] of Object.entries(expected)) {
    const component = surface.componentsModel.get(id);
    assert.ok(component, `${reason}: component ${id}`);

    if (expectation.component !== undefined) {
      assert.strictEqual(component.type, expectation.component, `${reason}: ${id} type`);
    }
    for (const [key, value] of Object.entries(expectation.properties ?? {})) {
      assert.deepStrictEqual(component.properties[key], value, `${reason}: ${id}.${key}`);
    }
  }
  if (Object.keys(expected).length === 0) {
    assert.strictEqual([...surface.componentsModel.entries].length, 0, `${reason}: no components`);
  }
}

function runCase(testCase: ConformanceCase): void {
  const processor = new MessageProcessor<ComponentApi>([emptyCatalog(catalogIdOf(testCase))]);
  const name = testCase.name;

  if (testCase.expect_error !== undefined) {
    assert.throws(
      () => processor.processMessages(testCase.payload as never),
      errorPattern(testCase.expect_error),
      name,
    );
    return;
  }

  processor.processMessages(testCase.payload as never);
  const expected = testCase.expect ?? {};

  for (const [surfaceId, expectation] of Object.entries(expected.surfaces ?? {})) {
    const surface = processor.model.getSurface(surfaceId);
    assert.ok(surface, `${name}: surface ${surfaceId} is open`);

    if (expectation.catalogId !== undefined) {
      assert.strictEqual(
        surface.catalog.id,
        expectation.catalogId,
        `${name}: ${surfaceId} catalogId`,
      );
    }
    if (expectation.sendDataModel !== undefined) {
      assert.strictEqual(
        surface.sendDataModel,
        expectation.sendDataModel,
        `${name}: ${surfaceId} sendDataModel`,
      );
    }
    if ('data_model' in expectation) {
      assert.deepStrictEqual(
        surface.dataModel.get('/'),
        expectation.data_model,
        `${name}: ${surfaceId} data model`,
      );
    }
    if (expectation.components !== undefined) {
      checkComponents(surface, expectation.components, `${name}: ${surfaceId}`);
    }
  }

  for (const surfaceId of expected.absent_surfaces ?? []) {
    assert.strictEqual(
      processor.model.getSurface(surfaceId),
      undefined,
      `${name}: surface ${surfaceId} is closed`,
    );
  }

  if (expected.client_data_model_absent === true) {
    assert.strictEqual(processor.getClientDataModel(), undefined, name);
  }
  if (expected.client_data_model !== undefined) {
    const actual = processor.getClientDataModel() as Record<string, unknown> | undefined;
    assert.ok(actual, name);
    for (const [key, value] of Object.entries(expected.client_data_model)) {
      assert.deepStrictEqual(actual[key], value, `${name}: client data ${key}`);
    }
  }
  if (expected.client_capabilities !== undefined) {
    const actual = processor.getClientCapabilities() as unknown as Record<
      string,
      Record<string, unknown>
    >;
    for (const [version, expectations] of Object.entries(expected.client_capabilities)) {
      assert.ok(actual[version], `${name}: capabilities ${version}`);
      for (const [key, value] of Object.entries(expectations)) {
        assert.deepStrictEqual(
          actual[version][key],
          value,
          `${name}: capabilities ${version}.${key}`,
        );
      }
    }
  }
}

describe('conformance core/message_processor.yaml', () => {
  const cases = loadConformanceSuite<ConformanceCase>('core/message_processor.yaml');

  it('suite is not empty', () => {
    assert.ok(cases.length > 0);
  });

  for (const testCase of cases) {
    it(testCase.name, () => runCase(testCase));
  }
});
