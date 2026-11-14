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
import {assertSync, formatIssue, messageForIssue, pickIssue, toA2uiIssues} from './issues.js';

describe('pickIssue', () => {
  it('returns the deepest-path issue', () => {
    const deep = {path: ['a', 'b', 'c'], message: 'deep'};
    const issue = pickIssue([{path: ['a'], message: 'shallow', keyword: 'required'}, deep]);
    assert.strictEqual(issue, deep);
  });

  it('breaks ties by keyword order', () => {
    const issue = pickIssue([
      {path: ['a'], message: 'x', keyword: 'type'},
      {path: ['b'], message: 'y', keyword: 'required'},
      {path: ['c'], message: 'z', keyword: 'enum'},
    ]);
    assert.strictEqual(issue.message, 'y');
  });

  it('falls back to the first deepest issue when no keyword matches', () => {
    const issue = pickIssue([
      {path: ['a'], message: 'first', keyword: 'format'},
      {path: ['b'], message: 'second'},
    ]);
    assert.strictEqual(issue.message, 'first');
  });
});

describe('formatIssue', () => {
  it('joins the path with dots', () => {
    assert.strictEqual(
      formatIssue({path: ['props', 'text'], message: 'must be string'}),
      'props.text: must be string',
    );
  });

  it('uses root for an empty path', () => {
    assert.strictEqual(formatIssue({path: [], message: 'bad'}), 'root: bad');
  });
});

describe('messageForIssue', () => {
  const msg = (keyword: string | undefined, params?: Record<string, unknown>) =>
    messageForIssue({path: ['a'], message: 'engine text', keyword, params});

  it('words each keyword from its params, ignoring the engine text', () => {
    assert.strictEqual(msg('required', {missingProperty: 'id'}), "missing required property 'id'");
    assert.strictEqual(msg('type', {type: 'string'}), 'must be string');
    assert.strictEqual(msg('type', {type: ['string', 'null']}), 'must be string or null');
    assert.strictEqual(msg('type', {type: 'string,null'}), 'must be string or null');
    assert.strictEqual(msg('const', {allowedValue: '1.0'}), 'must be "1.0"');
    assert.strictEqual(msg('enum', {allowedValues: ['a', 1]}), 'must be one of "a", 1');
    assert.strictEqual(
      msg('additionalProperties', {additionalProperty: 'x'}),
      "unexpected property 'x'",
    );
    assert.strictEqual(
      msg('unevaluatedProperties', {unevaluatedProperty: 'y'}),
      "unexpected property 'y'",
    );
    assert.strictEqual(msg('not'), 'must not match the disallowed schema');
    assert.strictEqual(msg('oneOf'), 'must match exactly one of the allowed schemas');
    assert.strictEqual(msg('anyOf'), 'must match at least one of the allowed schemas');
    assert.strictEqual(msg('format'), "fails the 'format' constraint");
  });

  it('keeps the message of an issue without a keyword', () => {
    assert.strictEqual(msg(undefined), 'engine text');
  });

  it('is used by formatIssue', () => {
    assert.strictEqual(
      formatIssue({path: ['x'], message: 'ignored', keyword: 'type', params: {type: 'number'}}),
      'x: must be number',
    );
  });
});

describe('toA2uiIssues', () => {
  it('normalizes path segments to strings or numbers', () => {
    const issues = toA2uiIssues([
      {message: 'm1', path: ['a', 1, {key: 'b'}, {key: 2}]},
      {message: 'm2'},
    ]);
    assert.deepStrictEqual(issues, [
      {path: ['a', 1, 'b', 2], message: 'm1'},
      {path: [], message: 'm2'},
    ]);
  });
});

describe('assertSync', () => {
  it('returns synchronous values', () => {
    assert.strictEqual(assertSync(5, 'Button'), 5);
  });

  it('throws A2uiConfigurationError naming the subject for promises', () => {
    assert.throws(
      () => assertSync(Promise.resolve(1), 'Button'),
      (e: unknown) => e instanceof A2uiConfigurationError && e.message.includes('Button'),
    );
  });
});
