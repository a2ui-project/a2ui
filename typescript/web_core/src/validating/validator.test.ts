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
 * @fileoverview Unit tests for A2uiValidator, integrity checks, path syntax validation, and graph topology analysis.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  getComponentReferences,
  validateComponentIntegrity,
  validateRecursionAndPaths,
} from './integrity-checker.js';
import {analyzeTopology} from './topology-analyzer.js';
import {A2uiValidator, RELAXED_VALIDATION, STRICT_VALIDATION} from './validator.js';
import {A2uiIntegrityError, A2uiRecursionError, A2uiValidationError} from '../errors.js';

describe('A2uiValidator & Integrity Verification', () => {
  describe('getComponentReferences', () => {
    it('extracts references from container components', () => {
      const refMap = {
        Container: [new Set(['singleChild', 'nestedObj']), new Set(['childrenList', 'tabs'])],
      } as const;

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

      const refs = Array.from(getComponentReferences(comp, refMap as any));
      const refIds = refs.map(([id]) => id);

      assert.ok(refIds.includes('child1'));
      assert.ok(refIds.includes('child2'));
      assert.ok(refIds.includes('child3'));
      assert.ok(refIds.includes('child4'));
      assert.ok(refIds.includes('tab1'));
      assert.ok(refIds.includes('tab2'));
    });
  });

  describe('validateComponentIntegrity', () => {
    it('passes for valid component tree', () => {
      const refMap = {Box: [new Set(['child']), new Set()]} as const;
      const components = [
        {id: 'root', component: {Box: {child: 'c1'}}},
        {id: 'c1', component: {Box: {}}},
      ];
      assert.doesNotThrow(() => validateComponentIntegrity(components, refMap as any));
    });

    it('throws on duplicate component ID', () => {
      const components = [
        {id: 'c1', component: 'Box'},
        {id: 'c1', component: 'Text'},
      ];
      assert.throws(
        () => validateComponentIntegrity(components, {}),
        (err: any) =>
          err instanceof A2uiIntegrityError && err.message.includes('Duplicate component ID: c1'),
      );
    });

    it('throws on missing root component', () => {
      const components = [{id: 'c1', component: 'Box'}];
      assert.throws(
        () => validateComponentIntegrity(components, {}),
        (err: any) =>
          err instanceof A2uiIntegrityError && err.message.includes("No component has id='root'"),
      );
    });

    it('throws on dangling component reference', () => {
      const refMap = {Box: [new Set(['child']), new Set()]} as const;
      const components = [{id: 'root', component: {Box: {child: 'nonexistent'}}}];
      assert.throws(
        () => validateComponentIntegrity(components, refMap as any),
        (err: any) =>
          err instanceof A2uiIntegrityError &&
          err.message.includes("references non-existent component 'nonexistent'"),
      );
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
        (err: any) =>
          err instanceof A2uiValidationError && err.message.includes('Invalid path syntax'),
      );
    });

    it('throws when global recursion depth limit is exceeded', () => {
      let deepList: any = [];
      for (let i = 0; i < 52; i++) {
        deepList = [deepList];
      }
      assert.throws(
        () => validateRecursionAndPaths(deepList),
        (err: any) =>
          err instanceof A2uiRecursionError &&
          err.message.includes('Global recursion limit exceeded'),
      );
    });

    it('throws when function call recursion depth limit is exceeded', () => {
      const deepCall: Record<string, any> = {};
      let curr = deepCall;
      for (let i = 0; i < 6; i++) {
        curr.call = 'func';
        curr.args = {};
        curr = curr.args;
      }
      assert.throws(
        () => validateRecursionAndPaths(deepCall),
        (err: any) =>
          err instanceof A2uiRecursionError && err.message.includes('Recursion limit exceeded'),
      );
    });
  });

  describe('analyzeTopology', () => {
    it('passes for valid graph topology', () => {
      const refMap = {Node: [new Set(['next']), new Set()]} as const;
      const components = [
        {id: 'root', component: {Node: {next: 'n1'}}},
        {id: 'n1', component: {Node: {}}},
      ];
      const visited = analyzeTopology(components, refMap as any, {allowOrphanComponents: false});
      assert.strictEqual(visited.size, 2);
      assert.ok(visited.has('root'));
      assert.ok(visited.has('n1'));
    });

    it('detects self-reference', () => {
      const refMap = {Node: [new Set(['next']), new Set()]} as const;
      const components = [{id: 'root', component: {Node: {next: 'root'}}}];
      assert.throws(
        () => analyzeTopology(components, refMap as any),
        (err: any) =>
          err instanceof A2uiRecursionError &&
          err.message.includes("Component 'root' references itself"),
      );
    });

    it('detects circular reference', () => {
      const refMap = {Node: [new Set(['next']), new Set()]} as const;
      const components = [
        {id: 'root', component: {Node: {next: 'n1'}}},
        {id: 'n1', component: {Node: {next: 'root'}}},
      ];
      assert.throws(
        () => analyzeTopology(components, refMap as any),
        (err: any) =>
          err instanceof A2uiRecursionError && err.message.includes('Circular reference detected'),
      );
    });

    it('detects orphan components when prohibited', () => {
      const refMap = {Node: [new Set(['next']), new Set()]} as const;
      const components = [
        {id: 'root', component: {Node: {}}},
        {id: 'orphan', component: {Node: {}}},
      ];
      assert.throws(
        () => analyzeTopology(components, refMap as any, {allowOrphanComponents: false}),
        (err: any) =>
          err instanceof A2uiIntegrityError &&
          err.message.includes("Component 'orphan' is not reachable"),
      );
    });
  });

  describe('A2uiValidator Full Pipeline', () => {
    const validator = new A2uiValidator();

    it('validates a valid message envelope stream', () => {
      const payload = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'main',
            catalogId: 'https://a2ui.org/catalog',
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'main',
            components: [
              {
                id: 'root',
                component: 'Column',
                children: ['c1'],
              },
              {
                id: 'c1',
                component: 'Text',
                text: 'Hello World',
              },
            ],
          },
        },
      ];

      assert.doesNotThrow(() => validator.validate(payload));
    });

    it('respects relaxed validation config for dangling references & orphans', () => {
      const orphanPayload = {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {id: 'root', component: 'Column', children: ['c1']},
            {id: 'c1', component: 'Text', text: 'Child'},
            {id: 'orphan', component: 'Text', text: 'Unused'},
          ],
        },
      };

      assert.throws(
        () => validator.validate(orphanPayload, undefined, STRICT_VALIDATION),
        (err: any) => err instanceof A2uiIntegrityError && err.message.includes('not reachable'),
      );

      assert.doesNotThrow(() => validator.validate(orphanPayload, undefined, RELAXED_VALIDATION));
    });

    it('enforces missing root even when allowDanglingReferences is true', () => {
      const components = [{id: 'c1', component: 'Text', text: 'No root'}];
      assert.throws(
        () =>
          validateComponentIntegrity(
            components,
            {},
            {allowDanglingReferences: true, allowMissingRoot: false},
          ),
        (err: any) =>
          err instanceof A2uiIntegrityError && err.message.includes("No component has id='root'"),
      );
    });

    it('validates components split across multiple stream messages', () => {
      const splitPayload = [
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'root', component: 'Column', children: ['c1']}],
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'c1', component: 'Text', text: 'Child in second message'}],
          },
        },
      ];

      assert.doesNotThrow(() => validator.validate(splitPayload, undefined, STRICT_VALIDATION));
    });
  });
});
