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

import {A2uiValidationError} from '../errors.js';
import {A2uiValidationError as V08ValidationError} from '../v0_8/errors.js';
import {createAjvValidator, createCfWorkerValidator} from '../test/validator.js';
import {A2uiMessageProcessor} from '../v0_8/data/model-processor.js';
import {MessageProcessor, createBasicCatalog} from '../v0_9/index.js';
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

describe('validation error details across engines', () => {
  const BASIC_V09 = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
  const create = {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: BASIC_V09}};
  const components = (...list: Record<string, unknown>[]) => ({
    version: 'v0.9',
    updateComponents: {surfaceId: 's', components: list},
  });

  /** The message and details each engine's processor rejects `message` with. */
  const rejections = (message: unknown) =>
    [createAjvValidator(), createCfWorkerValidator()].map(validator => {
      const processor = new MessageProcessor([createBasicCatalog(validator)], undefined, {
        validator,
      });
      processor.processMessages([create as never]);
      try {
        processor.processMessages([message as never]);
      } catch (err) {
        assert.ok(err instanceof A2uiValidationError, String(err));
        return {message: err.message, details: err.details};
      } finally {
        processor.dispose();
      }
      return assert.fail('the message was accepted');
    });

  for (const [name, message] of [
    ['a bad catalogId', {version: 'v0.9', createSurface: {surfaceId: 't', catalogId: 7}}],
    ['a missing catalogId', {version: 'v0.9', createSurface: {surfaceId: 't'}}],
    [
      'an extra envelope property',
      {version: 'v0.9', createSurface: {surfaceId: 't', catalogId: BASIC_V09, zzz: 1}},
    ],
    [
      'a non-array components',
      {version: 'v0.9', updateComponents: {surfaceId: 's', components: 'x'}},
    ],
    ['a missing component type', components({id: 'a'})],
    ['a wrong prop type', components({id: 'b', component: 'Text', text: 5})],
    ['an extra prop', components({id: 'c', component: 'Text', text: 'x', zzz: 1})],
    ['a oneOf mismatch', components({id: 'd', component: 'Text', text: {path: 5}})],
    [
      'several bad envelope fields',
      {version: 'v0.9', createSurface: {surfaceId: 't', catalogId: 7, sendDataModel: 'x', zzz: 1}},
    ],
  ] as const) {
    it(`gives Ajv and cfworker the same message and details for ${name}`, () => {
      const [ajv, cfworker] = rejections(message);
      assert.ok(ajv.details && ajv.details.length > 0, JSON.stringify(ajv));
      assert.deepStrictEqual(cfworker, ajv);
    });
  }
});

describe('v0.8 validation error details across engines', () => {
  for (const [name, message] of [
    ['a missing surfaceId', {beginRendering: {root: 'r'}}],
    ['a wrong type', {deleteSurface: {surfaceId: 5}}],
    ['an extra property', {deleteSurface: {surfaceId: 's', zzz: 1}}],
  ] as const) {
    it(`gives Ajv and cfworker the same message and details for ${name}`, () => {
      const [ajv, cfworker] = [createAjvValidator(), createCfWorkerValidator()].map(validator => {
        try {
          new A2uiMessageProcessor({validator}).processMessages([message as never]);
        } catch (err) {
          assert.ok(err instanceof V08ValidationError, String(err));
          return {message: err.message, details: err.details};
        }
        return assert.fail('the message was accepted');
      });
      assert.ok(ajv.details && ajv.details.length > 0, JSON.stringify(ajv));
      assert.deepStrictEqual(cfworker, ajv);
    });
  }
});
