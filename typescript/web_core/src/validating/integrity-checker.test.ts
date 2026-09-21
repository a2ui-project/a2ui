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
import {buildComponentRefMap, ComponentRefMap} from '../catalog/reference-map.js';
import {BASIC_COMPONENTS} from '../v1_0/basic_catalog/components/basic_components.js';
import {V10_CHILD_REF_OPTIONS} from '../v1_0/standard_defs.js';

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

    it('ignores sibling properties of a structured array item', () => {
      const refMap: ComponentRefMap = {
        Container: {
          singleRefs: new Set<string>(),
          listRefs: new Set(['tabs']),
          nestedRefs: {tabs: new Set(['child'])},
        },
      };

      const comp = {
        id: 'c1',
        component: {
          Container: {
            tabs: [
              {title: 'Overview', child: 'tab1'},
              {title: 'Details', child: 'tab2'},
            ],
          },
        },
      };

      const refs = Array.from(getComponentReferences(comp, refMap));

      assert.deepEqual(refs, [
        ['tab1', 'tabs[0].child'],
        ['tab2', 'tabs[1].child'],
      ]);
    });

    it('treats only the declared sub-key of the shipped Tabs schema as a reference', () => {
      const refMap = buildComponentRefMap(BASIC_COMPONENTS, V10_CHILD_REF_OPTIONS);

      assert.deepEqual(refMap['Tabs'].nestedRefs, {tabs: new Set(['child'])});

      const comp = {
        id: 'c1',
        component: {
          Tabs: {
            tabs: [{title: 'Overview', child: 'c2'}],
          },
        },
      };

      const refIds = Array.from(getComponentReferences(comp, refMap)).map(([id]) => id);

      assert.deepEqual(refIds, ['c2']);
    });

    it('falls back to a full sweep when the schema declared no nested keys', () => {
      const refMap: ComponentRefMap = {
        Container: {
          singleRefs: new Set<string>(),
          listRefs: new Set(['items']),
        },
      };

      const comp = {
        id: 'c1',
        component: {Container: {items: [{child: 'a', other: 'b'}]}},
      };

      const refIds = Array.from(getComponentReferences(comp, refMap)).map(([id]) => id);

      assert.deepEqual(refIds, ['a', 'b']);
    });

    it('extracts child list arrays from structured array items matching nestedKeys', () => {
      const refMap: ComponentRefMap = {
        Accordion: {
          singleRefs: new Set<string>(),
          listRefs: new Set(['sections']),
          nestedRefs: {sections: new Set(['children'])},
        },
      };

      const comp = {
        id: 'c1',
        component: {
          Accordion: {
            sections: [
              {title: 'Section 1', children: ['c2', 'c3']},
              {title: 'Section 2', children: ['c4']},
            ],
          },
        },
      };

      const refs = Array.from(getComponentReferences(comp, refMap));
      assert.deepEqual(refs, [
        ['c2', 'sections[0].children[0]'],
        ['c3', 'sections[0].children[1]'],
        ['c4', 'sections[1].children[0]'],
      ]);
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
