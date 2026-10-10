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

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {z} from 'zod';

import {CheckRuleSchema} from '../types/common-types.js';
import {V09_STANDARD_DEFS} from '../v0_9/standard_defs.js';
import {V10_STANDARD_DEFS} from '../v1_0/standard_defs.js';
import {cleanSchemaNode, generateCatalogSchema} from './schema_generator.js';
import {Catalog, ComponentApi, FunctionApi, FunctionImplementation} from './types.js';

/** A standard definition as validationSchema bundles it: its catalog union ref localized. */
function bundled(definition: unknown): unknown {
  return JSON.parse(
    JSON.stringify(definition).replaceAll('catalog.json#/$defs/anyFunction', '#/$defs/anyFunction'),
  );
}

/** Asserts that every `$ref` in a schema is local and resolves within it. */
function assertRefsLocalAndResolvable(schema: Record<string, unknown>): void {
  const resolve = (ref: string): unknown =>
    ref
      .slice(2)
      .split('/')
      .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce<unknown>(
        (node, key) =>
          node !== null && typeof node === 'object'
            ? (node as Record<string, unknown>)[key]
            : undefined,
        schema,
      );
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}/${i}`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const ref = (node as Record<string, unknown>)['$ref'];
    if (typeof ref === 'string') {
      assert.ok(ref.startsWith('#/'), `${at}: '${ref}' is not a local reference`);
      assert.notStrictEqual(resolve(ref), undefined, `${at}: '${ref}' does not resolve`);
    }
    for (const [key, value] of Object.entries(node)) walk(value, `${at}/${key}`);
  };
  walk(schema, '');
}

describe('Catalog.validationSchema & schema_generator', () => {
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
      '1.0',
      [textComp, containerComp],
      [greetFunc],
      themeSchema,
      'System instructions for rendering',
    );

    const schema = catalog.validationSchema;

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
    assert.deepStrictEqual(functions['greet'], {
      type: 'object',
      description: 'Greets the user',
      returnType: 'string',
      allowedCallers: 'rendererOnly',
      requiresUserActivation: true,
      properties: {
        '@call': {const: 'greet'},
        args: {
          type: 'object',
          properties: {name: {type: 'string'}},
          required: ['name'],
          unevaluatedProperties: false,
        },
      },
      required: ['@call', 'args'],
    });

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

  it('correctly serializes a catalog ingested via Catalog.fromJson', () => {
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

    const catalog = Catalog.fromJson(rawCatalog, '0.9');
    const generated = catalog.validationSchema;

    assert.strictEqual(generated['catalogId'], 'https://example.com/ingested_catalog.json');
    assert.strictEqual(generated['instructions'], 'Use accessible widgets.');

    const components = generated['components'] as Record<string, any>;
    assert.ok(components['Button']);
    assert.deepStrictEqual(components['Button'].allowedParents, ['Toolbar']);
    assert.deepStrictEqual(components['Button'].properties.component, {const: 'Button'});
    assert.ok(components['Button'].required.includes('label'));

    const functions = generated['functions'] as Record<string, any>;
    const calculateTotal = functions['calculateTotal'];
    assert.strictEqual(calculateTotal.description, 'Calculates order total');
    assert.deepStrictEqual(calculateTotal.properties.call, {const: 'calculateTotal'});
    assert.deepStrictEqual(calculateTotal.properties.returnType, {const: 'number'});
    assert.ok(calculateTotal.properties.args.properties.subtotal);
    assert.deepStrictEqual(calculateTotal.properties.args.required, ['subtotal']);
    assert.deepStrictEqual(calculateTotal.required, ['call', 'args']);
    assert.strictEqual(calculateTotal.unevaluatedProperties, false);

    const defs = generated['$defs'] as Record<string, any>;
    assert.deepStrictEqual(defs['anyComponent'], {
      oneOf: [{$ref: '#/components/Button'}],
      discriminator: {propertyName: 'component'},
    });
    assert.deepStrictEqual(defs['anyFunction'], {
      oneOf: [{$ref: '#/functions/calculateTotal'}],
    });
  });

  it('memoizes the validationSchema getter across multiple reads', () => {
    const catalog = new Catalog('https://example.com/memo.json', '1.0', []);
    const schema1 = catalog.validationSchema;
    const schema2 = catalog.validationSchema;
    assert.strictEqual(schema1, schema2);
  });

  it('supports componentEnvelopeRef wrapping in generateCatalogSchema', () => {
    const textComp: ComponentApi = {
      name: 'CustomText',
      schema: z.object({text: z.string()}),
    };
    const catalog = new Catalog('https://example.com/envelope.json', '1.0', [textComp]);
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
    const catalog = new Catalog('https://example.com/discrim.json', '1.0', [compWithComponentProp]);
    const schema = catalog.validationSchema;
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
    const catalog = new Catalog('https://example.com/empty.json', '1.0', []);
    const schema = catalog.validationSchema;

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

    const catalog = new Catalog(
      'https://example.com/theme-defs.json',
      '1.0',
      [],
      [],
      ThemeWithSubDefs,
    );
    const schema = catalog.validationSchema;
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

    const catalog = new Catalog('https://example.com/fn-defs.json', '1.0', [], [updateAddressFunc]);
    const schema = catalog.validationSchema;
    const functions = schema['functions'] as Record<string, any>;
    assert.ok(functions['updateAddress']);
    assert.strictEqual(functions['updateAddress'].properties.args.definitions, undefined);
    assert.strictEqual(functions['updateAddress'].properties.args.$defs, undefined);
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
      '0.9',
      [SimpleWidget],
      [],
      SimpleTheme,
    );
    const schema = catalog.validationSchema;
    const components = schema['components'] as Record<string, any>;
    const defs = schema['$defs'] as Record<string, any>;

    assert.strictEqual(components['SimpleWidget'].unevaluatedProperties, false);
    assert.strictEqual(defs['theme'].additionalProperties, true);
  });

  it('leaves v1.0 components open unless their author closed them', () => {
    const SimpleWidget: ComponentApi = {
      name: 'SimpleWidget',
      schema: z.object({title: z.string()}),
    };
    const coded = new Catalog('https://example.com/v10.json', '1.0', [SimpleWidget]);
    const codedWidget = (coded.validationSchema['components'] as Record<string, any>)[
      'SimpleWidget'
    ];
    assert.strictEqual('unevaluatedProperties' in codedWidget, false);

    const loaded = Catalog.fromJson({
      catalogId: 'https://example.com/v10-loaded.json',
      protocolVersion: 'v1.0',
      components: {
        Open: {type: 'object', properties: {component: {const: 'Open'}}},
        Closed: {
          type: 'object',
          properties: {component: {const: 'Closed'}},
          unevaluatedProperties: false,
        },
      },
    });
    const components = loaded.validationSchema['components'] as Record<string, any>;
    assert.strictEqual('unevaluatedProperties' in components['Open'], false);
    assert.strictEqual(components['Closed'].unevaluatedProperties, false);
  });

  it('emits unevaluatedProperties: false at the root of allOf when componentEnvelopeRef is used', () => {
    const CustomWidget: ComponentApi = {
      name: 'CustomWidget',
      schema: z.object({
        label: z.string(),
      }),
    };

    const catalog = new Catalog('https://example.com/envelope.json', '0.9', [CustomWidget]);
    const schema = generateCatalogSchema(catalog, {
      componentEnvelopeRef: 'common_types.json#/$defs/ComponentCommon',
    });
    const components = schema['components'] as Record<string, any>;
    const widget = components['CustomWidget'];

    assert.ok(Array.isArray(widget.allOf));
    assert.strictEqual(widget.allOf[0].$ref, 'common_types.json#/$defs/ComponentCommon');
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

    const catalog = new Catalog('guid-550e8400-e29b-41d4-a716-446655440000', '1.0', [CustomWidget]);

    for (const v10Ver of ['v1.0', '1.0', 'v1_0', '1.0.0', 'V1.0']) {
      const v10Schema = generateCatalogSchema(catalog, {
        protocolVersion: v10Ver,
      });
      const v10Defs = v10Schema['$defs'] as Record<string, any>;
      assert.ok(v10Defs, `Expected $defs for version ${v10Ver}`);
      assert.ok(v10Defs['DynamicString'], `Expected DynamicString for version ${v10Ver}`);
    }

    for (const v08Ver of ['v0.8', '0.8', 'v0_8', '0.8.0']) {
      const v08Schema = generateCatalogSchema(catalog, {
        protocolVersion: v08Ver,
      });
      const v08Defs = v08Schema['$defs'] as Record<string, any>;
      assert.ok(v08Defs, `Expected $defs for version ${v08Ver}`);
    }

    for (const v09Ver of ['v0.9', '0.9', 'v0.9.1', '0.9.1', 'v0_9']) {
      const v09Schema = generateCatalogSchema(catalog, {
        protocolVersion: v09Ver,
      });
      const v09Defs = v09Schema['$defs'] as Record<string, any>;
      assert.ok(v09Defs, `Expected $defs for version ${v09Ver}`);
    }
  });

  it("uses the catalog's own protocolVersion when no explicit one is given", () => {
    const CustomWidget: ComponentApi = {
      name: 'CustomWidget',
      schema: z.object({
        content: z.string().describe('REF:#/$defs/DynamicString'),
        child: z.string().describe('REF:#/$defs/Child'),
      }),
    };

    const v10Defs = new Catalog('https://example.com/v10.json', '1.0', [CustomWidget])
      .validationSchema['$defs'] as Record<string, unknown>;
    assert.deepStrictEqual(v10Defs['DynamicString'], V10_STANDARD_DEFS['DynamicString']);
    assert.deepStrictEqual(v10Defs['FunctionCall'], bundled(V10_STANDARD_DEFS['FunctionCall']));
    assert.deepStrictEqual(v10Defs['Child'], V10_STANDARD_DEFS['Child']);

    const v09Defs = new Catalog('https://example.com/v09.json', 'v0.9', [CustomWidget])
      .validationSchema['$defs'] as Record<string, unknown>;
    assert.deepStrictEqual(v09Defs['DynamicString'], V09_STANDARD_DEFS['DynamicString']);
    assert.deepStrictEqual(v09Defs['FunctionCall'], bundled(V09_STANDARD_DEFS['FunctionCall']));
    assert.strictEqual(v09Defs['Child'], undefined);

    const overridden = generateCatalogSchema(
      new Catalog('https://example.com/v10.json', '1.0', [CustomWidget]),
      {protocolVersion: 'v0.9'},
    )['$defs'] as Record<string, unknown>;
    assert.deepStrictEqual(overridden['DynamicString'], V09_STANDARD_DEFS['DynamicString']);
  });

  it('uses the v1.0 definitions for later versions with no entry of their own', () => {
    const CustomWidget: ComponentApi = {
      name: 'CustomWidget',
      schema: z.object({
        child: z.string().describe('REF:#/$defs/Child'),
      }),
    };

    for (const version of ['1.0.1', 'v1.1', '2.0']) {
      const defs = new Catalog('https://example.com/later.json', version, [CustomWidget])
        .validationSchema['$defs'] as Record<string, unknown>;
      assert.deepStrictEqual(defs['Child'], V10_STANDARD_DEFS['Child'], `version ${version}`);
    }

    const v092Defs = new Catalog('https://example.com/v092.json', '0.9.2', [
      {name: 'Label', schema: z.object({text: z.string().describe('REF:#/$defs/DynamicString')})},
    ]).validationSchema['$defs'] as Record<string, unknown>;
    assert.deepStrictEqual(v092Defs['DynamicString'], V09_STANDARD_DEFS['DynamicString']);
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

    const catalog = new Catalog('https://example.com/arbitrary-id', '1.0', [CustomWidget]);
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
      '1.0',
      [],
      [strictFunction as any, openFunction as any],
    );
    const schema = catalog.validationSchema;
    const functions = schema['functions'] as Record<string, any>;

    assert.ok(functions);
    const strictArgs = functions['strictFn'].properties.args;
    const openArgs = functions['openFn'].properties.args;
    assert.strictEqual(strictArgs.unevaluatedProperties, false);
    assert.strictEqual(strictArgs.additionalProperties, undefined);
    assert.strictEqual(openArgs.unevaluatedProperties, true);
    assert.strictEqual(openArgs.additionalProperties, undefined);
    // A v1.0 entry stays open, as published: the bundled FunctionCall closes
    // the call around it and FunctionCommon.
    assert.strictEqual('unevaluatedProperties' in functions['strictFn'], false);
    assert.strictEqual('unevaluatedProperties' in functions['openFn'], false);
  });

  it('emits the declared protocolVersion as a bare semantic version and omits it otherwise', () => {
    const declared = Catalog.fromJson({
      catalogId: 'https://example.com/declared.json',
      protocolVersion: 'v0.9.1',
      components: {},
    });
    assert.strictEqual(declared.validationSchema['protocolVersion'], '0.9.1');
    // The catalog document itself keeps the version as written.
    assert.strictEqual(declared.toJson()['protocolVersion'], 'v0.9.1');

    const bare = Catalog.fromJson({
      catalogId: 'https://example.com/bare.json',
      protocolVersion: '1.0',
      components: {},
    });
    assert.strictEqual(bare.validationSchema['protocolVersion'], '1.0');

    const undeclared = new Catalog('https://example.com/undeclared.json', '0.9', []);
    assert.strictEqual('protocolVersion' in undeclared.validationSchema, false);
  });

  it('only requires args when the function has required parameters', () => {
    const noArgsFunction: FunctionApi = {
      name: 'now',
      returnType: 'string',
      schema: z.object({format: z.string().optional()}),
    };
    const v09 = new Catalog('https://example.com/v09.json', '0.9', [], [noArgsFunction as any]);
    const fn = (v09.validationSchema['functions'] as Record<string, any>)['now'];
    assert.deepStrictEqual(fn.properties.call, {const: 'now'});
    assert.deepStrictEqual(fn.required, ['call']);
  });

  it('emits only local references that resolve, with or without functions', () => {
    const Label: ComponentApi = {
      name: 'Label',
      schema: z.object({text: z.string().describe('REF:common_types.json#/$defs/DynamicString')}),
    };
    const shout: FunctionApi = {
      name: 'shout',
      returnType: 'string',
      schema: z.object({value: z.string().describe('REF:common_types.json#/$defs/DynamicString')}),
    };
    for (const version of ['0.9', '1.0']) {
      const withFunctions = new Catalog(
        'https://example.com/refs.json',
        version,
        [Label],
        [shout as any],
      ).validationSchema;
      assertRefsLocalAndResolvable(withFunctions);

      const withoutFunctions = new Catalog('https://example.com/refs.json', version, [Label])
        .validationSchema;
      assertRefsLocalAndResolvable(withoutFunctions);
      const defs = withoutFunctions['$defs'] as Record<string, unknown>;
      assert.ok(defs['FunctionCall'], `FunctionCall is bundled for ${version}`);
      assert.deepStrictEqual(defs['anyFunction'], {not: {}}, `empty union for ${version}`);
    }

    const published = Catalog.fromJson({
      catalogId: 'https://example.com/published.json',
      protocolVersion: 'v1.0',
      components: {
        Label: {
          type: 'object',
          allOf: [{$ref: 'common_types.json#/$defs/Checkable'}],
          properties: {
            component: {const: 'Label'},
            text: {$ref: 'common_types.json#/$defs/DynamicString'},
          },
        },
      },
    });
    assertRefsLocalAndResolvable(published.validationSchema);
  });

  it('emits the published v1.0 function shape, which admits FunctionCommon keys', () => {
    const shout: FunctionApi = {
      name: 'shout',
      description: 'Upper-cases a string.',
      returnType: 'string',
      schema: z.object({value: z.string().describe('REF:common_types.json#/$defs/DynamicString')}),
    };
    const schema = new Catalog('https://example.com/v10.json', '1.0', [], [shout as any])
      .validationSchema;
    const entry = (schema['functions'] as Record<string, any>)['shout'];
    assert.deepStrictEqual(entry, {
      type: 'object',
      description: 'Upper-cases a string.',
      returnType: 'string',
      properties: {
        '@call': {const: 'shout'},
        args: {
          type: 'object',
          properties: {
            value: {
              $ref: '#/$defs/DynamicString',
              description: (V10_STANDARD_DEFS['DynamicString'] as Record<string, unknown>)[
                'description'
              ],
            },
          },
          required: ['value'],
          unevaluatedProperties: false,
        },
      },
      required: ['@call', 'args'],
    });

    // A call carrying `catalogId` is valid: the entry does not close the call,
    // the bundled FunctionCall does, after FunctionCommon declares `catalogId`.
    const defs = schema['$defs'] as Record<string, any>;
    assert.deepStrictEqual(defs['FunctionCall'].allOf[0], {$ref: '#/$defs/FunctionCommon'});
    assert.ok(defs['FunctionCommon'].properties.catalogId);
    assert.strictEqual(defs['FunctionCall'].unevaluatedProperties, false);
  });

  it('keeps an authored open theme open and a closed one closed', () => {
    const load = (theme: Record<string, unknown>) =>
      Catalog.fromJson({
        catalogId: 'https://example.com/theme.json',
        components: {},
        theme,
      }).validationSchema['$defs'] as Record<string, any>;

    const open = load({type: 'object', properties: {primaryColor: {type: 'string'}}});
    assert.notStrictEqual(open['theme'].additionalProperties, false);

    const closed = load({
      type: 'object',
      properties: {primaryColor: {type: 'string'}},
      additionalProperties: false,
    });
    assert.strictEqual(closed['theme'].additionalProperties, false);
  });

  it('excludes system functions and follows the source order of a loaded catalog', () => {
    const loaded = Catalog.fromJson({
      catalogId: 'https://example.com/order.json',
      protocolVersion: 'v1.0',
      components: {
        Zeta: {type: 'object', properties: {component: {const: 'Zeta'}}},
        Alpha: {type: 'object', properties: {component: {const: 'Alpha'}}},
      },
      functions: {
        zed: {type: 'object', returnType: 'string', properties: {'@call': {const: 'zed'}}},
        abc: {type: 'object', returnType: 'string', properties: {'@call': {const: 'abc'}}},
      },
    });
    const schema = loaded.validationSchema;
    const defs = schema['$defs'] as Record<string, any>;
    assert.deepStrictEqual(Object.keys(schema['functions'] as object), ['zed', 'abc']);
    assert.deepStrictEqual(defs['anyFunction'].oneOf, [
      {$ref: '#/functions/zed'},
      {$ref: '#/functions/abc'},
    ]);
    assert.deepStrictEqual(defs['anyComponent'].oneOf, [
      {$ref: '#/components/Zeta'},
      {$ref: '#/components/Alpha'},
    ]);

    const index: FunctionApi = {name: '@index', returnType: 'number', schema: z.object({})};
    const shout: FunctionApi = {name: 'shout', returnType: 'string', schema: z.object({})};
    const coded = new Catalog(
      'https://example.com/system.json',
      '1.0',
      [],
      [index as any, shout as any],
    ).validationSchema;
    assert.deepStrictEqual(Object.keys(coded['functions'] as object), ['shout']);
    assert.deepStrictEqual((coded['$defs'] as Record<string, any>)['anyFunction'].oneOf, [
      {$ref: '#/functions/shout'},
    ]);
  });

  it('keeps authored descriptions and annotations but not document metadata', () => {
    const loaded = Catalog.fromJson({
      $id: 'https://example.com/described/catalog.json',
      title: 'Described',
      description: 'Document description.',
      catalogId: 'https://example.com/described',
      protocolVersion: 'v1.0',
      components: {
        Profile: {
          type: 'object',
          description: 'Shows a person.',
          properties: {
            component: {const: 'Profile'},
            email: {type: 'string', title: 'Email', format: 'email', pattern: '^.+@.+$'},
            tags: {type: 'array', items: {type: 'string'}, uniqueItems: true},
          },
        },
      },
      theme: {
        type: 'object',
        description: 'Theme tokens.',
        properties: {accent: {type: 'string', format: 'color'}},
      },
    });
    const schema = loaded.validationSchema;
    for (const key of ['$id', 'title', 'description']) {
      assert.strictEqual(key in schema, false, `top-level ${key} is not emitted`);
    }
    const profile = (schema['components'] as Record<string, any>)['Profile'];
    assert.strictEqual(profile.description, 'Shows a person.');
    assert.deepStrictEqual(profile.properties.email, {
      type: 'string',
      title: 'Email',
      format: 'email',
      pattern: '^.+@.+$',
    });
    assert.strictEqual(profile.properties.tags.uniqueItems, true);
    const theme = (schema['$defs'] as Record<string, any>)['theme'];
    assert.strictEqual(theme.description, 'Theme tokens.');
    assert.strictEqual(theme.properties.accent.format, 'color');
  });

  it("describes standard references from the catalog's own protocol version", () => {
    const Field: ComponentApi = {
      name: 'Field',
      schema: z.object({checks: z.array(CheckRuleSchema).optional()}),
    };
    const describedRule = (version: string) =>
      (
        new Catalog('https://example.com/rules.json', version, [Field]).validationSchema[
          'components'
        ] as Record<string, any>
      )['Field'].properties.checks.items;

    assert.deepStrictEqual(describedRule('0.9'), {
      $ref: '#/$defs/CheckRule',
      description: (V09_STANDARD_DEFS['CheckRule'] as Record<string, unknown>)['description'],
    });
    assert.deepStrictEqual(describedRule('1.0'), {
      $ref: '#/$defs/CheckRule',
      description: (V10_STANDARD_DEFS['CheckRule'] as Record<string, unknown>)['description'],
    });
  });

  it('builds loaded entries from their authored JSON, keeping nested keywords', () => {
    const loaded = Catalog.fromJson({
      catalogId: 'https://example.com/authored.json',
      components: {
        Picker: {
          allOf: [
            {$ref: 'common_types.json#/$defs/ComponentCommon'},
            {$ref: 'common_types.json#/$defs/Checkable'},
            {$ref: '#/$defs/Labelled'},
            {
              type: 'object',
              description: 'Picks a date.',
              properties: {
                component: {const: 'Picker'},
                value: {$ref: 'common_types.json#/$defs/DynamicString', default: 'x', minLength: 1},
                min: {
                  allOf: [
                    {$ref: 'common_types.json#/$defs/DynamicString'},
                    {if: {type: 'string'}, then: {format: 'date'}},
                  ],
                },
                style: {$ref: '#/$defs/Style'},
              },
              required: ['value', 'component'],
            },
          ],
        },
      },
      functions: {
        between: {
          type: 'object',
          description: 'Checks a range.',
          properties: {
            call: {const: 'between'},
            args: {
              type: 'object',
              properties: {
                value: {description: 'Any value.'},
                min: {type: 'number'},
                max: {type: 'number'},
              },
              required: ['value'],
              anyOf: [{required: ['min']}, {required: ['max']}],
            },
            returnType: {const: 'boolean'},
          },
        },
      },
      $defs: {
        Labelled: {properties: {label: {type: 'string'}}, required: ['label']},
        Style: {type: 'string', enum: ['plain', 'bold']},
      },
    });
    const schema = loaded.validationSchema;
    assertRefsLocalAndResolvable(schema);
    const defs = schema['$defs'] as Record<string, any>;
    const picker = (schema['components'] as Record<string, any>)['Picker'];

    // The description of the allOf branch describes the component; mixins add
    // their properties, not their descriptions.
    assert.strictEqual(picker.description, 'Picks a date.');
    assert.deepStrictEqual(picker.required, ['id', 'label', 'value', 'component']);
    assert.deepStrictEqual(Object.keys(picker.properties).sort(), [
      'accessibility',
      'checks',
      'component',
      'id',
      'label',
      'min',
      'style',
      'value',
    ]);
    assert.strictEqual(picker.unevaluatedProperties, false);
    // A reference to a common type keeps only its annotations.
    assert.deepStrictEqual(picker.properties.value, {
      $ref: '#/$defs/DynamicString',
      default: 'x',
      description: (V09_STANDARD_DEFS['DynamicString'] as Record<string, unknown>)['description'],
    });
    assert.deepStrictEqual(picker.properties.min.allOf[1], {
      if: {type: 'string'},
      then: {format: 'date'},
    });
    assert.strictEqual(picker.properties.min.allOf[0].$ref, '#/$defs/DynamicString');
    // A local definition the catalog authored is bundled as written.
    assert.deepStrictEqual(picker.properties.style, {$ref: '#/$defs/Style'});
    assert.deepStrictEqual(defs['Style'], {type: 'string', enum: ['plain', 'bold']});

    const between = (schema['functions'] as Record<string, any>)['between'];
    assert.strictEqual(between.description, 'Checks a range.');
    assert.deepStrictEqual(between.required, ['call', 'args']);
    assert.deepStrictEqual(between.properties.args.required, ['value']);
    assert.deepStrictEqual(between.properties.args.anyOf, [
      {required: ['min']},
      {required: ['max']},
    ]);
    assert.strictEqual(between.properties.args.unevaluatedProperties, false);
  });
});
