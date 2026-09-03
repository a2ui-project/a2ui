/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';
import {z} from 'zod';
import {Catalog, ComponentApi, FunctionApi, FunctionImplementation} from './types.js';
import {generateCatalogSchema, cleanSchemaNode} from './schema_generator.js';

describe('Catalog.catalogSchema & schema_generator', () => {
  it('generates standard JSON Schema from a Catalog with native Zod components and functions', () => {
    const textComp: ComponentApi = {
      name: 'Text',
      allowedParents: ['Column', 'Row'],
      allowedChildren: undefined,
      schema: z.object({
        text: z.string().describe('Text content to display'),
        variant: z.enum(['body', 'h1']).optional(),
      }),
    };

    const containerComp: ComponentApi = {
      name: 'Container',
      allowedParents: undefined,
      allowedChildren: ['Text', 'Container'],
      schema: z.object({
        children: z
          .array(z.string())
          .describe('REF:common_types.json#/$defs/ChildList|List of children'),
      }),
    };

    const greetFunc: FunctionImplementation = {
      name: 'greet',
      description: 'Greets the user',
      returnType: 'string',
      allowedCallers: 'rendererOnly',
      requiresUserActivation: true,
      schema: z.object({
        name: z.string(),
      }),
      execute: async args => `Hello, ${args.name}!`,
    };

    const themeSchema = z.object({
      primaryColor: z.string(),
    });

    const catalog = new Catalog(
      'https://example.com/test-catalog.json',
      [textComp, containerComp],
      [greetFunc],
      themeSchema,
      'System instructions for rendering',
    );

    const schema = catalog.catalogSchema;

    assert.strictEqual(schema['$schema'], 'https://json-schema.org/draft/2020-12/schema');
    assert.strictEqual(schema['catalogId'], 'https://example.com/test-catalog.json');
    assert.strictEqual(schema['instructions'], 'System instructions for rendering');

    // Verify components
    const components = schema['components'] as Record<string, any>;
    assert.ok(components);
    assert.ok(components['Text']);
    assert.deepStrictEqual(components['Text'].properties.component, {const: 'Text'});
    assert.ok(components['Text'].required.includes('component'));
    assert.ok(components['Text'].required.includes('text'));
    assert.deepStrictEqual(components['Text'].allowedParents, ['Column', 'Row']);

    assert.ok(components['Container']);
    assert.deepStrictEqual(components['Container'].allowedChildren, ['Text', 'Container']);
    // Verify REF marker processing
    assert.deepStrictEqual(components['Container'].properties.children, {
      $ref: '#/$defs/ChildList',
      description: 'List of children',
    });

    // Verify functions
    const functions = schema['functions'] as Record<string, any>;
    assert.ok(functions);
    assert.ok(functions['greet']);
    assert.strictEqual(functions['greet'].description, 'Greets the user');
    assert.ok(functions['greet'].properties.name);

    // Verify $defs
    const defs = schema['$defs'] as Record<string, any>;
    assert.ok(defs);
    assert.ok(defs['theme']);
    assert.ok(defs['theme'].properties.primaryColor);

    assert.deepStrictEqual(defs['anyComponent'], {
      oneOf: [{$ref: '#/components/Text'}, {$ref: '#/components/Container'}],
      discriminator: {
        propertyName: 'component',
      },
    });

    assert.deepStrictEqual(defs['anyFunction'], {
      oneOf: [{$ref: '#/functions/greet'}],
    });
  });

  it('correctly serializes a catalog ingested via Catalog.fromSchema', () => {
    const rawCatalog = {
      catalogId: 'https://example.com/ingested_catalog.json',
      instructions: 'Use accessible widgets.',
      components: {
        Button: {
          properties: {
            label: {type: 'string'},
            action: {type: 'string'},
          },
          required: ['label'],
          allowedParents: ['Toolbar'],
        },
      },
      functions: {
        calculateTotal: {
          description: 'Calculates order total',
          returnType: 'number',
          allowedCallers: 'agentOnly',
          requiresUserActivation: false,
          properties: {
            args: {
              type: 'object',
              properties: {
                subtotal: {type: 'number'},
                tax: {type: 'number'},
              },
              required: ['subtotal'],
            },
          },
        },
      },
    };

    const catalog = Catalog.fromSchema(rawCatalog);
    const generated = catalog.catalogSchema;

    assert.strictEqual(generated['catalogId'], 'https://example.com/ingested_catalog.json');
    assert.strictEqual(generated['instructions'], 'Use accessible widgets.');

    const components = generated['components'] as Record<string, any>;
    assert.ok(components['Button']);
    assert.deepStrictEqual(components['Button'].allowedParents, ['Toolbar']);
    assert.deepStrictEqual(components['Button'].properties.component, {const: 'Button'});
    assert.ok(components['Button'].required.includes('label'));

    const functions = generated['functions'] as Record<string, any>;
    assert.ok(functions['calculateTotal']);
    assert.ok(functions['calculateTotal'].properties.subtotal);

    const defs = generated['$defs'] as Record<string, any>;
    assert.deepStrictEqual(defs['anyComponent'], {
      oneOf: [{$ref: '#/components/Button'}],
      discriminator: {propertyName: 'component'},
    });
    assert.deepStrictEqual(defs['anyFunction'], {
      oneOf: [{$ref: '#/functions/calculateTotal'}],
    });
  });

  it('memoizes the catalogSchema getter across multiple reads', () => {
    const catalog = new Catalog('https://example.com/memo.json', []);
    const schema1 = catalog.catalogSchema;
    const schema2 = catalog.catalogSchema;
    assert.strictEqual(schema1, schema2);
  });

  it('supports componentEnvelopeRef wrapping in generateCatalogSchema', () => {
    const textComp: ComponentApi = {
      name: 'CustomText',
      schema: z.object({text: z.string()}),
    };
    const catalog = new Catalog('https://example.com/envelope.json', [textComp]);
    const schema = generateCatalogSchema(catalog, {
      componentEnvelopeRef: 'https://example.com/base.json#/$defs/Base',
    });

    const components = schema['components'] as Record<string, any>;
    assert.ok(components['CustomText'].allOf);
    assert.strictEqual(
      components['CustomText'].allOf[0].$ref,
      'https://example.com/base.json#/$defs/Base',
    );
  });

  it('protects component discriminator from schema property overwrite', () => {
    const compWithComponentProp: ComponentApi = {
      name: 'SpecialWidget',
      schema: z.object({
        component: z.string().describe('Custom component type string'),
        value: z.number(),
      }),
    };
    const catalog = new Catalog('https://example.com/discrim.json', [compWithComponentProp]);
    const schema = catalog.catalogSchema;
    const components = schema['components'] as Record<string, any>;

    assert.deepStrictEqual(components['SpecialWidget'].properties.component, {
      const: 'SpecialWidget',
    });
  });

  it('safely handles cyclic schemas in cleanSchemaNode without infinite recursion', () => {
    const cyclicObj: Record<string, unknown> = {
      name: 'cyclic',
    };
    cyclicObj['self'] = cyclicObj;

    assert.doesNotThrow(() => {
      cleanSchemaNode(cyclicObj);
    });
  });

  it('correctly parses multi-pipe descriptions in cleanSchemaNode', () => {
    const node: Record<string, unknown> = {
      type: 'string',
      description: 'REF:common_types.json#/$defs/DynamicString|Format: YYYY-MM-DD | ISO-8601',
    };

    cleanSchemaNode(node);
    assert.strictEqual(node['$ref'], '#/$defs/DynamicString');
    assert.strictEqual(node['description'], 'Format: YYYY-MM-DD | ISO-8601');
    assert.strictEqual(node['type'], undefined);
  });

  it('handles empty catalogs and catalogs without functions or theme', () => {
    const catalog = new Catalog('https://example.com/empty.json', []);
    const schema = catalog.catalogSchema;

    assert.strictEqual(schema['catalogId'], 'https://example.com/empty.json');
    assert.deepStrictEqual(schema['components'], {});
    assert.strictEqual(schema['functions'], undefined);
    assert.strictEqual(schema['$defs'], undefined);
  });

  it('lifts theme sub-definitions to root $defs and removes them from theme object', () => {
    const ColorPalette = z.object({
      primary: z.string(),
      secondary: z.string(),
    });
    const ThemeWithSubDefs = z.object({
      palette: ColorPalette,
    });

    const catalog = new Catalog('https://example.com/theme-defs.json', [], [], ThemeWithSubDefs);
    const schema = catalog.catalogSchema;
    const defs = schema['$defs'] as Record<string, any>;
    assert.ok(defs);
    assert.ok(defs['theme']);
    assert.strictEqual(defs['theme'].definitions, undefined);
    assert.strictEqual(defs['theme'].$defs, undefined);
  });

  it('lifts function sub-definitions to root $defs and removes them from args object', () => {
    const Address = z.object({
      city: z.string(),
      country: z.string(),
    });
    const updateAddressFunc: FunctionImplementation = {
      name: 'updateAddress',
      description: 'Updates user address',
      returnType: 'void',
      schema: z.object({
        address: Address,
      }),
      execute: async () => {},
    };

    const catalog = new Catalog('https://example.com/fn-defs.json', [], [updateAddressFunc]);
    const schema = catalog.catalogSchema;
    const functions = schema['functions'] as Record<string, any>;
    assert.ok(functions['updateAddress']);
    assert.strictEqual(functions['updateAddress'].definitions, undefined);
    assert.strictEqual(functions['updateAddress'].$defs, undefined);
  });

  it('emits unevaluatedProperties: false on flat components and preserves theme additionalProperties', () => {
    const SimpleWidget: ComponentApi = {
      name: 'SimpleWidget',
      schema: z.object({
        title: z.string(),
      }),
    };
    const SimpleTheme = z
      .object({
        primaryColor: z.string(),
      })
      .passthrough();

    const catalog = new Catalog(
      'https://example.com/unevaluated.json',
      [SimpleWidget],
      [],
      SimpleTheme,
    );
    const schema = catalog.catalogSchema;
    const components = schema['components'] as Record<string, any>;
    const defs = schema['$defs'] as Record<string, any>;

    assert.strictEqual(components['SimpleWidget'].unevaluatedProperties, false);
    assert.strictEqual(defs['theme'].additionalProperties, true);
  });

  it('emits unevaluatedProperties: false at the root of allOf when componentEnvelopeRef is used', () => {
    const CustomWidget: ComponentApi = {
      name: 'CustomWidget',
      schema: z.object({
        label: z.string(),
      }),
    };

    const catalog = new Catalog('https://example.com/envelope.json', [CustomWidget]);
    const schema = generateCatalogSchema(catalog, {
      componentEnvelopeRef: 'common_types.json#/$defs/ComponentCommon',
    });
    const components = schema['components'] as Record<string, any>;
    const widget = components['CustomWidget'];

    assert.ok(Array.isArray(widget.allOf));
    assert.strictEqual(widget.unevaluatedProperties, false);
    assert.strictEqual(widget.allOf[1].additionalProperties, undefined);
  });

  it('respects explicit protocolVersion in GenerateCatalogSchemaOptions for non-standard catalog IDs', () => {
    const CustomWidget: ComponentApi = {
      name: 'CustomWidget',
      schema: z.object({
        content: z.string().describe('REF:#/$defs/DynamicString'),
      }),
    };

    const catalog = new Catalog('guid-550e8400-e29b-41d4-a716-446655440000', [CustomWidget]);
    const v10Schema = generateCatalogSchema(catalog, {
      protocolVersion: 'v1.0',
    });
    const v10Defs = v10Schema['$defs'] as Record<string, any>;
    assert.ok(v10Defs);
    assert.ok(v10Defs['DynamicString']);

    const v08Schema = generateCatalogSchema(catalog, {
      protocolVersion: 'v0.8',
    });
    const v08Defs = v08Schema['$defs'] as Record<string, any>;
    assert.ok(v08Defs);
  });

  it('respects explicit standardDefs in GenerateCatalogSchemaOptions', () => {
    const CustomWidget: ComponentApi = {
      name: 'CustomWidget',
      schema: z.object({
        content: z.string().describe('REF:#/$defs/CustomType'),
      }),
    };

    const customDefs = {
      CustomType: {type: 'string', description: 'Explicit custom definition'},
    };

    const catalog = new Catalog('https://example.com/arbitrary-id', [CustomWidget]);
    const schema = generateCatalogSchema(catalog, {
      standardDefs: customDefs,
    });
    const defs = schema['$defs'] as Record<string, any>;
    assert.ok(defs);
    assert.deepStrictEqual(defs.CustomType, customDefs.CustomType);
  });

  it('emits unevaluatedProperties on function argument schemas', () => {
    const strictFunction: FunctionApi = {
      name: 'strictFn',
      returnType: 'string',
      schema: z.object({
        query: z.string(),
      }),
    };
    const openFunction: FunctionApi = {
      name: 'openFn',
      returnType: 'string',
      schema: z
        .object({
          tag: z.string(),
        })
        .passthrough(),
    };

    const catalog = new Catalog(
      'https://example.com/functions-unevaluated.json',
      [],
      [strictFunction as any, openFunction as any],
    );
    const schema = catalog.catalogSchema;
    const functions = schema['functions'] as Record<string, any>;

    assert.ok(functions);
    assert.strictEqual(functions['strictFn'].unevaluatedProperties, false);
    assert.strictEqual(functions['strictFn'].additionalProperties, undefined);
    assert.strictEqual(functions['openFn'].unevaluatedProperties, true);
    assert.strictEqual(functions['openFn'].additionalProperties, undefined);
  });
});
