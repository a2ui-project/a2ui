/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {describeSchemaErrors} from './describe_schema_errors.js';

const ajv = new Ajv2020({allErrors: true, strict: false});

function violations(schema: object, value: unknown) {
  const validate = ajv.compile(schema);
  assert.equal(validate(value), false);
  return describeSchemaErrors(validate.errors ?? []);
}

describe('describeSchemaErrors', () => {
  it('names a missing required property', () => {
    assert.deepEqual(violations({type: 'object', required: ['text']}, {}), [
      {property: 'text', problem: 'is required'},
    ]);
  });

  it('names a property that is not allowed', () => {
    const schema = {type: 'object', properties: {}, additionalProperties: false};
    assert.deepEqual(violations(schema, {extra: 1}), [
      {property: 'extra', problem: 'is not allowed'},
    ]);
  });

  it('lists the allowed values of an enum', () => {
    const schema = {properties: {variant: {enum: ['caption', 'body']}}};
    assert.deepEqual(violations(schema, {variant: 'huge'}), [
      {property: 'variant', problem: 'must be one of "caption", "body"'},
    ]);
  });

  it('describes a const and a type', () => {
    const schema = {properties: {kind: {const: 'Text'}, size: {type: 'integer'}}};
    assert.deepEqual(violations(schema, {kind: 'Row', size: 'big'}), [
      {property: 'kind', problem: 'must be "Text"'},
      {property: 'size', problem: 'must be an integer'},
    ]);
  });

  it('builds paths through objects and arrays', () => {
    const schema = {
      properties: {items: {items: {properties: {name: {type: 'string'}}}}},
    };
    assert.deepEqual(violations(schema, {items: [{name: 'a'}, {name: 1}]}), [
      {property: 'items[1].name', problem: 'must be a string'},
    ]);
  });

  it('collapses a oneOf of types into one violation', () => {
    const schema = {
      properties: {
        text: {
          oneOf: [
            {type: 'string'},
            {type: 'object', properties: {path: {type: 'string'}}, required: ['path']},
          ],
        },
      },
    };
    assert.deepEqual(violations(schema, {text: 42}), [
      {property: 'text', problem: 'must be a string or an object'},
    ]);
  });

  it('reports the deepest error of a oneOf', () => {
    const schema = {
      properties: {
        action: {
          oneOf: [
            {
              type: 'object',
              properties: {event: {type: 'object', properties: {name: {type: 'string'}}}},
              required: ['event'],
            },
            {type: 'object', required: ['call']},
          ],
        },
      },
    };
    assert.deepEqual(violations(schema, {action: {event: {name: 5}}}), [
      {property: 'action.event.name', problem: 'must be a string'},
    ]);
  });

  it('reports a oneOf whose alternatives all fail at the property itself', () => {
    const schema = {
      properties: {
        text: {oneOf: [{type: 'string'}, {type: 'object', required: ['path']}]},
      },
    };
    assert.deepEqual(violations(schema, {text: {}}), [
      {property: 'text', problem: 'does not match any of its allowed forms'},
    ]);
  });
});
