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

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {A2uiConfigurationError, A2uiValidationError, NO_VALIDATOR_MESSAGE} from '../errors.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {DataContext} from '../resolution/data-context.js';
import {fromJsonSchema} from '../schema-engine/from-json-schema.js';
import {SurfaceModel} from '../state/surface-model.js';
import {v1BasicCatalog} from '../test/basic_catalogs.js';
import {createAjvValidator, testValidator} from '../test/validator.js';
import {IndexApi} from '../v1_0/functions/system_functions.js';
import {catalogValidator, unboundJsonSchema} from './catalog-validator.js';
import {Catalog} from './types.js';

/** A catalog whose one component was compiled with `validator`. */
function catalogBorrowing(validator: ReturnType<typeof createAjvValidator>, options = {}) {
  return new Catalog(
    'c',
    '1.0',
    [{name: 'Box', schema: fromJsonSchema({type: 'object'}, validator)}],
    [],
    options,
  );
}

describe('catalog validator precedence', () => {
  it("lets a processor's validator win over one borrowed from the entries", () => {
    const entries = createAjvValidator();
    const processor = createAjvValidator();
    const catalog = catalogBorrowing(entries);
    assert.equal(catalogValidator(catalog), entries);
    new MessageProcessor([catalog], undefined, {validator: processor}).dispose();
    assert.equal(catalogValidator(catalog), processor);
  });

  it('keeps CatalogOptions.validator over a processor and the entries', () => {
    const entries = createAjvValidator();
    const given = createAjvValidator();
    const catalog = catalogBorrowing(entries, {validator: given});
    assert.equal(catalogValidator(catalog), given);
    new MessageProcessor([catalog], undefined, {validator: createAjvValidator()}).dispose();
    assert.equal(catalogValidator(catalog), given);
    assert.equal(catalogValidator(catalog.copyWith({catalogId: 'd'})), given);
  });

  it('carries a given validator to derived catalogs, and re-borrows otherwise', () => {
    const entries = createAjvValidator();
    const processor = createAjvValidator();
    const borrowed = catalogBorrowing(entries);
    assert.equal(catalogValidator(borrowed.copyWith({catalogId: 'd'})), entries);
    new MessageProcessor([borrowed], undefined, {validator: processor}).dispose();
    const derived = borrowed.copyWith({catalogId: 'd'});
    assert.equal(catalogValidator(derived), processor);
    // A processor's validator still wins over the derived catalog's entries.
    new MessageProcessor([derived], undefined, {validator: createAjvValidator()}).dispose();
    assert.equal(catalogValidator(derived), processor);
  });
});

describe('unbound JSON Schemas', () => {
  it('throw a no-validator error when validated without a validator', () => {
    const schema = unboundJsonSchema({type: 'object'}, "Agent function 'f'");
    assert.throws(
      () => schema['~standard'].validate({}),
      (err: unknown) =>
        err instanceof A2uiConfigurationError &&
        err.message.startsWith(NO_VALIDATOR_MESSAGE) &&
        err.message.includes("Agent function 'f'"),
    );
    // `@index` has no hand-written check either.
    assert.throws(() => IndexApi.schema['~standard'].validate({offset: 1}), A2uiConfigurationError);
  });
});

describe('@index', () => {
  it('evaluates without validating its arguments again, in a catalog without a validator', () => {
    const catalog = new Catalog('plain', '1.0', [], []);
    assert.equal(catalogValidator(catalog), undefined);
    const surface = new SurfaceModel('s', catalog);
    const context = new DataContext(surface, '/items/2');
    assert.equal(catalog.invoker('@index', {offset: 1}, context), 3);
    // A malformed offset is not re-checked; the implementation treats it as 0.
    assert.equal(catalog.invoker('@index', {offset: 'x'}, context), 2);
    surface.dispose();
  });

  it("is rejected at ingest by the application's validator when malformed", () => {
    const proc = new MessageProcessor([v1BasicCatalog], undefined, {validator: testValidator});
    proc.processMessages([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: v1BasicCatalog.id}},
    ]);
    assert.throws(
      () =>
        proc.processMessages([
          {
            version: '1.0',
            updateComponents: {
              surfaceId: 's',
              components: [
                {
                  id: 'root',
                  component: 'Text',
                  text: {'@call': '@index', args: {offset: 'x'}},
                },
              ],
            },
          },
        ]),
      A2uiValidationError,
    );
    proc.dispose();
  });
  it("compiles against a catalog whose own anyFunction union refers to the document's functions", () => {
    // A union with a discriminator is not the one `toJson` computes, so the
    // catalog keeps it in `defs` as written, `#/functions/...` refs included.
    const catalog = Catalog.fromJson(
      {
        catalogId: 'handwritten-unions',
        protocolVersion: '1.0',
        components: {
          Text: {
            type: 'object',
            properties: {
              component: {const: 'Text'},
              text: {$ref: 'common_types.json#/$defs/DynamicString'},
            },
            required: ['component', 'text'],
          },
        },
        functions: {
          required: {
            type: 'object',
            returnType: 'boolean',
            properties: {
              '@call': {const: 'required'},
              args: {type: 'object', properties: {value: {}}, required: ['value']},
            },
            required: ['@call', 'args'],
          },
        },
        $defs: {
          anyFunction: {
            oneOf: [{$ref: '#/functions/required'}],
            discriminator: {propertyName: '@call'},
          },
        },
      },
      undefined,
      undefined,
      {validator: testValidator},
    );
    const proc = new MessageProcessor([catalog], undefined, {validator: testValidator});
    proc.processMessages([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: catalog.id}},
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 's',
          components: [{id: 'root', component: 'Text', text: {'@call': '@index'}}],
        },
      },
    ]);
    assert.ok(proc.model.getSurface('s')?.componentsModel.get('root'));
    proc.dispose();
  });
});
