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
import {ExtensionsSchema as V10ExtensionsSchema} from '../v1_0/schema/common-types.js';
const zodCore = await import(
  new URL('../../../scripts/zod-generator-core.mjs', import.meta.url).href
);
const {
  getHeader,
  transformZodSyntax,
  getDependencies,
  analyzeDependencies,
  resolveRefTarget,
  prepareRef,
  compileDefToZod,
} = zodCore;

const basicTypesGen = await import(
  new URL('../../../scripts/generate-basic-catalog-types.mjs', import.meta.url).href
);
const {generateTypes, generateCommonTypes, commonTypeNames} = basicTypesGen;

describe('zod-generator-core.mjs', () => {
  it('generates standard header comment with version and script source', () => {
    const header = getHeader('v1.0', 'scripts/test-source.mjs');
    assert.ok(header.includes('Copyright 2024 Google LLC'));
    assert.ok(header.includes('AUTO-GENERATED FILE - DO NOT EDIT MANUALLY'));
    assert.ok(header.includes('specification/v1.0/json/ via scripts/test-source.mjs'));
  });

  it('transforms raw json-schema-to-zod syntax cleanly', () => {
    const raw = `export const DynamicNumberSchema: z.ZodType<unknown> = z.union([z.number(), z.literal("__REF__DataBindingSchema__")]);
const x = z.core.$ZodIssue;
ctx.addIssue(issue);
if (a == i) {}`;

    const cleaned = transformZodSyntax(raw);
    assert.ok(!cleaned.includes(': z.ZodType<unknown>'));
    assert.ok(cleaned.includes('export const DynamicNumberSchema ='));
    assert.ok(cleaned.includes('DataBindingSchema'));
    assert.ok(!cleaned.includes('__REF__'));
    assert.ok(cleaned.includes('z.ZodIssue'));
    assert.ok(cleaned.includes('ctx.addIssue(issue as any);'));
    assert.ok(cleaned.includes('=== i)'));
  });

  it('extracts definition dependencies from JSON schema nodes', () => {
    const schemaNode = {
      type: 'object',
      properties: {
        id: {$ref: '#/$defs/ComponentId'},
        action: {$ref: '#/$defs/Action'},
      },
    };
    const deps = getDependencies(schemaNode);
    assert.ok(deps.has('ComponentId'));
    assert.ok(deps.has('Action'));
  });

  it('ignores FunctionCall.oneOf during dependency analysis to avoid false cycles', () => {
    const functionCallNode = {
      type: 'object',
      properties: {
        call: {type: 'string'},
        args: {$ref: '#/$defs/DynamicValue'},
      },
      oneOf: [{$ref: '#/$defs/IndexSystemFunction'}],
    };
    const deps = getDependencies(functionCallNode, new Set(), 'FunctionCall');
    assert.ok(deps.has('DynamicValue'));
    assert.ok(!deps.has('IndexSystemFunction'));
  });

  it('analyzes dependency graph and performs topological sorting and cycle detection', () => {
    const defs = {
      A: {$ref: '#/$defs/B'},
      B: {$ref: '#/$defs/C'},
      C: {type: 'string'},
      Cyclic1: {$ref: '#/$defs/Cyclic2'},
      Cyclic2: {$ref: '#/$defs/Cyclic1'},
    };
    const {topologicalOrder, lazyEdges} = analyzeDependencies(defs);
    assert.ok(topologicalOrder.indexOf('C') < topologicalOrder.indexOf('B'));
    assert.ok(topologicalOrder.indexOf('B') < topologicalOrder.indexOf('A'));
    assert.ok(lazyEdges.has('Cyclic1->Cyclic2') || lazyEdges.has('Cyclic2->Cyclic1'));
  });

  it('resolves $ref targets with appropriate wrappers and lazy evaluation', () => {
    const lazyEdges = new Set(['Parent->Child']);
    const topo = ['Child', 'Parent'];

    const lazyRef = resolveRefTarget('#/$defs/Child', 'Parent', lazyEdges, topo);
    assert.deepStrictEqual(lazyRef, {enum: ['__REF__z.lazy(() => ChildSchema)__']});

    const normalRef = resolveRefTarget('#/$defs/Child', 'Parent', new Set(), topo);
    assert.deepStrictEqual(normalRef, {enum: ['__REF__ChildSchema__']});

    const remoteRef = resolveRefTarget('https://example.com/schema.json', 'Parent');
    assert.deepStrictEqual(remoteRef, {type: 'object', additionalProperties: true});

    const themeRef = resolveRefTarget('catalog.json#/$defs/theme', 'Parent');
    assert.deepStrictEqual(themeRef, {});
  });

  it('prepares ref nodes for json-schema-to-zod syntax replacement', () => {
    const res = prepareRef({$ref: '#/$defs/DynamicNumber'}, 'Parent');
    assert.deepStrictEqual(res, {enum: ['__REF__DynamicNumberSchema__']});
  });

  it('rewrites key-presence oneOf branches into object schemas', () => {
    const node = {
      type: 'object',
      properties: {a: {type: 'string', description: 'A.'}, b: {type: 'number'}},
      oneOf: [
        {required: ['a'], not: {required: ['b']}},
        {required: ['b'], not: {required: ['a']}},
      ],
    };
    const res = prepareRef(node, 'Parent');
    assert.deepStrictEqual(res.anyOf, [
      {type: 'object', properties: {a: {type: 'string'}, b: false}, required: ['a']},
      {type: 'object', properties: {b: {type: 'number'}, a: false}, required: ['b']},
    ]);
  });

  it('leaves oneOf branches it cannot express as key presence unchanged', () => {
    const multiKeyNot = {not: {required: ['a', 'b']}};
    const unknownKey = {required: ['c']};
    const node = {
      type: 'object',
      properties: {a: {type: 'string'}, b: {type: 'number'}},
      oneOf: [multiKeyNot, unknownKey],
    };
    const res = prepareRef(node, 'Parent');
    assert.deepStrictEqual(res.anyOf, [multiKeyNot, unknownKey]);
  });

  it('compiles a JSON Schema definition into Zod code', () => {
    const def = {
      type: 'object',
      properties: {
        title: {type: 'string'},
        count: {type: 'number'},
      },
      required: ['title'],
    };
    const code = compileDefToZod(def, 'TestWidget');
    assert.ok(code.includes('export const TestWidgetSchema ='));
    assert.ok(code.includes('export type TestWidget = z.infer<typeof TestWidgetSchema>'));
  });
});

describe('ExtensionsSchema', () => {
  it('validates ExtensionsSchema enforcing UAX #31 Unicode identifier keys', () => {
    for (const schema of [V10ExtensionsSchema]) {
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
