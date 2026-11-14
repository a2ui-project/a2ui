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

import {createAjvValidator, createCfWorkerValidator} from '../test/validator.js';
import {formatIssue, pickIssue} from './issues.js';
import type {JsonSchema} from './types.js';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    a: {type: 'object', required: ['id'], properties: {id: {type: 'string'}}},
    c: {const: '1.0'},
    e: {enum: ['x', 'y']},
    o: {type: 'object', additionalProperties: false},
  },
};

const formatted = (value: unknown) =>
  [createAjvValidator(), createCfWorkerValidator()].map(v => {
    const r = v.compile(schema)(value);
    assert.ok(!r.success);
    return formatIssue(pickIssue(r.issues));
  });

describe('formatIssue across engines', () => {
  for (const [name, value, expected] of [
    ['required', {a: {}}, "a.id: missing required property 'id'"],
    ['type', {a: {id: 1}}, 'a.id: must be string'],
    ['const', {c: '2.0'}, 'c: must be "1.0"'],
    ['enum', {e: 'z'}, 'e: must be one of "x", "y"'],
    ['additionalProperties', {o: {extra: 1}}, "o.extra: unexpected property 'extra'"],
  ] as const) {
    it(`gives Ajv and cfworker the same text for a ${name} failure`, () => {
      assert.deepStrictEqual(formatted(value), [expected, expected]);
    });
  }
});
