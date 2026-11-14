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
import {assertSync, formatIssue, pickIssue, toA2uiIssues} from './issues.js';

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
