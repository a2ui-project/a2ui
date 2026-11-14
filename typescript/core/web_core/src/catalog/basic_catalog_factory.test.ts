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

import {A2uiConfigurationError} from '../errors.js';
import type {JsonSchemaValidator} from '../schema-engine/types.js';
import {createAjvValidator} from '../test/validator.js';
import {memoizeByValidator} from './basic_catalog_factory.js';

/** A validator that counts the schemas it compiles. */
function countingValidator(): JsonSchemaValidator & {compiled: number} {
  const inner = createAjvValidator();
  const counting = {
    compiled: 0,
    compile: ((schema, opts) => {
      counting.compiled++;
      return inner.compile(schema, opts);
    }) as JsonSchemaValidator['compile'],
  };
  return counting;
}

describe('basic catalog factories', () => {
  // Every module that exposes a basic catalog, the package root included.
  const modules = [
    '../index.js',
    '../v0_8/basic_catalog/index.js',
    '../v0_9/basic_catalog/index.js',
    '../v0_9/index.js',
    '../catalogs/basic/v1/index.js',
    '../v1_0/index.js',
  ];

  it('builds no catalog when the modules are imported', async () => {
    const validator = countingValidator();
    const imported: Record<string, unknown>[] = [];
    for (const specifier of modules) imported.push(await import(specifier));
    for (const [i, module] of imported.entries()) {
      // No catalog is exported as a constant, built at import.
      assert.ok(!('basicCatalog' in module), `${modules[i]} exports no basicCatalog constant`);
    }
    // Nothing has compiled with the validator, which no module has seen yet.
    assert.strictEqual(validator.compiled, 0);

    const v1 = imported[4] as typeof import('../catalogs/basic/v1/index.js');
    const catalog = v1.createBasicCatalog(validator);
    const compiledOnce = validator.compiled;
    assert.ok(compiledOnce > 0, 'the catalog compiles its entries when it is first asked for');
    assert.strictEqual(catalog.components.size, 18);
  });

  for (const [label, specifier] of [
    ['v0.8', '../v0_8/basic_catalog/catalog.js'],
    ['v0.9', '../v0_9/basic_catalog/catalog.js'],
    ['v1', '../catalogs/basic/v1/catalog.js'],
  ] as const) {
    it(`builds the ${label} catalog once per validator`, async () => {
      const {createBasicCatalog} = (await import(specifier)) as {
        createBasicCatalog: (validator: JsonSchemaValidator) => unknown;
      };
      const validator = countingValidator();
      const first = createBasicCatalog(validator);
      const compiled = validator.compiled;
      assert.ok(compiled > 0);
      assert.strictEqual(createBasicCatalog(validator), first);
      assert.strictEqual(validator.compiled, compiled, 'a second call compiles nothing');

      const other = countingValidator();
      assert.notStrictEqual(createBasicCatalog(other), first);
      assert.ok(other.compiled > 0, 'another validator gets a catalog of its own');
    });

    it(`requires a validator for the ${label} catalog`, async () => {
      const {createBasicCatalog} = (await import(specifier)) as {
        createBasicCatalog: (validator: unknown) => unknown;
      };
      assert.throws(() => createBasicCatalog(undefined), A2uiConfigurationError);
    });
  }

  it('memoizes by validator and passes a missing one through', () => {
    let builds = 0;
    const build = memoizeByValidator(() => ++builds);
    const validator = createAjvValidator();
    assert.strictEqual(build(validator), 1);
    assert.strictEqual(build(validator), 1);
    assert.strictEqual(build(createAjvValidator()), 2);
    assert.strictEqual(build(undefined as unknown as JsonSchemaValidator), 3);
  });
});
