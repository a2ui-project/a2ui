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

import assert from 'node:assert';
import {describe, it} from 'node:test';
import {A2uiConfigurationError, type JsonSchemaValidator} from '@a2ui/web_core';
import {
  BASIC_CATALOG_ID,
  createBasicCatalog as createWebCoreBasicCatalog,
  LEGACY_V09_FUNCTION_NAMES,
} from '@a2ui/web_core/v0_9/basic_catalog';
import {createAjvValidator} from '@a2ui/validator-ajv';
import {createBasicCatalog} from '../v0_9/catalogs/basic/index.js';
import * as v0_8 from '../0.8/core.js';
import {validator} from './validator.js';

describe('createBasicCatalog (v0.9)', () => {
  it('throws A2uiConfigurationError without a validator', () => {
    assert.throws(
      () => createBasicCatalog(undefined as unknown as JsonSchemaValidator),
      A2uiConfigurationError,
    );
  });

  it('returns the same catalog for the same validator and another for another', () => {
    const catalog = createBasicCatalog(validator);
    assert.strictEqual(createBasicCatalog(validator), catalog);
    assert.notStrictEqual(createBasicCatalog(createAjvValidator()), catalog);
  });

  it("has web_core's basic components and the legacy functions before the spec functions", () => {
    const catalog = createBasicCatalog(validator);
    const base = createWebCoreBasicCatalog(validator);
    assert.strictEqual(catalog.id, BASIC_CATALOG_ID);
    assert.strictEqual(catalog.protocolVersion, base.protocolVersion);
    assert.deepStrictEqual([...catalog.components.keys()], [...base.components.keys()]);
    for (const [name, component] of base.components) {
      assert.strictEqual(catalog.components.get(name), component);
    }
    assert.deepStrictEqual(
      [...catalog.functions.keys()],
      [...LEGACY_V09_FUNCTION_NAMES, ...base.functions.keys()],
    );
  });
});

describe('createSignalA2uiMessageProcessor (v0.8)', () => {
  it('throws A2uiConfigurationError without a validator', () => {
    assert.throws(
      () =>
        v0_8.Data.createSignalA2uiMessageProcessor(
          undefined as unknown as {validator: JsonSchemaValidator},
        ),
      A2uiConfigurationError,
    );
    assert.throws(
      () =>
        v0_8.Data.createSignalA2uiMessageProcessor({
          validator: undefined as unknown as JsonSchemaValidator,
        }),
      A2uiConfigurationError,
    );
  });

  it('validates messages with the given validator', () => {
    const processor = v0_8.Data.createSignalA2uiMessageProcessor({validator});
    processor.processMessages([{beginRendering: {root: 'root', surfaceId: '@default'}}]);
    assert.strictEqual(processor.getSurfaces().size, 1);
    assert.throws(() =>
      processor.processMessages([{beginRendering: {surfaceId: '@default'}} as never]),
    );
  });
});
