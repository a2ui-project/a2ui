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
import assert from 'node:assert';

import {specSchema} from '../test/schema.js';
const basicTypesGen = await import(
  new URL('../../../scripts/generate-basic-catalog-types.mjs', import.meta.url).href
);
const {generateTypes, generateCommonTypes, commonTypeNames} = basicTypesGen;

describe('ExtensionsSchema', () => {
  it('validates ExtensionsSchema enforcing UAX #31 Unicode identifier keys', () => {
    for (const schema of [specSchema({$ref: 'common_types.json#/$defs/Extensions'})]) {
      // Valid Unicode identifier keys (including non-ASCII XID identifiers)
      const valid = {
        a2ui_custom: 'test',
        myExt123: 42,
        _private_key: true,
        café_ext: 'unicode',
        valid_identifier: {nested: 'value'},
      };
      const validResult = schema.safeParse(valid);
      assert.strictEqual(validResult.success, true);

      // Invalid keys: containing dashes, spaces, punctuation, or leading digits
      const invalidWithDash = schema.safeParse({'invalid-key': 123});
      assert.strictEqual(invalidWithDash.success, false);

      const invalidWithSpace = schema.safeParse({'invalid key': 123});
      assert.strictEqual(invalidWithSpace.success, false);

      const invalidWithLeadingDigit = schema.safeParse({'123start': 123});
      assert.strictEqual(invalidWithLeadingDigit.success, false);
    }
  });
});

describe('generate-basic-catalog-types.mjs', () => {
  const doc = {
    components: {
      Label: {
        type: 'object',
        allOf: [
          {$ref: 'common_types.json#/$defs/ComponentCommon'},
          {$ref: '#/$defs/Common'},
          {
            type: 'object',
            properties: {
              component: {const: 'Label'},
              text: {$ref: 'common_types.json#/$defs/DynamicString', description: 'The text.'},
              size: {type: 'string', enum: ['s', 'm']},
              items: {type: 'array', items: {$ref: 'common_types.json#/$defs/ComponentId'}},
            },
            required: ['component', 'text'],
          },
        ],
      },
    },
    $defs: {
      Common: {type: 'object', properties: {weight: {type: 'number'}}},
      anyComponent: {oneOf: [{$ref: '#/components/Label'}]},
    },
  };

  it('emits one props interface per component, with bindings as the common types', () => {
    const names = new Set(['ComponentCommonProps', 'ComponentId', 'DynamicString']);
    const out: string = generateTypes(doc, 'test/catalog.json', names);
    assert.match(out, /export interface LabelProps extends ComponentCommonProps, Common \{/);
    assert.match(out, /text: DynamicString;/);
    assert.match(out, /size\?: 's' \| 'm';/);
    assert.match(out, /items\?: Array<ComponentId>;/);
    assert.match(out, /export interface Common \{\n {2}weight\?: number;/);
    assert.ok(!/component[?]?:/.test(out), 'the envelope discriminator is not a prop');
    assert.ok(!out.includes('anyComponent'), 'the computed unions are not types');
    assert.match(
      out,
      /import type \{ComponentCommonProps, ComponentId, DynamicString\} from '__COMMON_TYPES__';/,
    );
    assert.match(out, /export interface BasicCatalogProps \{\n {2}Label: LabelProps;\n\}/);
  });

  it('rejects a common types reference its version does not define', () => {
    assert.throws(
      () => generateTypes(doc, 'test/catalog.json', new Set(['ComponentCommonProps'])),
      /unmapped common_types \$ref 'common_types.json#\/\$defs\/DynamicString'/,
    );
  });

  it("emits each version's common types with its own spelling, closed and required", () => {
    const common = {
      $defs: {
        DataBinding: {
          type: 'object',
          properties: {'@path': {type: 'string'}},
          required: ['@path'],
          additionalProperties: false,
        },
        DynamicString: {oneOf: [{type: 'string'}, {$ref: '#/$defs/DataBinding'}]},
        ComponentCommon: {type: 'object', properties: {id: {type: 'string'}}, required: ['id']},
        FunctionCall: {
          type: 'object',
          allOf: [{oneOf: [{$ref: 'catalog.json#/$defs/anyFunction'}]}],
        },
      },
    };
    const out: string = generateCommonTypes(common, 'test/common_types.json');
    assert.match(out, /export type DataBinding = \{[^}]*'@path': string;\n\};/);
    assert.match(out, /export type DynamicString = \(string\) \| \(DataBinding\);/);
    assert.match(out, /export type CatalogFunctionCall = \{/);
    assert.match(
      out,
      /export type ComponentCommonProps = Omit<ComponentCommon, 'id' \| '@catalogId'>;/,
    );
    assert.deepStrictEqual([...commonTypeNames(common)].sort(), [
      'ComponentCommon',
      'ComponentCommonProps',
      'DataBinding',
      'DynamicString',
      'FunctionCall',
    ]);
    assert.throws(
      () => generateCommonTypes({$defs: {X: {$ref: '#/$defs/Missing'}}}, 'test/common_types.json'),
      /unmapped \$ref/,
    );
  });
});
