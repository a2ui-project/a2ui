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

/**
 * @fileoverview Unit tests for component integrity checking and path syntax recursion validation.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {getComponentReferences, validateRecursionAndPaths} from './integrity-checker.js';
import {A2uiIntegrityError, A2uiRecursionError, A2uiValidationError} from '../errors.js';
import {ComponentRefMap} from '../catalog/reference-map.js';

describe('Integrity Verification', () => {
  describe('getComponentReferences', () => {
    it('extracts references from container components', () => {
      const refMap: ComponentRefMap = {
        Container: {
          singleRefs: new Set(['singleChild', 'nestedObj']),
          listRefs: new Set(['childrenList', 'tabs']),
        },
      };

      const comp = {
        id: 'c1',
        component: {
          Container: {
            singleChild: 'child1',
            childrenList: ['child2', 'child3'],
            nestedObj: {componentId: 'child4'},
            tabs: [{child: 'tab1'}, {child: 'tab2'}],
          },
        },
      };

      const refs = Array.from(getComponentReferences(comp, refMap));
      const refIds = refs.map(([id]) => id);

      assert.ok(refIds.includes('child1'));
      assert.ok(refIds.includes('child2'));
      assert.ok(refIds.includes('child3'));
      assert.ok(refIds.includes('child4'));
      assert.ok(refIds.includes('tab1'));
      assert.ok(refIds.includes('tab2'));
    });
  });

  describe('validateRecursionAndPaths', () => {
    it('passes valid path syntax', () => {
      const data = {path: '/valid/path', nested: [{path: '/another'}]};
      assert.doesNotThrow(() => validateRecursionAndPaths(data));
    });

    it('throws on unescaped invalid path syntax', () => {
      const data = {path: 'invalid~path//double'};
      assert.throws(
        () => validateRecursionAndPaths(data),
        (err: unknown) =>
          err instanceof A2uiValidationError && err.message.includes('Invalid path syntax'),
      );
    });

    it('throws when global recursion depth limit is exceeded', () => {
      let deepList: unknown[] = [];
      for (let i = 0; i < 52; i++) {
        deepList = [deepList];
      }
      assert.throws(
        () => validateRecursionAndPaths(deepList),
        (err: unknown) =>
          err instanceof A2uiRecursionError &&
          err.message.includes('Global recursion limit exceeded'),
      );
    });

    it('throws when function call recursion depth limit is exceeded', () => {
      const deepCall: Record<string, unknown> = {};
      let curr = deepCall;
      for (let i = 0; i < 6; i++) {
        curr.call = 'func';
        const nextArgs: Record<string, unknown> = {};
        curr.args = nextArgs;
        curr = nextArgs;
      }
      assert.throws(
        () => validateRecursionAndPaths(deepCall),
        (err: unknown) =>
          err instanceof A2uiRecursionError && err.message.includes('Recursion limit exceeded'),
      );
    });

    it('throws when wrapped functionCall recursion depth limit is exceeded', () => {
      let wrappedCall: Record<string, unknown> = {call: 'leaf', args: {}};
      for (let i = 0; i < 6; i++) {
        wrappedCall = {functionCall: wrappedCall};
      }
      assert.throws(
        () => validateRecursionAndPaths(wrappedCall),
        (err: unknown) =>
          err instanceof A2uiRecursionError && err.message.includes('Recursion limit exceeded'),
      );
    });
  });

  describe('Integrity and Recursion Errors', () => {
    it('instantiates A2uiIntegrityError and A2uiRecursionError with custom error codes', () => {
      const integrityErr = new A2uiIntegrityError('Integrity failed');
      assert.strictEqual(integrityErr.code, 'INTEGRITY_ERROR');
      assert.strictEqual(integrityErr.name, 'A2uiIntegrityError');

      const recursionErr = new A2uiRecursionError('Recursion exceeded');
      assert.strictEqual(recursionErr.code, 'RECURSION_ERROR');
      assert.strictEqual(recursionErr.name, 'A2uiRecursionError');
    });
  });
});
