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
import {MessageProcessor} from '../../src/v0_9/processing/message-processor.js';
import {Catalog, ComponentApi} from '../../src/v0_9/catalog/types.js';
import {SurfaceModel} from '../../src/v0_9/state/surface-model.js';

/**
 * Runs the shared `conformance/core/message_processor.yaml` suite against
 * `MessageProcessor`.
 *
 * The suite uses the case vocabulary of the `v1_0` branch: `messages`,
 * `catalogPaths`, and `expect.surfaces`. Cases name a catalog rather than
 * declaring one, because renderers construct catalogs from code, so this
 * harness registers a native catalog under the id the messages use.
 *
 * This is additive. The hand-written tests in
 * `src/v0_9/processing/message-processor.test.ts` still run, and cover
 * behaviour that is specific to this implementation, notably Zod-based
 * component schema validation and `REF:` handling in inline catalogs.
 */

/** One component's flattened properties: `id`, `component`, and the rest. */
type ComponentExpectation = Record<string, unknown> & {id: string};

interface SurfaceExpectation {
  exists?: boolean;
  catalogId?: string;
  sendDataModel?: boolean;
  components?: ComponentExpectation[];
  dataModel?: unknown;
}

interface ConformanceCase {
  name: string;
  catalogPaths?: string[];
  messages?: Array<Record<string, unknown>> | {messages: Array<Record<string, unknown>>};
  payload?: Array<Record<string, unknown>> | {messages: Array<Record<string, unknown>>};
  expect?: {surfaces?: Record<string, SurfaceExpectation>};
  expectError?: {category?: string; message?: string} | string;
}

/** A catalog with no components, built natively as the suite requires. */
function emptyCatalog(id: string): Catalog<ComponentApi> {
  return new Catalog<ComponentApi>(id, []);
}

/**
 * The messages a case processes, accepting both the bare list and the
 * `{messages: [...]}` wrapper the protocol allows.
 */
function messagesOf(testCase: ConformanceCase): Array<Record<string, unknown>> {
  const raw = testCase.messages ?? testCase.payload ?? [];
  return Array.isArray(raw) ? raw : raw.messages;
}

/** The catalog id the case's messages bind surfaces to. */
function catalogIdOf(testCase: ConformanceCase): string {
  for (const message of messagesOf(testCase)) {
    const create = message['createSurface'] as {catalogId?: string} | undefined;
    if (typeof create?.catalogId === 'string') return create.catalogId;
  }
  return 'test-catalog';
}

function errorPattern(expectError: ConformanceCase['expectError']): RegExp {
  const message = typeof expectError === 'string' ? expectError : (expectError?.message ?? '');
  return new RegExp(message);
}

/**
 * Checks the surface's component graph. The expected list is exhaustive, so an
 * empty one asserts the surface holds no components at all.
 */
function checkComponents(
  surface: SurfaceModel<ComponentApi>,
  expected: ComponentExpectation[],
  reason: string,
): void {
  assert.deepStrictEqual(
    [...surface.componentsModel.entries].map(([id]) => id).sort(),
    expected.map(entry => entry.id).sort(),
    `${reason}: component ids`,
  );

  for (const entry of expected) {
    const component = surface.componentsModel.get(entry.id);
    assert.ok(component, `${reason}: component ${entry.id}`);

    for (const [key, value] of Object.entries(entry)) {
      if (key === 'id') continue;
      if (key === 'component') {
        assert.strictEqual(component.type, value, `${reason}: ${entry.id} type`);
        continue;
      }
      assert.deepStrictEqual(component.properties[key], value, `${reason}: ${entry.id}.${key}`);
    }
  }
}

function runCase(testCase: ConformanceCase): void {
  const processor = new MessageProcessor<ComponentApi>([emptyCatalog(catalogIdOf(testCase))]);
  const name = testCase.name;
  const messages = messagesOf(testCase);

  if (testCase.expectError !== undefined) {
    assert.throws(
      () => processor.processMessages(messages as never),
      errorPattern(testCase.expectError),
      name,
    );
    return;
  }

  processor.processMessages(messages as never);
  const expected = testCase.expect ?? {};

  for (const [surfaceId, expectation] of Object.entries(expected.surfaces ?? {})) {
    const surface = processor.model.getSurface(surfaceId);

    if (expectation.exists === false) {
      assert.strictEqual(surface, undefined, `${name}: surface ${surfaceId} is closed`);
      continue;
    }
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
    if (expectation.dataModel !== undefined) {
      assert.deepStrictEqual(
        surface.dataModel.get('/'),
        expectation.dataModel,
        `${name}: ${surfaceId} data model`,
      );
    }
    if (expectation.components !== undefined) {
      checkComponents(surface, expectation.components, `${name}: ${surfaceId}`);
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
