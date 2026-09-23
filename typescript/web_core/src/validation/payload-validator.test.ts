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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {z} from 'zod';
import {Catalog} from '../catalog/types.js';
import {PayloadValidator} from './payload-validator.js';
import {STRICT_VALIDATION} from '../validating/integrity-checker.js';
import {A2uiValidationError} from '../errors.js';

describe('PayloadValidator', () => {
  it('enforces UAX #31 identifiers on component IDs and functions in v1.0 but not v0.9', () => {
    const v10Cat = new Catalog(
      'https://example.com/v10',
      '1.0',
      [{name: 'Text', schema: z.object({text: z.string()})}],
      [{name: 'format', returnType: 'string', schema: z.object({val: z.string()})}],
    );
    const v09Cat = new Catalog(
      'https://example.com/v09',
      '0.9',
      [{name: 'Text', schema: z.object({text: z.string()})}],
      [{name: 'format', returnType: 'string', schema: z.object({val: z.string()})}],
    );

    const v10Validator = new PayloadValidator(v10Cat, STRICT_VALIDATION);
    const v09Validator = new PayloadValidator(v09Cat, STRICT_VALIDATION);

    assert.throws(
      () => v10Validator.validateComponent({id: '123bad', component: 'Text', text: 'hi'}),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message.includes("Component id '123bad' must be a valid UAX #31 identifier"),
    );
    assert.doesNotThrow(() =>
      v09Validator.validateComponent({id: '123bad', component: 'Text', text: 'hi'}),
    );

    assert.throws(
      () => v10Validator.validateFunction('bad-fn', {val: 'x'}),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message.includes("Function name 'bad-fn' must be a valid UAX #31 identifier"),
    );
    assert.throws(
      () => v10Validator.validateFunction('format', {'bad-arg': 'x'}),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message.includes(
          "Function argument 'bad-arg' in function 'format' must be a valid UAX #31 identifier",
        ),
    );
  });

  it('recursively validates nested FunctionCalls inside component properties and honors catalogId overrides', () => {
    const appCat = Catalog.fromSchema({
      catalogId: 'app-cat',
      protocolVersion: '1.0',
      components: {
        Text: {
          type: 'object',
          properties: {
            text: {$ref: 'common_types.json#/$defs/DynamicString'},
          },
          required: ['text'],
        },
      },
      functions: {
        upper: {
          returnType: 'string',
          properties: {
            input: {type: 'string'},
          },
          required: ['input'],
          additionalProperties: false,
        },
      },
    });

    const validator = new PayloadValidator(appCat, STRICT_VALIDATION);

    // Valid nested function in default catalog
    assert.doesNotThrow(() =>
      validator.validateComponent({
        id: 't1',
        component: 'Text',
        text: {call: 'upper', args: {input: 'hello'}},
      }),
    );

    // Unknown nested function in default catalog fails
    assert.throws(
      () =>
        validator.validateComponent({
          id: 't1',
          component: 'Text',
          text: {call: 'nonExistent', args: {}},
        }),
      A2uiValidationError,
    );

    // Invalid argument in nested function fails
    assert.throws(
      () =>
        validator.validateComponent({
          id: 't1',
          component: 'Text',
          text: {call: 'upper', args: {wrongArg: 123}},
        }),
      A2uiValidationError,
    );

    // Nested function with foreign catalogId skips schema validation against appCat
    assert.doesNotThrow(() =>
      validator.validateComponent({
        id: 't1',
        component: 'Text',
        text: {call: 'joinStrings', catalogId: 'util-cat', args: {wrongArg: 123}},
      }),
    );

    // Foreign function with invalid UAX #31 identifier fails in v1.0
    assert.throws(
      () =>
        validator.validateComponent({
          id: 't1',
          component: 'Text',
          text: {call: 'invalid-name-!', catalogId: 'util-cat', args: {}},
        }),
      A2uiValidationError,
    );

    // Non-object arguments to function fails validation
    assert.throws(
      () =>
        validator.validateComponent({
          id: 't1',
          component: 'Text',
          text: {call: 'upper', args: 'not_an_object'},
        }),
      A2uiValidationError,
    );
  });

  it('validates recursive bare $defs references at arbitrary depth', () => {
    const cat = Catalog.fromSchema({
      catalogId: 'https://a2ui.org/catalogs/recursive',
      protocolVersion: '1.0',
      $defs: {
        TreeNode: {
          type: 'object',
          properties: {
            label: {type: 'string'},
            children: {
              type: 'array',
              items: {$ref: '#/$defs/TreeNode'},
            },
          },
          required: ['label'],
          additionalProperties: false,
        },
      },
      components: {
        TreeView: {
          type: 'object',
          properties: {
            id: {type: 'string'},
            component: {const: 'TreeView'},
            root: {$ref: '#/$defs/TreeNode'},
          },
          required: ['id', 'component', 'root'],
        },
      },
    });
    const validator = new PayloadValidator(cat, STRICT_VALIDATION);

    assert.doesNotThrow(() =>
      validator.validateComponent({
        id: 't1',
        component: 'TreeView',
        root: {
          label: 'root',
          children: [
            {
              label: 'child1',
              children: [{label: 'grandchild'}],
            },
          ],
        },
      }),
    );

    // Missing required 'label' at depth 2 fails validation
    assert.throws(
      () =>
        validator.validateComponent({
          id: 't2',
          component: 'TreeView',
          root: {
            label: 'root',
            children: [{children: []}],
          },
        }),
      A2uiValidationError,
    );
  });

  it('rejects unresolvable bare $defs references during component validation', () => {
    const cat = Catalog.fromSchema({
      catalogId: 'https://a2ui.org/catalogs/broken_ref',
      protocolVersion: '1.0',
      components: {
        BrokenComp: {
          type: 'object',
          properties: {
            id: {type: 'string'},
            component: {const: 'BrokenComp'},
            field: {$ref: '#/$defs/NonExistentType'},
          },
          required: ['id', 'component', 'field'],
        },
      },
    });
    const validator = new PayloadValidator(cat, STRICT_VALIDATION);

    assert.throws(
      () => validator.validateComponent({id: 'c1', component: 'BrokenComp', field: 'val'}),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message.includes("Unresolvable schema reference: '#/$defs/NonExistentType'"),
    );
  });

  it('enforces enum + DataBinding unions, bounds constraints, nested strictness, and oneOf exclusivity', () => {
    const cat = Catalog.fromSchema({
      catalogId: 'https://a2ui.org/catalogs/constraints',
      protocolVersion: '1.0',
      components: {
        ConstrainedWidget: {
          type: 'object',
          properties: {
            iconName: {
              oneOf: [
                {type: 'string', enum: ['home', 'search']},
                {$ref: 'common_types.json#/$defs/DataBinding'},
              ],
            },
            score: {
              type: 'number',
              minimum: 0,
              maximum: 100,
            },
            code: {
              type: 'string',
              minLength: 2,
              maxLength: 5,
            },
            tags: {
              type: 'array',
              items: {type: 'string'},
              minItems: 1,
              maxItems: 3,
              uniqueItems: true,
            },
            meta: {
              type: 'object',
              properties: {
                key: {type: 'string'},
              },
              required: ['key'],
              additionalProperties: false,
            },
            exclusiveNum: {
              oneOf: [
                {type: 'number', multipleOf: 3},
                {type: 'number', multipleOf: 5},
              ],
            },
            metaList: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  a: {type: 'number'},
                  b: {type: 'number'},
                },
              },
              uniqueItems: true,
            },
          },
          required: ['iconName'],
          additionalProperties: false,
        },
      },
    });
    const validator = new PayloadValidator(cat, STRICT_VALIDATION);

    // Both literal enum and DataBinding pass on iconName
    assert.doesNotThrow(() =>
      validator.validateComponent({
        id: 'w1',
        component: 'ConstrainedWidget',
        iconName: 'home',
        score: 50,
        code: 'ABC',
        tags: ['a', 'b'],
        meta: {key: 'v'},
        exclusiveNum: 9, // multiple of 3 only
      }),
    );
    assert.doesNotThrow(() =>
      validator.validateComponent({
        id: 'w2',
        component: 'ConstrainedWidget',
        iconName: {path: '/user/icon'},
      }),
    );

    // Invalid enum literal rejected
    assert.throws(
      () =>
        validator.validateComponent({
          id: 'w3',
          component: 'ConstrainedWidget',
          iconName: 'invalid_icon',
        }),
      A2uiValidationError,
    );

    // Numeric bounds violation rejected
    assert.throws(
      () =>
        validator.validateComponent({
          id: 'w4',
          component: 'ConstrainedWidget',
          iconName: 'home',
          score: 150,
        }),
      A2uiValidationError,
    );

    // Nested object additionalProperties: false violation rejected
    assert.throws(
      () =>
        validator.validateComponent({
          id: 'w5',
          component: 'ConstrainedWidget',
          iconName: 'home',
          meta: {key: 'v', extra: 1},
        }),
      A2uiValidationError,
    );

    // oneOf exclusivity: 15 matches both multipleOf 3 and multipleOf 5 -> rejected
    assert.throws(
      () =>
        validator.validateComponent({
          id: 'w6',
          component: 'ConstrainedWidget',
          iconName: 'home',
          exclusiveNum: 15,
        }),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message.includes('Value matched more than one schema in oneOf'),
    );

    // uniqueItems: rejects semantically duplicate items even with different key ordering
    assert.throws(
      () =>
        validator.validateComponent({
          id: 'w7',
          component: 'ConstrainedWidget',
          iconName: 'home',
          metaList: [
            {a: 1, b: 2},
            {b: 2, a: 1},
          ],
        }),
      (err: unknown) =>
        err instanceof A2uiValidationError && err.message.includes('Array items must be unique'),
    );

    // uniqueItems: distinct items pass
    assert.doesNotThrow(() =>
      validator.validateComponent({
        id: 'w8',
        component: 'ConstrainedWidget',
        iconName: 'home',
        metaList: [
          {a: 1, b: 2},
          {a: 1, b: 3},
        ],
      }),
    );
  });

  it('validates @index system function calls in v1.0 catalogs without explicit @index registration', () => {
    const cat = Catalog.fromSchema({
      catalogId: 'https://a2ui.org/catalogs/custom_v10',
      protocolVersion: '1.0',
      components: {
        RowItem: {
          type: 'object',
          properties: {
            id: {type: 'string'},
            component: {const: 'RowItem'},
            indexVal: {$ref: 'common_types.json#/$defs/DynamicNumber'},
          },
          required: ['id', 'component', 'indexVal'],
        },
      },
    });
    const validator = new PayloadValidator(cat, STRICT_VALIDATION);

    assert.doesNotThrow(() =>
      validator.validateComponent({
        id: 'item1',
        component: 'RowItem',
        indexVal: {call: '@index', args: {offset: 0}},
      }),
    );

    assert.throws(
      () =>
        validator.validateComponent({
          id: 'item2',
          component: 'RowItem',
          indexVal: {call: '@index', args: {offset: 'not-a-number'}},
        }),
      A2uiValidationError,
    );
  });
});
