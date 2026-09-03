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

const supersetGen = await import(
  new URL('../../../scripts/generate-superset-common-types.mjs', import.meta.url).href
);
const {
  escapeStr,
  getLatestDescription,
  mergeUnionSchemas,
  collectAllPropertyNames,
  findRequiredInAllProperties,
  mergeObjectSchemas,
  mergeEnumSchemas,
  deepMergeSchemas,
  generateZod,
} = supersetGen;

const catalogGen = await import(
  new URL('../../../scripts/generate-catalog-schemas.mjs', import.meta.url).href
);
const {
  toPascalCase,
  extractRefName,
  findInSchemaList,
  findReferencedDefName,
  applyModifiers,
  generatePrimitiveZod,
  generateObjectSchemaZod,
  generateArrayZod,
  generatePropertyZod,
  mergeSchemaProperties,
  flattenSchema,
  extractFunctionDefinition,
  generateComponentsFile,
  generateFunctionsFile,
} = catalogGen;

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

describe('generate-superset-common-types.mjs', () => {
  it('escapes string literals safely', () => {
    assert.strictEqual(escapeStr("hello 'world'"), "hello \\'world\\'");
    assert.strictEqual(escapeStr('line1\nline2'), 'line1\\nline2');
    assert.strictEqual(escapeStr(''), '');
  });

  it('merges object schemas with oneOf constraints as objects rather than union of unknowns', () => {
    const functionResponseV10 = {
      type: 'object',
      description: 'The return response matching a function invocation.',
      properties: {
        functionCallId: {$ref: '#/$defs/CallId'},
        value: {description: 'The return value of the function.'},
        error: {
          type: 'object',
          properties: {
            code: {type: 'string'},
            message: {type: 'string'},
          },
          required: ['code', 'message'],
          additionalProperties: false,
        },
      },
      required: ['functionCallId'],
      oneOf: [{required: ['value']}, {required: ['error']}],
      additionalProperties: false,
    };

    const merged = deepMergeSchemas([functionResponseV10]);
    assert.strictEqual(merged.type, 'object');
    assert.ok(merged.properties);
    assert.ok(merged.properties.functionCallId);
    assert.ok(merged.properties.value);
    assert.ok(merged.properties.error);
    assert.strictEqual(merged.oneOf, undefined);

    const generated = generateZod(merged, 'FunctionResponse');
    assert.ok(generated.includes('z.object({'));
    assert.ok(generated.includes("'functionCallId': CallIdSchema"));
    assert.ok(generated.includes("'value': z.unknown()"));
    assert.ok(!generated.includes('z.union([z.unknown(), z.unknown()])'));
  });

  it('merges enum schemas across multiple specification versions', () => {
    const enumV09 = {type: 'string', enum: ['off', 'polite']};
    const enumV10 = {type: 'string', enum: ['polite', 'assertive']};

    const merged = mergeEnumSchemas([enumV09, enumV10]);
    assert.deepStrictEqual(merged.enum.sort(), ['assertive', 'off', 'polite']);
  });

  it('merges union schemas and deduplicates branches', () => {
    const u1 = {oneOf: [{type: 'string'}, {$ref: '#/$defs/DataBinding'}]};
    const u2 = {oneOf: [{$ref: '#/$defs/DataBinding'}, {type: 'number'}]};

    const merged = mergeUnionSchemas([u1, u2]);
    assert.strictEqual(merged.oneOf.length, 3);
  });

  it('collects all property names across multiple schemas', () => {
    const s1 = {properties: {a: {type: 'string'}, b: {type: 'number'}}};
    const s2 = {properties: {b: {type: 'number'}, c: {type: 'boolean'}}};

    const names = collectAllPropertyNames([s1, s2]);
    assert.deepStrictEqual(Array.from(names).sort(), ['a', 'b', 'c']);
  });

  it('finds properties that are required across all versions where they exist', () => {
    const s1 = {properties: {id: {type: 'string'}, name: {type: 'string'}}, required: ['id']};
    const s2 = {
      properties: {id: {type: 'string'}, name: {type: 'string'}},
      required: ['id', 'name'],
    };

    const required = findRequiredInAllProperties([s1, s2], ['id', 'name']);
    assert.deepStrictEqual(required, ['id']);
  });

  it('generates Zod code for primitive types, arrays, objects, and literals', () => {
    const strCode = generateZod({type: 'string', default: 'abc', description: 'desc'});
    assert.ok(strCode.includes("z.string().default('abc').describe('desc')"));

    const numCode = generateZod({type: 'integer', default: 5});
    assert.ok(numCode.includes('z.number().int().default(5)'));

    const arrCode = generateZod({type: 'array', items: {type: 'string'}, minItems: 1});
    assert.ok(arrCode.includes('z.array(z.string()).min(1)'));

    const constCode = generateZod({const: 'Surface'});
    assert.ok(constCode.includes("z.literal('Surface')"));
  });

  it('retrieves the latest description from a list of schemas', () => {
    assert.strictEqual(
      getLatestDescription([{description: 'Old description'}, {description: 'New description'}]),
      'New description',
    );
    assert.strictEqual(getLatestDescription([{}, {}]), undefined);
  });

  it('merges object schemas and resolves combined property definitions', () => {
    const s1 = {type: 'object', properties: {a: {type: 'string'}}, required: ['a']};
    const s2 = {type: 'object', properties: {b: {type: 'number'}}, required: ['b']};
    const merged = mergeObjectSchemas([s1, s2]);
    assert.strictEqual(merged.type, 'object');
    assert.ok(merged.properties.a);
    assert.ok(merged.properties.b);
  });
});

describe('generate-catalog-schemas.mjs', () => {
  it('converts function names to PascalCase identifiers', () => {
    assert.strictEqual(toPascalCase('@index'), 'Index');
    assert.strictEqual(toPascalCase('format_string'), 'FormatString');
    assert.strictEqual(toPascalCase('open-url'), 'OpenUrl');
    assert.strictEqual(toPascalCase('validateEmail'), 'ValidateEmail');
  });

  it('extracts definition names from $ref pointers', () => {
    assert.strictEqual(extractRefName('#/$defs/DynamicNumber'), 'DynamicNumber');
    assert.strictEqual(extractRefName('common_types.json#/$defs/ChildList'), 'ChildList');
    assert.strictEqual(extractRefName('https://example.com/types/Button'), 'Button');
    assert.strictEqual(extractRefName(null), null);
  });

  it('finds referenced definition names inside allOf or direct ref', () => {
    const commonDefs = {DynamicString: {type: 'string'}};
    assert.strictEqual(
      findReferencedDefName({$ref: '#/$defs/DynamicString'}, commonDefs),
      'DynamicString',
    );
    assert.strictEqual(
      findReferencedDefName({allOf: [{$ref: '#/$defs/DynamicString'}]}, commonDefs),
      'DynamicString',
    );
    assert.strictEqual(findReferencedDefName({type: 'string'}, commonDefs), null);
  });

  it('locates definition in a list of schema catalog objects', () => {
    const list = [{$ref: '#/$defs/DynamicString'}, {type: 'string'}];
    const commonDefs = {DynamicString: {type: 'string'}};
    assert.strictEqual(findInSchemaList(list, commonDefs), 'DynamicString');
    assert.strictEqual(findInSchemaList([{type: 'string'}], commonDefs), null);
  });

  it('generates property zod code for ref, primitive, or object schemas', () => {
    const commonDefs = {DynamicString: {type: 'string'}};
    const usedImports = new Set<string>();
    const code = generatePropertyZod(
      'title',
      {$ref: '#/$defs/DynamicString', description: 'text'},
      ['title'],
      commonDefs,
      usedImports,
    );
    assert.strictEqual(code, "DynamicStringSchema.describe('REF:#/$defs/DynamicString|text')");
    assert.ok(usedImports.has('DynamicStringSchema'));
  });

  it('merges properties across multiple component schemas', () => {
    const target: {properties: Record<string, unknown>; required: string[]} = {
      properties: {a: {type: 'string'}},
      required: ['a'],
    };
    const source = {properties: {b: {type: 'number'}}, required: ['b']};
    mergeSchemaProperties(target, source);
    assert.ok(target.properties.a);
    assert.ok(target.properties.b);
    assert.deepStrictEqual(target.required, ['a', 'b']);
  });

  it('applies modifiers such as default, description, and optionality', () => {
    const code = applyModifiers('z.string()', {default: 'defaultVal', description: 'text'}, false);
    assert.strictEqual(code, "z.string().default('defaultVal').describe('text').optional()");

    const requiredCode = applyModifiers('z.number()', {}, true);
    assert.strictEqual(requiredCode, 'z.number()');
  });

  it('generates primitive Zod expressions', () => {
    assert.strictEqual(generatePrimitiveZod({type: 'string'}), 'z.string()');
    assert.strictEqual(generatePrimitiveZod({type: 'integer'}), 'z.number().int()');
    assert.strictEqual(generatePrimitiveZod({type: 'number'}), 'z.number()');
    assert.strictEqual(generatePrimitiveZod({type: 'boolean'}), 'z.boolean()');
    assert.strictEqual(generatePrimitiveZod({type: 'object'}), null);
  });

  it('generates object and array Zod expressions', () => {
    const usedImports = new Set<string>();
    const commonDefs = {DynamicString: {type: 'string'}};

    const objCode = generateObjectSchemaZod(
      {
        properties: {
          label: {$ref: '#/$defs/DynamicString'},
        },
        required: ['label'],
      },
      commonDefs,
      usedImports,
    );
    assert.ok(objCode.includes('z.object({'));
    assert.ok(usedImports.has('DynamicStringSchema'));

    const arrCode = generateArrayZod(
      {
        type: 'array',
        items: {$ref: '#/$defs/DynamicString'},
        minItems: 2,
      },
      commonDefs,
      usedImports,
    );
    assert.ok(arrCode.includes('z.array(DynamicStringSchema).min(2)'));
  });

  it('flattens allOf inheritance and resolves catalog and common definitions', () => {
    const catalogDefs = {
      BaseWidget: {
        properties: {
          id: {type: 'string'},
          weight: {type: 'number'},
        },
        required: ['id'],
      },
    };
    const schema = {
      allOf: [
        {$ref: '#/$defs/BaseWidget'},
        {
          properties: {
            title: {type: 'string'},
          },
          required: ['title'],
        },
      ],
    };

    const flattened = flattenSchema(schema, catalogDefs);
    assert.ok(flattened.properties.id);
    assert.ok(flattened.properties.weight);
    assert.ok(flattened.properties.title);
    assert.ok(flattened.required.includes('id'));
    assert.ok(flattened.required.includes('title'));
  });

  it('extracts function definitions with returnType and args schema', () => {
    const funcDef = {
      description: 'Formats a timestamp string.',
      properties: {
        returnType: {const: 'string'},
        args: {
          type: 'object',
          properties: {
            date: {type: 'string'},
            format: {type: 'string'},
          },
          required: ['date'],
        },
      },
    };

    const extracted = extractFunctionDefinition('formatDate', funcDef);
    assert.strictEqual(extracted.returnType, 'string');
    assert.strictEqual(extracted.description, 'Formats a timestamp string.');
    assert.ok(extracted.argsProps.date);
    assert.ok(extracted.argsProps.format);
    assert.deepStrictEqual(extracted.argsRequired, ['date']);
  });

  it('generates complete components and functions TypeScript code', () => {
    const catalogJson = {
      components: {
        Card: {
          properties: {
            title: {type: 'string'},
            component: {const: 'Card'},
            id: {type: 'string'},
          },
          required: ['title', 'component', 'id'],
        },
      },
      functions: {
        formatCurrency: {
          description: 'Formats monetary value',
          properties: {
            returnType: {const: 'string'},
            args: {
              type: 'object',
              properties: {
                amount: {type: 'number'},
              },
              required: ['amount'],
            },
          },
        },
      },
    };

    const compFile = generateComponentsFile('v1.0', catalogJson, {});
    assert.ok(compFile.includes('export const CardApi = {'));
    assert.ok(compFile.includes('satisfies ComponentApi;'));
    assert.ok(compFile.includes('BASIC_COMPONENTS: ComponentApi[]'));

    const funcFile = generateFunctionsFile('v1.0', catalogJson, {});
    assert.ok(funcFile.includes('export const FormatCurrencyApi = {'));
    assert.ok(funcFile.includes("name: 'formatCurrency' as const"));
    assert.ok(funcFile.includes("returnType: 'string' as const"));
    assert.ok(funcFile.includes('BASIC_FUNCTION_APIS'));
  });
});
