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

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {inlineAllOfRefs} from './generate-superset-common-types.mjs';

describe('inlineAllOfRefs', () => {
  it('correctly resolves shared base in diamond inheritance without skipping sibling branches', () => {
    const defs = {
      Base: {
        type: 'object',
        properties: {
          baseId: {type: 'string'},
        },
        required: ['baseId'],
      },
      BranchA: {
        allOf: [{$ref: '#/$defs/Base'}],
        properties: {
          propA: {type: 'string'},
        },
      },
      BranchB: {
        allOf: [{$ref: '#/$defs/Base'}],
        properties: {
          propB: {type: 'number'},
        },
      },
    };

    const target = {
      allOf: [{$ref: '#/$defs/BranchA'}, {$ref: '#/$defs/BranchB'}],
      properties: {
        targetProp: {type: 'boolean'},
      },
    };

    const inlined = inlineAllOfRefs(target, defs);
    assert.deepStrictEqual(inlined.properties, {
      baseId: {type: 'string'},
      propA: {type: 'string'},
      propB: {type: 'number'},
      targetProp: {type: 'boolean'},
    });
    assert.deepStrictEqual(inlined.required, ['baseId']);
  });

  it('guards against circular allOf references', () => {
    const defs = {
      CycleA: {
        allOf: [{$ref: '#/$defs/CycleB'}],
        properties: {a: {type: 'string'}},
      },
      CycleB: {
        allOf: [{$ref: '#/$defs/CycleA'}],
        properties: {b: {type: 'string'}},
      },
    };

    const target = {
      allOf: [{$ref: '#/$defs/CycleA'}],
      properties: {root: {type: 'string'}},
    };

    const inlined = inlineAllOfRefs(target, defs);
    assert.deepStrictEqual(inlined.properties, {
      a: {type: 'string'},
      b: {type: 'string'},
      root: {type: 'string'},
    });
  });
});
