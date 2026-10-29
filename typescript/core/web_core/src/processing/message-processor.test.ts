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

import * as assert from 'node:assert';
import {describe, it, beforeEach} from 'node:test';
import {
  MessageProcessor,
  formatZodIssue,
  STRICT_VALIDATION,
  RpcErrorCode,
} from './message-processor.js';
import {Catalog, ComponentApi, createFunctionImplementation} from '../catalog/types.js';
import {CardApi, RowApi, TabsApi} from '../v0_9/basic_catalog/components/basic_components.js';
import {BasicCatalogThemeSchema} from '../universal/basic_catalog/theme.js';
import {BASIC_COMPONENTS} from '../catalogs/basic/v1/components/basic_components.js';
import {BASIC_FUNCTIONS} from '../catalogs/basic/v1/functions/basic_functions.js';
import {A2uiCatalogError, A2uiIntegrityError, A2uiValidationError} from '../errors.js';
import {DataContext} from '../resolution/data-context.js';
import {peekValue} from '../reactivity/signals.js';
import {z} from 'zod';

/**
 * Turns validation on while relaxing every topology rule, so a test exercises
 * only the check it is about.
 */
const THEME_ONLY_VALIDATION = {
  allowOrphanComponents: true,
  allowDanglingReferences: true,
  allowMissingRoot: true,
  allowUnknownElements: true,
};

/**
 * Asserts the constraints `specification/v1_0/json/catalog_definition.json`
 * places on an inline catalog. web_core has no JSON Schema validator
 * dependency, so the schema's rules are checked structurally.
 */
function assertConformsToV10CatalogDefinition(doc: Record<string, any>): void {
  const allowedKeys = [
    '$schema',
    '$id',
    'protocolVersion',
    '$defs',
    'title',
    'description',
    'catalogId',
    'metadata',
    'instructions',
    'components',
    'functions',
  ];
  for (const key of Object.keys(doc)) {
    assert.ok(allowedKeys.includes(key), `Unexpected top-level key '${key}'`);
  }
  assert.strictEqual(typeof doc.catalogId, 'string');
  if (doc.protocolVersion !== undefined) {
    assert.match(doc.protocolVersion, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$/);
  }
  assert.ok('anyComponent' in (doc.$defs ?? {}), 'Expected $defs.anyComponent');
  assert.ok('anyFunction' in (doc.$defs ?? {}), 'Expected $defs.anyFunction');
  assert.ok(!('Surface' in (doc.components ?? {})), "'Surface' is not a valid component name");
  const returnTypes = [
    'string',
    'number',
    'boolean',
    'array',
    'object',
    'validationResult',
    'any',
    'void',
  ];
  const functionKeys = [
    'type',
    'description',
    'properties',
    'required',
    'returnType',
    'allowedCallers',
    'requiresUserActivation',
  ];
  for (const [name, fn] of Object.entries<Record<string, any>>(doc.functions ?? {})) {
    for (const key of Object.keys(fn)) {
      assert.ok(functionKeys.includes(key), `Function '${name}' has unexpected key '${key}'`);
    }
    assert.strictEqual(fn.type, 'object');
    assert.ok(returnTypes.includes(fn.returnType), `Function '${name}' has no valid returnType`);
    assert.strictEqual(typeof fn.properties['@call'].const, 'string');
    for (const key of Object.keys(fn.properties)) {
      assert.ok(['@call', 'args'].includes(key), `Function '${name}' has property '${key}'`);
    }
    assert.ok(fn.required.includes('@call'));
  }
}

describe('MessageProcessor', () => {
  let processor: MessageProcessor<ComponentApi>;
  let testCatalog: Catalog<ComponentApi>;
  let actions: any[] = [];

  beforeEach(() => {
    actions = [];
    testCatalog = new Catalog('test-catalog', '0.9', []);
    processor = new MessageProcessor<ComponentApi>([testCatalog], async a => {
      actions.push(a);
    });
  });

  describe('getRendererCapabilities', () => {
    it('throws when no protocol versions are provided', () => {
      assert.throws(
        () => (processor as any).getRendererCapabilities(),
        /At least one protocol version must be provided/,
      );
      assert.throws(
        () => processor.getRendererCapabilities({} as any),
        /At least one protocol version must be provided/,
      );
    });

    it('supports custom componentEnvelopeRef for inline catalogs', () => {
      const strictComp: ComponentApi = {
        name: 'CustomButton',
        schema: z.object({label: z.string()}),
      };
      const proc = new MessageProcessor([new Catalog('cat-custom', '1.0', [strictComp])]);
      const caps = proc.getRendererCapabilities({
        versions: ['v0.9'],
        includeInlineCatalogs: true,
        componentEnvelopeRef: 'https://example.com/schema.json#/$defs/Base',
      });
      const inlineCat = (caps['v0.9'] as any).inlineCatalogs?.[0] as any;
      assert.strictEqual(
        inlineCat.components.CustomButton.allOf[0].$ref,
        'https://example.com/schema.json#/$defs/Base',
      );
    });

    it('keeps $ref on basic catalog child references despite per-usage descriptions', () => {
      const cat = new Catalog('cat-basic', '1.0', [CardApi, RowApi, TabsApi]);
      const proc = new MessageProcessor([cat]);

      const caps = proc.getRendererCapabilities({
        versions: ['v0.9'],
        includeInlineCatalogs: true,
      });
      const inlineCat = (caps['v0.9'] as any).inlineCatalogs?.[0] as any;
      const components = inlineCat?.components;
      assert.ok(components);

      const cardChild = components.Card.allOf[1].properties.child;
      assert.strictEqual(cardChild.$ref, '#/$defs/ComponentId');
      assert.strictEqual(cardChild.type, undefined);

      const rowChildren = components.Row.allOf[1].properties.children;
      assert.strictEqual(rowChildren.$ref, '#/$defs/ChildList');

      const tabItems = components.Tabs.allOf[1].properties.tabs.items;
      assert.strictEqual(tabItems.properties.child.$ref, '#/$defs/ComponentId');
    });

    it('sends each catalog toJson() document as a v1.0 inline catalog', () => {
      const cat = new Catalog('https://example.com/cat', '1.0', BASIC_COMPONENTS, BASIC_FUNCTIONS, {
        themeSchema: BasicCatalogThemeSchema,
      });
      const proc = new MessageProcessor([cat]);
      const caps = proc.getRendererCapabilities({versions: ['1.0'], includeInlineCatalogs: true});
      const inlineCat = (caps['1.0'] as any).inlineCatalogs?.[0] as Record<string, any>;

      assertConformsToV10CatalogDefinition(inlineCat);
      assert.deepStrictEqual(Object.keys(inlineCat.$defs).sort(), [
        'Weight',
        'anyComponent',
        'anyFunction',
      ]);
      assert.strictEqual(inlineCat.protocolVersion, '1.0');
      assert.strictEqual(inlineCat.theme, undefined);
      assert.strictEqual(
        inlineCat.components.Text.properties.text.$ref,
        'common_types.json#/$defs/DynamicString',
      );
      assert.deepStrictEqual(inlineCat, cat.toJson());
    });

    it('sends a loaded v1.0 catalog as the document it was loaded from', () => {
      const document = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        protocolVersion: '1.0',
        catalogId: 'https://example.com/loaded',
        components: {
          Label: {
            type: 'object',
            allOf: [
              {$ref: 'common_types.json#/$defs/Checkable'},
              {
                type: 'object',
                properties: {
                  component: {const: 'Label'},
                  text: {$ref: 'common_types.json#/$defs/DynamicString'},
                },
                required: ['component', 'text'],
              },
            ],
            unevaluatedProperties: false,
          },
        },
        $defs: {
          anyComponent: {
            oneOf: [{$ref: '#/components/Label'}],
            discriminator: {propertyName: 'component'},
          },
          anyFunction: {oneOf: [{$ref: '#/functions/noop'}]},
        },
        functions: {
          noop: {
            type: 'object',
            returnType: 'void',
            properties: {'@call': {const: 'noop'}, args: {type: 'object', properties: {}}},
            required: ['@call', 'args'],
          },
        },
      };
      const proc = new MessageProcessor([Catalog.fromJson(document) as Catalog<any>]);
      const caps = proc.getRendererCapabilities({versions: ['1.0'], includeInlineCatalogs: true});
      const inlineCat = (caps['1.0'] as any).inlineCatalogs?.[0];

      assert.deepStrictEqual(inlineCat, document);
      assertConformsToV10CatalogDefinition(inlineCat);
    });

    const unionsOnly = {
      anyComponent: {
        oneOf: [{$ref: '#/components/Label'}],
        discriminator: {propertyName: 'component'},
      },
      anyFunction: {not: {}},
    };
    const label = {
      type: 'object',
      properties: {component: {const: 'Label'}},
      required: ['component'],
    };

    function inlineV10Catalog(catalog: Catalog<any>): Record<string, any> {
      const proc = new MessageProcessor([catalog]);
      const caps = proc.getRendererCapabilities({versions: ['1.0'], includeInlineCatalogs: true});
      return (caps['1.0'] as any).inlineCatalogs[0];
    }

    it('gives a v1.0 inline catalog the catalogId and bare protocolVersion of a $id-only document', () => {
      const document = {
        $id: 'https://example.com/by-id.json',
        protocolVersion: '1.0',
        components: {Label: label},
        $defs: unionsOnly,
      };
      const inlineCat = inlineV10Catalog(Catalog.fromJson(document) as Catalog<any>);
      assert.strictEqual(inlineCat.catalogId, 'https://example.com/by-id.json');
      assert.strictEqual(inlineCat.protocolVersion, '1.0');
      assertConformsToV10CatalogDefinition(inlineCat);
    });

    it('gives a v1.0 inline catalog the catalogId a catalog was loaded with', () => {
      for (const document of [
        {catalogId: 'https://example.com/original', components: {Label: label}, $defs: unionsOnly},
        {components: {Label: label}, $defs: unionsOnly},
      ]) {
        const catalog = Catalog.fromJson(document, '1.0', 'https://example.com/override');
        const inlineCat = inlineV10Catalog(catalog as Catalog<any>);
        assert.strictEqual(inlineCat.catalogId, 'https://example.com/override');
        assert.strictEqual(inlineCat.protocolVersion, '1.0');
        assertConformsToV10CatalogDefinition(inlineCat);
      }
    });
  });

  describe('surface lifecycle events', () => {
    it('fires onSurfaceCreated and onSurfaceDeleted callbacks', () => {
      let createdId = '';
      let deletedId = '';

      processor.onSurfaceCreated(s => {
        createdId = s.id;
      });
      processor.onSurfaceDeleted(id => {
        deletedId = id;
      });

      processor.processMessages({
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      });
      assert.strictEqual(createdId, 's1');

      processor.processMessages({
        version: 'v0.9',
        deleteSurface: {surfaceId: 's1'},
      });
      assert.strictEqual(deletedId, 's1');
      assert.strictEqual(processor.getSurface('s1'), undefined);
    });
  });

  describe('processMessages operation handling', () => {
    it('exposes only version-compatible catalogs on the new surface', () => {
      const v09 = new Catalog<ComponentApi>('cat-0-9', '0.9', []);
      const alsoV09 = new Catalog<ComponentApi>('cat-0-9-b', '0.9', []);
      const v10 = new Catalog<ComponentApi>('cat-1-0', '1.0', []);
      const proc = new MessageProcessor<ComponentApi>([v09, alsoV09, v10]);

      proc.processMessages({
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'cat-0-9'},
      });

      const surface = proc.model.getSurface('s1')!;
      assert.strictEqual(surface.defaultCatalog, v09);
      assert.deepStrictEqual([...surface.availableCatalogs.keys()].sort(), [
        'cat-0-9',
        'cat-0-9-b',
      ]);
    });

    it('directly processes InternalOperation objects passed to processMessages', () => {
      processor.processMessages({
        type: 'createSurface',
        surfaceId: 's_direct',
        catalogId: 'test-catalog',
        dataModel: {foo: 'bar'},
      });

      assert.ok(processor.getSurface('s_direct'));
      assert.strictEqual(processor.getSurface('s_direct')?.dataModel.get('/foo'), 'bar');
    });
  });

  describe('formatZodIssue and error formatting', () => {
    it('formats unrecognized keys with exact property names', () => {
      const issue: any = {
        code: 'unrecognized_keys',
        keys: ['color', 'gap'],
        path: ['header'],
        message: 'Unrecognized key(s) in object: color, gap',
      };
      assert.strictEqual(
        formatZodIssue(issue),
        "header: Unrecognized key(s) in object: 'color', 'gap'",
      );
    });

    it('formats unrecognized keys at root level', () => {
      const issue: any = {
        code: 'unrecognized_keys',
        keys: ['color'],
        path: [],
        message: 'Expected undefined, received undefined',
      };
      assert.strictEqual(formatZodIssue(issue), "root: Unrecognized key(s) in object: 'color'");
    });

    it('formats invalid enum values', () => {
      const issue: any = {
        code: 'invalid_enum_value',
        options: ['primary', 'secondary'],
        received: 'invalid',
        path: ['variant'],
        message: 'Invalid enum value',
      };
      assert.strictEqual(
        formatZodIssue(issue),
        "variant: Invalid enum value. Expected primary | secondary, received 'invalid'",
      );
    });

    it('falls back to expected/received when message is corrupted with undefined', () => {
      const issue: any = {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['label'],
        message: 'Expected undefined, received undefined',
      };
      assert.strictEqual(formatZodIssue(issue), 'label: Expected string, received number');
    });

    it('surfaces unrecognized property validation error when processing component updates', () => {
      const strictButtonApi: ComponentApi = {
        name: 'MaterialButton',
        schema: z
          .object({
            label: z.string(),
          })
          .strict(),
      };
      const proc = new MessageProcessor([new Catalog('cat-m3', '0.9', [strictButtonApi])]);
      proc.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 's1', catalogId: 'cat-m3'},
        },
      ]);

      assert.throws(
        () => {
          proc.processMessages([
            {
              version: 'v0.9',
              updateComponents: {
                surfaceId: 's1',
                components: [
                  {
                    id: 'btn1',
                    component: 'MaterialButton',
                    label: 'Submit',
                    color: 'primary',
                  } as any,
                ],
              },
            },
          ]);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.strictEqual(
            err.message,
            "Validation failed for component 'MaterialButton' (btn1): root: Unrecognized key(s) in object: 'color'",
          );
          return true;
        },
      );
    });
  });

  describe('ValidationConfig', () => {
    it('validates surface theme against the basic catalog themeSchema', () => {
      const themedCatalog = new Catalog('themed-cat', '0.9', [], [], BasicCatalogThemeSchema);
      const proc = new MessageProcessor([themedCatalog], undefined, {
        validationConfig: THEME_ONLY_VALIDATION,
      });

      // Valid: 6-char hex, 3-char hex, 8-char hex (with alpha), named and functional colors.
      const validColors = {
        '6char': '#00BFFF',
        '3char': '#17e',
        '8char': '#00BFFF80',
        'named': 'red',
        'rgb': 'rgb(255, 0, 0)',
        'hsl': 'hsl(120, 100%, 50%)',
      };
      for (const [label, primaryColor] of Object.entries(validColors)) {
        proc.processMessages({
          version: 'v0.9',
          createSurface: {
            surfaceId: `valid-${label}`,
            catalogId: 'themed-cat',
            theme:
              label === '6char'
                ? {primaryColor, agentDisplayName: 'Test Agent', customExtra: 'passthrough'}
                : {primaryColor},
          },
        });
        const surface = proc.model.getSurface(`valid-${label}`);
        assert.ok(surface, `expected surface for ${label}`);
        assert.strictEqual(surface.theme?.primaryColor, primaryColor);
      }
      assert.strictEqual(
        proc.model.getSurface('valid-6char')?.theme?.agentDisplayName,
        'Test Agent',
      );

      // Invalid: malformed hex, non-colors, and CSS injection attempts.
      const invalidColors = [
        'url(https://attacker.example/beacon)',
        '#12',
        '#12345',
        '#1234567',
        '#gggggg',
        'not-a-color',
        'red; url(x)',
        123,
      ];
      for (const primaryColor of invalidColors) {
        const surfaceId = `invalid-${String(primaryColor)}`;
        assert.throws(
          () => {
            proc.processMessages({
              version: 'v0.9',
              createSurface: {surfaceId, catalogId: 'themed-cat', theme: {primaryColor}},
            });
          },
          (err: any) => {
            assert.ok(err instanceof A2uiValidationError);
            assert.ok(
              err.message.includes(`Validation failed for theme on surface '${surfaceId}'`),
            );
            return true;
          },
          `expected ${String(primaryColor)} to be rejected`,
        );
        assert.strictEqual(proc.model.getSurface(surfaceId), undefined);
      }
    });

    it('applies themeSchema transforms and defaults to the stored theme', () => {
      const transformSchema = z.object({
        primaryColor: z.string().transform(c => c.toUpperCase()),
        defaultedField: z.string().default('default-val'),
      });
      const proc = new MessageProcessor(
        [new Catalog('transform-cat', '0.9', [], [], transformSchema)],
        undefined,
        {
          validationConfig: THEME_ONLY_VALIDATION,
        },
      );

      proc.processMessages({
        version: 'v0.9',
        createSurface: {
          surfaceId: 'transform-surface',
          catalogId: 'transform-cat',
          theme: {primaryColor: '#abcdef'},
        },
      });

      const surface = proc.model.getSurface('transform-surface');
      assert.ok(surface);
      assert.strictEqual(surface.theme?.primaryColor, '#ABCDEF');
      assert.strictEqual((surface.theme as any)?.defaultedField, 'default-val');
    });

    describe('per call', () => {
      const catalog = new Catalog('cat', '1.0', BASIC_COMPONENTS);
      const create = {version: '1.0' as const, createSurface: {surfaceId: 's', catalogId: 'cat'}};
      const danglingChild = {
        version: '1.0' as const,
        updateComponents: {
          surfaceId: 's',
          components: [{id: 'root', component: 'Column', children: ['later']}],
        },
      };
      const unknownComponent = {
        version: '1.0' as const,
        updateComponents: {surfaceId: 's', components: [{id: 'root', component: 'Unknown'}]},
      };

      it("replaces the processor's own config for the call", () => {
        const proc = new MessageProcessor([catalog], undefined, {
          validationConfig: STRICT_VALIDATION,
        });
        proc.processMessages(create);
        assert.throws(() => proc.processMessages(danglingChild), A2uiValidationError);

        proc.processMessages(danglingChild, {
          validationConfig: {
            allowDanglingReferences: true,
            allowMissingRoot: true,
            allowOrphanComponents: true,
          },
        });

        assert.strictEqual(proc.model.getSurface('s')?.componentsModel.get('root')?.type, 'Column');
      });

      it('validates a processor that has no config of its own', () => {
        const proc = new MessageProcessor([catalog]);
        proc.processMessages(create);

        assert.throws(
          () => proc.processMessages(unknownComponent, {validationConfig: {}}),
          A2uiValidationError,
        );
        assert.strictEqual(proc.model.getSurface('s')?.componentsModel.size, 0);
      });

      it("restores the processor's own config after the call", () => {
        const proc = new MessageProcessor([catalog]);
        proc.processMessages(create);
        assert.throws(
          () => proc.processMessages(unknownComponent, {validationConfig: {}}),
          A2uiValidationError,
        );

        proc.processMessages(unknownComponent);

        assert.strictEqual(
          proc.model.getSurface('s')?.componentsModel.get('root')?.type,
          'Unknown',
        );
      });

      it('applies to each operation of an asynchronous call', async () => {
        const proc = new MessageProcessor([catalog]);
        proc.processMessages(create);

        await assert.rejects(
          proc.processMessagesAsync([unknownComponent], {validationConfig: {}}),
          A2uiValidationError,
        );
      });
    });
  });

  describe('catalogs', () => {
    it('returns the catalogs the processor was created with, in order', () => {
      const first = new Catalog('first', '1.0', []);
      const second = new Catalog('second', '1.0', []);
      const proc = new MessageProcessor([first, second]);

      assert.deepStrictEqual(proc.catalogs, [first, second]);
    });

    it('returns a copy', () => {
      const proc = new MessageProcessor([testCatalog]);

      proc.catalogs.push(new Catalog('other', '0.9', []));

      assert.deepStrictEqual(proc.catalogs, [testCatalog]);
    });
  });

  describe('Mixed Catalogs Support', () => {
    const basicCat: Catalog<ComponentApi> = new Catalog('cat-basic', '1.0', [
      {
        name: 'Box',
        schema: z.object({child: z.string().describe('ChildComponentId').optional()}),
      },
      {
        name: 'Text',
        schema: z.object({text: z.string()}),
      },
    ]);

    it('resolves callRendererFunction against a secondary catalog in availableCatalogs', async () => {
      const fnCatalog = new Catalog(
        'cat-fn',
        '1.0',
        [],
        [
          {
            name: 'computeGreeting',
            returnType: 'string',
            allowedCallers: 'rendererOrAgent',
            schema: z.object({user: z.string()}),
            execute: args => `Hi ${args.user}`,
          },
        ],
      );
      const processor = new MessageProcessor([basicCat, fnCatalog]);
      processor.processMessages({
        version: '1.0',
        createSurface: {surfaceId: 'surface-1', catalogId: 'cat-basic'},
      });

      const responses = await processor.processMessagesAsync({
        version: '1.0',
        callRendererFunction: {
          functionCallId: 'rpc-1',
          callFunction: {
            call: 'computeGreeting',
            catalogId: 'cat-fn',
            args: {user: 'Alice'},
          },
        },
      });

      assert.strictEqual(responses.length, 1);
      assert.strictEqual(responses[0].rendererFunctionResponse.value, 'Hi Alice');
    });
  });

  describe('MessageProcessor Full Pipeline & Validation Integration', () => {
    const basicCatalog = new Catalog('https://a2ui.org/catalog', '1.0', BASIC_COMPONENTS);

    it('leaves componentsModel untouched when updateComponents fails topology validation', () => {
      const proc = new MessageProcessor([basicCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      // 1. Initial valid surface
      proc.processMessages({
        version: '1.0',
        createSurface: {
          surfaceId: 's_atomic',
          catalogId: 'https://a2ui.org/catalog',
          components: [
            {id: 'root', component: 'Column', children: ['c1']},
            {id: 'c1', component: 'Text', text: 'Initial Child'},
          ],
        },
      });

      const surface = proc.getSurface('s_atomic')!;
      assert.strictEqual(surface.componentsModel.size, 2);

      // Track whether any update/create events are fired
      let eventFired = false;
      surface.componentsModel.onCreated.subscribe(() => {
        eventFired = true;
      });

      // 2. Send update that introduces an orphan component (failing topology validation)
      assert.throws(
        () =>
          proc.processMessages({
            version: '1.0',
            updateComponents: {
              surfaceId: 's_atomic',
              components: [
                {id: 'root', component: 'Column', children: ['c1']},
                {id: 'c1', component: 'Text', text: 'Updated Child'},
                {id: 'orphan_comp', component: 'Text', text: 'Unreachable'},
              ],
            },
          }),
        (err: any) => err instanceof A2uiIntegrityError && err.message.includes('not reachable'),
      );

      // 3. Verify that componentsModel was NOT mutated and no events fired
      assert.strictEqual(surface.componentsModel.size, 2);
      assert.strictEqual(surface.componentsModel.has('orphan_comp'), false);
      assert.strictEqual(
        surface.componentsModel.get('c1')?.properties.text,
        'Initial Child', // Not updated to 'Updated Child'
      );
      assert.strictEqual(eventFired, false);
    });

    it('leaves componentsModel untouched when updateComponents contains a valid component followed by an untyped new component', () => {
      const proc = new MessageProcessor([basicCatalog]);

      proc.processMessages({
        version: '1.0',
        createSurface: {
          surfaceId: 's_untyped',
          catalogId: 'https://a2ui.org/catalog',
          components: [{id: 'root', component: 'Text', text: 'Initial'}],
        },
      });

      const surface = proc.getSurface('s_untyped')!;

      // Batch contains valid update to 'root' followed by an invalid new component 'new_comp' without type
      assert.throws(
        () =>
          proc.processOperation({
            type: 'updateComponents',
            surfaceId: 's_untyped',
            components: [
              {id: 'root', component: 'Text', text: 'Updated Text'},
              {id: 'new_comp', text: 'Missing component field'},
            ],
          }),
        (err: any) =>
          err instanceof A2uiValidationError &&
          err.message.includes('Cannot create component new_comp without a type'),
      );

      // Verify that 'root' was NOT mutated
      assert.strictEqual(surface.componentsModel.get('root')?.properties.text, 'Initial');
      assert.strictEqual(surface.componentsModel.has('new_comp'), false);
    });
  });

  describe('MessageProcessor Bidirectional RPC & Asynchronous Pipeline', () => {
    const rpcApi = {
      name: 'echoFunction',
      returnType: 'string' as const,
      schema: z.object({text: z.string()}),
      allowedCallers: 'rendererOrAgent' as const,
    };
    const rpcImpl = createFunctionImplementation(rpcApi, (args: any) => `Echo: ${args.text}`);

    const secureApi = {
      name: 'secureAction',
      returnType: 'boolean' as const,
      schema: z.object({}),
      allowedCallers: 'rendererOrAgent' as const,
      requiresUserActivation: true,
    };
    const secureImpl = createFunctionImplementation(secureApi, () => true);

    const rpcCatalog = new Catalog('rpc-cat', '1.0', [], [rpcImpl, secureImpl]);

    it('processes callRendererFunction via processMessagesAsync and returns response', async () => {
      const proc = new MessageProcessor([rpcCatalog]);
      proc.processMessages({
        version: '1.0',
        createSurface: {surfaceId: 's1', catalogId: 'rpc-cat'},
      });

      const responses = await proc.processMessagesAsync({
        version: '1.0',
        callRendererFunction: {
          functionCallId: 'rpc-call-1',
          callFunction: {
            call: 'echoFunction',
            catalogId: 'rpc-cat',
            args: {text: 'World'},
          },
        },
      });

      assert.strictEqual(responses.length, 1);
      assert.strictEqual(responses[0].rendererFunctionResponse.functionCallId, 'rpc-call-1');
      assert.strictEqual(responses[0].rendererFunctionResponse.value, 'Echo: World');
      assert.strictEqual(responses[0].rendererFunctionResponse.error, undefined);
    });

    it('hands the RpcHandler a callRendererFunction message that names the function with @call', async () => {
      const proc = new MessageProcessor([rpcCatalog]);
      const received: any[] = [];
      const original = proc.rpc.handleCallRendererFunction.bind(proc.rpc);
      proc.rpc.handleCallRendererFunction = (msg, ...rest) => {
        received.push(msg);
        return original(msg, ...rest);
      };

      await proc.processMessagesAsync({
        version: '1.0',
        callRendererFunction: {
          functionCallId: 'rpc-call-at',
          callFunction: {'@call': 'echoFunction', catalogId: 'rpc-cat', args: {text: 'A'}},
        },
      });

      assert.strictEqual(received.length, 1);
      assert.deepStrictEqual(received[0].callRendererFunction.callFunction, {
        '@call': 'echoFunction',
        catalogId: 'rpc-cat',
        args: {text: 'A'},
      });
    });

    it('targets the specified surfaceId data model when surfaceId is provided, uses an isolated empty model when omitted, and returns INVALID_FUNCTION_CALL when surfaceId does not exist', async () => {
      const readModelApi = {
        name: 'readUserName',
        returnType: 'string' as const,
        schema: z.object({text: z.string().optional()}),
        allowedCallers: 'rendererOrAgent' as const,
      };
      const readModelImpl = createFunctionImplementation(
        readModelApi,
        (args: any, ctx: any) =>
          args?.text ?? ctx?.surface?.dataModel?.get('/user/name') ?? 'empty',
      );
      const cat = new Catalog('rpc-model-cat', '1.0', [], [readModelImpl]);
      const proc = new MessageProcessor([cat]);

      proc.processMessages([
        {
          version: '1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'rpc-model-cat',
            dataModel: {user: {name: 'Alice'}},
          },
        },
        {
          version: '1.0',
          createSurface: {
            surfaceId: 's2',
            catalogId: 'rpc-model-cat',
            dataModel: {user: {name: 'Bob'}},
          },
        },
      ]);

      // 1. With surfaceId: 's2' and @path arg -> resolves against s2's data model ('Bob')
      const resWithSurface = await proc.processMessagesAsync({
        version: '1.0',
        callRendererFunction: {
          surfaceId: 's2',
          functionCallId: 'rpc-surf-1',
          callFunction: {
            call: 'readUserName',
            catalogId: 'rpc-model-cat',
            args: {text: {'@path': '/user/name'}},
          },
        },
      });
      assert.strictEqual(resWithSurface.length, 1);
      assert.strictEqual(resWithSurface[0].rendererFunctionResponse.value, 'Bob');

      // 2. Without surfaceId and @path arg -> resolves against isolated empty root model ('empty')
      const resIsolated = await proc.processMessagesAsync({
        version: '1.0',
        callRendererFunction: {
          functionCallId: 'rpc-surf-2',
          callFunction: {
            call: 'readUserName',
            catalogId: 'rpc-model-cat',
            args: {text: {'@path': '/user/name'}},
          },
        },
      });
      assert.strictEqual(resIsolated.length, 1);
      assert.strictEqual(resIsolated[0].rendererFunctionResponse.value, 'empty');

      // 3. With non-existent surfaceId -> returns INVALID_FUNCTION_CALL
      const resMissing = await proc.processMessagesAsync({
        version: '1.0',
        callRendererFunction: {
          surfaceId: 'non_existent_surface',
          functionCallId: 'rpc-surf-3',
          callFunction: {
            call: 'readUserName',
            catalogId: 'rpc-model-cat',
            args: {},
          },
        },
      });
      assert.strictEqual(resMissing.length, 1);
      assert.strictEqual(
        resMissing[0].rendererFunctionResponse.error?.code,
        RpcErrorCode.INVALID_FUNCTION_CALL,
      );
      assert.match(
        resMissing[0].rendererFunctionResponse.error?.message ?? '',
        /Surface not found: non_existent_surface/,
      );

      // 4. With @call: '@index' in args -> returns EXECUTION_ERROR
      const resIndexErr = await proc.processMessagesAsync({
        version: '1.0',
        callRendererFunction: {
          functionCallId: 'rpc-surf-4',
          callFunction: {
            call: 'readUserName',
            catalogId: 'rpc-model-cat',
            args: {text: {'@call': '@index'}},
          },
        },
      });
      assert.strictEqual(resIndexErr.length, 1);
      assert.strictEqual(
        resIndexErr[0].rendererFunctionResponse.error?.code,
        RpcErrorCode.EXECUTION_ERROR,
      );

      // 5. Wire message missing callFunction.catalogId -> throws A2uiValidationError
      await assert.rejects(
        proc.processMessagesAsync({
          version: '1.0',
          callRendererFunction: {
            functionCallId: 'rpc-surf-5',
            callFunction: {
              call: 'readUserName',
              args: {},
            },
          },
        } as any),
        A2uiValidationError,
      );
    });

    it('enforces requiresUserActivation in processMessagesAsync via context options', async () => {
      const proc = new MessageProcessor([rpcCatalog]);
      proc.processMessages({
        version: '1.0',
        createSurface: {surfaceId: 's1', catalogId: 'rpc-cat'},
      });

      // Without user activation
      const unauthResponses = await proc.processMessagesAsync({
        version: '1.0',
        callRendererFunction: {
          functionCallId: 'rpc-call-2',
          callFunction: {
            call: 'secureAction',
            catalogId: 'rpc-cat',
            args: {},
          },
        },
      });

      assert.strictEqual(unauthResponses.length, 1);
      assert.strictEqual(
        unauthResponses[0].rendererFunctionResponse.error?.code,
        RpcErrorCode.INVALID_FUNCTION_CALL,
      );

      // With user activation
      const authResponses = await proc.processMessagesAsync(
        {
          version: '1.0',
          callRendererFunction: {
            functionCallId: 'rpc-call-3',
            callFunction: {
              call: 'secureAction',
              catalogId: 'rpc-cat',
              args: {},
            },
          },
        },
        {isUserActivated: true},
      );

      assert.strictEqual(authResponses.length, 1);
      assert.strictEqual(authResponses[0].rendererFunctionResponse.value, true);
    });

    it('initiates callAgentFunction and resolves via inbound agentFunctionResponse in processMessages', async () => {
      let emittedMessage: any;
      const proc = new MessageProcessor([rpcCatalog], undefined, {
        outboundListener: msg => {
          emittedMessage = msg;
        },
      });

      const callPromise = proc.callAgentFunction('s1', {
        call: 'fetchAgentData',
        catalogId: 'rpc-cat',
        args: {id: '42'},
      });

      assert.ok(emittedMessage);
      assert.strictEqual(emittedMessage.callAgentFunction.surfaceId, 's1');
      assert.strictEqual(emittedMessage.callAgentFunction.callFunction['@call'], 'fetchAgentData');
      assert.ok(!Object.hasOwn(emittedMessage.callAgentFunction.callFunction, 'call'));
      const callId = emittedMessage.callAgentFunction.functionCallId;

      // Inbound response processed through standard message processing pipeline
      proc.processMessages({
        version: '1.0',
        agentFunctionResponse: {
          functionCallId: callId,
          value: {data: 'Agent Result'},
        },
      });

      const result = await callPromise;
      assert.deepStrictEqual(result, {data: 'Agent Result'});
    });

    it('rejects pending callAgentFunction on processor disposal', async () => {
      const proc = new MessageProcessor([rpcCatalog], undefined, {
        outboundListener: () => {},
      });

      const callPromise = proc.callAgentFunction('s1', {
        call: 'fetchData',
      });

      proc.dispose();

      await assert.rejects(callPromise, (err: any) => {
        assert.strictEqual(err.code, RpcErrorCode.CANCELLED);
        return true;
      });
    });

    it('executes callRendererFunction in synchronous processMessages and emits to outboundListener', async () => {
      let emittedResponse: any;
      const proc = new MessageProcessor([rpcCatalog], undefined, {
        outboundListener: msg => {
          emittedResponse = msg;
        },
      });
      proc.processMessages({
        version: '1.0',
        createSurface: {surfaceId: 's1', catalogId: 'rpc-cat'},
      });

      // Fire-and-forget callRendererFunction in synchronous pipeline
      proc.processMessages({
        version: '1.0',
        callRendererFunction: {
          functionCallId: 'rpc-sync-1',
          callFunction: {
            call: 'echoFunction',
            catalogId: 'rpc-cat',
            args: {text: 'SyncTest'},
          },
        },
      });

      // Give the asynchronous promise chain a tick to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(emittedResponse);
      assert.strictEqual(emittedResponse.rendererFunctionResponse.functionCallId, 'rpc-sync-1');
      assert.strictEqual(emittedResponse.rendererFunctionResponse.value, 'Echo: SyncTest');
    });

    it('catches and logs unexpected promise rejections from callRendererFunction in processMessages', async () => {
      let loggedError = false;
      const originalConsoleError = console.error;
      console.error = () => {
        loggedError = true;
      };

      try {
        const proc = new MessageProcessor([rpcCatalog]);
        (proc as any).rpc.handleCallRendererFunction = async () => {
          throw new Error('RPC exploded');
        };

        proc.processMessages({
          version: '1.0',
          callRendererFunction: {
            functionCallId: 'rpc-sync-2',
            callFunction: {
              call: 'echoFunction',
              catalogId: 'rpc-cat',
              args: {},
            },
          },
        });

        await new Promise(resolve => setTimeout(resolve, 10));
        assert.strictEqual(loggedError, true);
      } finally {
        console.error = originalConsoleError;
      }
    });
  });

  describe('Backwards Compatibility Shims', () => {
    it('provides getClientCapabilities alias', () => {
      const cat = new Catalog('test-cat', '0.9', []);
      const proc = new MessageProcessor([cat]);
      const caps = proc.getClientCapabilities({versions: ['v0.9']});
      assert.deepStrictEqual(caps, proc.getRendererCapabilities({versions: ['v0.9']}));
      assert.deepStrictEqual((caps['v0.9'] as any).supportedCatalogIds, ['test-cat']);
    });

    it('defaults getClientCapabilities to v0.9 and accepts the legacy version option', () => {
      const cat = new Catalog('test-cat', '0.9', []);
      const proc = new MessageProcessor([cat]);
      const expected = proc.getRendererCapabilities({versions: ['v0.9']});
      assert.deepStrictEqual(proc.getClientCapabilities(), expected);
      assert.deepStrictEqual(proc.getClientCapabilities({}), expected);
      assert.deepStrictEqual(proc.getClientCapabilities({version: 'v0.9'}), expected);
      assert.deepStrictEqual(
        proc.getRendererCapabilities({version: 'v0.9'}),
        expected,
        'getRendererCapabilities also accepts the legacy version option',
      );
      assert.throws(
        () => proc.getRendererCapabilities({}),
        /At least one protocol version must be provided/,
      );
    });

    it('treats an unversioned v0.9 envelope as v0.9 when every catalog is pre-1.0', () => {
      const cat = new Catalog('test-cat', '0.9', []);
      const proc = new MessageProcessor([cat]);
      proc.processMessages([
        {createSurface: {surfaceId: 's1', catalogId: 'test-cat'}},
        {updateDataModel: {surfaceId: 's1', path: '/user/name', value: 'Alice'}},
      ] as any);
      assert.strictEqual(proc.getSurface('s1')?.dataModel.get('/user/name'), 'Alice');
      proc.processMessages({deleteSurface: {surfaceId: 's1'}} as any);
      assert.strictEqual(proc.getSurface('s1'), undefined);
    });

    it('unwraps messages wrapper in unversioned payload', () => {
      const cat = new Catalog('test-cat', '0.9', []);
      const proc = new MessageProcessor([cat]);
      proc.processMessages({
        messages: [{createSurface: {surfaceId: 's1', catalogId: 'test-cat'}}],
      } as any);
      assert.ok(proc.getSurface('s1'));
    });

    it('treats an unversioned envelope as v0.9.1 when registered catalog is 0.9.1', () => {
      const cat = new Catalog('test-cat', '0.9.1', []);
      const proc = new MessageProcessor([cat]);
      proc.processMessages({createSurface: {surfaceId: 's1', catalogId: 'test-cat'}} as any);
      assert.ok(proc.getSurface('s1'));
    });

    it('keeps rejecting unversioned envelopes with a v1.0 catalog or a validationConfig', () => {
      const unversioned = {createSurface: {surfaceId: 's1', catalogId: 'test-cat'}} as any;
      const withV10 = new MessageProcessor([
        new Catalog('test-cat', '0.9', []),
        new Catalog('v10-cat', '1.0', []),
      ]);
      assert.throws(() => withV10.processMessages(unversioned), /missing a valid 'version'/);

      const validating = new MessageProcessor([new Catalog('test-cat', '0.9', [])], undefined, {
        validationConfig: THEME_ONLY_VALIDATION,
      });
      assert.throws(() => validating.processMessages(unversioned), /missing a valid 'version'/);
    });

    it('leaves nested calls unchecked on a pre-1.0 surface without a validationConfig', () => {
      const textApi: ComponentApi = {name: 'Text', schema: z.object({text: z.any()})};
      const v09 = new Catalog<ComponentApi>('v09', '0.9', [textApi]);
      const lenient = new MessageProcessor([v09]);
      lenient.processMessages([
        {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: 'v09'}},
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Text', text: {call: 'nope', args: {}}}],
          },
        },
      ]);
      assert.ok(lenient.getSurface('s')?.componentsModel.get('root'));

      const strict = new MessageProcessor(
        [new Catalog<ComponentApi>('v09', '0.9', [textApi])],
        undefined,
        {
          validationConfig: {...THEME_ONLY_VALIDATION, allowUnknownElements: false},
        },
      );
      assert.throws(
        () =>
          strict.processMessages([
            {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: 'v09'}},
            {
              version: 'v0.9',
              updateComponents: {
                surfaceId: 's',
                components: [{id: 'root', component: 'Text', text: {call: 'nope', args: {}}}],
              },
            },
          ]),
        /Unrecognized function 'nope'/,
      );
    });

    it('provides getClientDataModel alias', () => {
      const cat = new Catalog('test-cat', '0.9', []);
      const proc = new MessageProcessor([cat]);
      proc.processMessages({
        version: 'v0.9',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'test-cat',
          sendDataModel: true,
        },
      });
      proc.processMessages({
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's1',
          path: '/user/name',
          value: 'Alice',
        },
      });
      const dataModel = proc.getClientDataModel('v0.9');
      assert.deepStrictEqual(dataModel, proc.getRendererDataModel('v0.9'));
      assert.deepStrictEqual((dataModel?.surfaces as any)?.s1, {user: {name: 'Alice'}});
    });

    it('provides resolvePath method on MessageProcessor', () => {
      const cat = new Catalog('test-cat', '0.9', []);
      const proc = new MessageProcessor([cat]);
      assert.strictEqual(proc.resolvePath('/absolute/path'), '/absolute/path');
      assert.strictEqual(proc.resolvePath('relative', '/base'), '/base/relative');
      assert.strictEqual(proc.resolvePath('relative', '/base/'), '/base/relative');
      assert.strictEqual(proc.resolvePath('standalone'), '/standalone');
    });

    it('rejects component with non-string or empty id', () => {
      const cat = new Catalog('test-cat', '0.9', []);
      const proc = new MessageProcessor([cat]);
      proc.processMessages({
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-cat'},
      });

      assert.throws(
        () => {
          proc.processMessages({
            version: 'v0.9',
            updateComponents: {
              surfaceId: 's1',
              components: [{id: 123 as any, component: 'Text'}],
            },
          });
        },
        (err: any) => {
          return err instanceof A2uiValidationError && err.message.includes("missing an 'id'");
        },
      );
    });
  });

  describe('surface and component metadata and default catalog resolution', () => {
    it('propagates surface metadata from createSurface op to surface.metadata', () => {
      const proc = new MessageProcessor<ComponentApi>([new Catalog('default', '1.0', [])]);

      proc.processMessages([
        {
          version: '1.0',
          createSurface: {
            surfaceId: 'meta_surface',
            metadata: {extensions: {vendor_app: {author: 'test_agent', priority: 'high'}}},
          },
        },
      ]);

      const surface = proc.getSurface('meta_surface');
      assert.ok(surface);
      assert.deepStrictEqual(surface.metadata, {
        extensions: {vendor_app: {author: 'test_agent', priority: 'high'}},
      });
    });

    it('extracts and propagates component metadata on component creation and update', () => {
      const proc = new MessageProcessor<ComponentApi>([new Catalog('default', '1.0', [])]);

      proc.processMessages([
        {
          version: '1.0',
          createSurface: {
            surfaceId: 'comp_meta_surface',
            catalogId: 'default',
          },
        },
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 'comp_meta_surface',
            components: [
              {
                id: 'btn1',
                component: 'Button',
                metadata: {
                  extensions: {vendor_app: {analyticsId: 'track_btn_1', role: 'primary'}},
                },
              },
            ],
          },
        },
      ]);

      const surface = proc.getSurface('comp_meta_surface');
      assert.ok(surface);
      const btn1 = surface.componentsModel.get('btn1');
      assert.ok(btn1);
      assert.deepStrictEqual(btn1.metadata, {
        extensions: {vendor_app: {analyticsId: 'track_btn_1', role: 'primary'}},
      });

      // Update component metadata
      proc.processMessages([
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 'comp_meta_surface',
            components: [
              {
                id: 'btn1',
                component: 'Button',
                metadata: {
                  extensions: {
                    vendor_app: {analyticsId: 'track_btn_1_updated', role: 'secondary'},
                  },
                },
              },
            ],
          },
        },
      ]);

      assert.deepStrictEqual(btn1.metadata, {
        extensions: {
          vendor_app: {analyticsId: 'track_btn_1_updated', role: 'secondary'},
        },
      });
    });
  });

  // The conformance suite (conformance/core/message_processor_v1_0.yaml) covers
  // catalog resolution through messages. These tests keep what it cannot
  // observe: which catalog object a component is bound to, behaviour that is
  // specific to web_core, and evaluation of a stored call.
  describe('v1.0 catalog resolution', () => {
    const textApi: ComponentApi = {
      name: 'Text',
      schema: z.object({text: z.any()}).strict(),
    };
    const upperFn = createFunctionImplementation(
      {
        name: 'upper',
        returnType: 'string' as const,
        schema: z.object({value: z.string()}).strict(),
      },
      args => args.value.toUpperCase(),
    );
    /** Rejects unknown functions while relaxing every topology rule. */
    const STRICT_FUNCTIONS_ONLY = {...THEME_ONLY_VALIDATION, allowUnknownElements: false};

    it('rebinds a v1.0 component to the surface default when an update names no catalogId', () => {
      const textInCustom = new Catalog<ComponentApi>('custom', '1.0', [textApi]);
      const base = new Catalog<ComponentApi>('base', '1.0', [textApi]);
      const proc = new MessageProcessor<ComponentApi>([base, textInCustom], undefined, {
        validationConfig: {...STRICT_VALIDATION, allowOrphanComponents: true},
      });
      proc.processMessages([
        {version: '1.0', createSurface: {surfaceId: 's', catalogId: 'base'}},
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Text', catalogId: 'custom', text: 'Hi'}],
          },
        },
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Text', text: 'Bye'}],
          },
        },
      ]);

      assert.strictEqual(proc.getSurface('s')?.componentsModel.get('root')?.catalog, base);
    });

    it('keeps the existing catalog on a same-type update below v1.0', () => {
      const v09Base = new Catalog<ComponentApi>('v09-base', '0.9', [textApi]);
      const v09Custom = new Catalog<ComponentApi>('v09-custom', '0.9', [textApi]);
      const proc = new MessageProcessor<ComponentApi>([v09Base, v09Custom]);
      proc.processMessages([
        {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: 'v09-base'}},
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Text', catalogId: 'v09-custom', text: 'Hi'}],
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Text', text: 'Bye'}],
          },
        },
      ]);

      const root = proc.getSurface('s')?.componentsModel.get('root');
      assert.strictEqual(root?.catalog, v09Custom);
      assert.deepStrictEqual(root?.properties, {text: 'Bye'});
    });

    it('still falls back to a registered catalog for version-less and v0.8 surfaces', () => {
      const v08 = new Catalog<ComponentApi>('v08-cat', '0.8', []);
      const proc = new MessageProcessor<ComponentApi>([v08]);
      proc.processMessages({type: 'createSurface', surfaceId: 'unversioned'});
      proc.processMessages({version: 'v0.8', beginRendering: {surfaceId: 'v08', root: 'root'}});

      for (const surfaceId of ['unversioned', 'v08']) {
        assert.strictEqual(proc.getSurface(surfaceId)?.defaultCatalog, v08, surfaceId);
      }
    });

    it('evaluates @index on a surface without a default catalog', () => {
      const base = new Catalog<ComponentApi>('base', '1.0', [textApi]);
      const proc = new MessageProcessor<ComponentApi>([base]);
      proc.processMessages([
        {version: '1.0', createSurface: {surfaceId: 's'}},
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 's',
            components: [
              {
                id: 'root',
                component: 'Text',
                catalogId: 'base',
                text: {'@call': '@index', args: {offset: 1}},
              },
            ],
          },
        },
      ]);

      const surface = proc.getSurface('s')!;
      const errors: unknown[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      const text = surface.componentsModel.get('root')?.properties['text'];
      const context = new DataContext(surface, '/items/2');
      assert.strictEqual(context.resolveDynamicValue(text), 3);
      assert.strictEqual(peekValue(context.resolveSignal<number>(text)), 3);
      assert.deepStrictEqual(errors, []);
    });

    it('tolerates an unknown function in the surface default without a validationConfig', () => {
      const base = new Catalog<ComponentApi>('base', '1.0', [textApi]);
      const proc = new MessageProcessor<ComponentApi>([base]);
      proc.processMessages([
        {version: '1.0', createSurface: {surfaceId: 's', catalogId: 'base'}},
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Text', text: {'@call': 'anything', args: {}}}],
          },
        },
      ]);

      assert.ok(proc.getSurface('s')?.componentsModel.get('root'));
    });

    /** Processes a v1.0 surface on `base` whose root Text has the given `text`. */
    function processV10Text(proc: MessageProcessor<ComponentApi>, text: unknown): void {
      proc.processMessages([
        {version: '1.0', createSurface: {surfaceId: 's', catalogId: 'base'}},
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Text', text}],
          },
        },
      ]);
    }

    it('rejects a catalogId on an @index call even without a validationConfig', () => {
      const base = new Catalog<ComponentApi>('base', '1.0', [textApi]);
      const proc = new MessageProcessor<ComponentApi>([base]);

      assert.throws(
        () => processV10Text(proc, {'@call': '@index', catalogId: 'base'}),
        (err: unknown) =>
          err instanceof A2uiValidationError &&
          /System function '@index' belongs to no catalog and must not name a catalogId/.test(
            err.message,
          ),
      );
      assert.strictEqual(proc.getSurface('s')?.componentsModel.get('root'), undefined);
    });

    it('treats an empty catalogId on a call as a catalog name, not the surface default', () => {
      const base = new Catalog<ComponentApi>('base', '1.0', [textApi], [upperFn]);
      const proc = new MessageProcessor<ComponentApi>([base]);

      assert.throws(
        () => processV10Text(proc, {'@call': 'upper', catalogId: '', args: {value: 'x'}}),
        (err: unknown) => err instanceof A2uiCatalogError && err.message === 'Catalog not found: ',
      );
    });

    it('treats an empty catalogId on a v1.0 component as a catalog name', () => {
      const base = new Catalog<ComponentApi>('base', '1.0', [textApi]);
      const proc = new MessageProcessor<ComponentApi>([base]);

      assert.throws(
        () =>
          proc.processMessages([
            {version: '1.0', createSurface: {surfaceId: 's', catalogId: 'base'}},
            {
              version: '1.0',
              updateComponents: {
                surfaceId: 's',
                components: [{id: 'root', component: 'Text', catalogId: '', text: 'x'}],
              },
            },
          ]),
        (err: unknown) => err instanceof A2uiCatalogError && err.message === 'Catalog not found: ',
      );
    });

    it('validates calls inside nested objects with keys named id or component', () => {
      const base = new Catalog<ComponentApi>('base', '1.0', [textApi], [upperFn]);
      for (const key of ['id', 'component']) {
        const proc = new MessageProcessor<ComponentApi>([base], undefined, {
          validationConfig: STRICT_FUNCTIONS_ONLY,
        });
        assert.throws(
          () => processV10Text(proc, {[key]: {'@call': 'nope', args: {}}}),
          /Unrecognized function 'nope'/,
          key,
        );
      }
    });

    it('validates a v0.9 call naming another catalogId against the surface catalog', () => {
      const v09Base = new Catalog<ComponentApi>('v09-base', '0.9', [textApi], [upperFn]);
      const v09Other = new Catalog<ComponentApi>('v09-other', '0.9', [textApi], [upperFn]);
      const proc = new MessageProcessor<ComponentApi>([v09Base, v09Other], undefined, {
        validationConfig: STRICT_FUNCTIONS_ONLY,
      });

      assert.throws(
        () =>
          proc.processMessages([
            {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: 'v09-base'}},
            {
              version: 'v0.9',
              updateComponents: {
                surfaceId: 's',
                components: [
                  {
                    id: 'root',
                    component: 'Text',
                    text: {call: 'nope', catalogId: 'v09-other', args: {}},
                  },
                ],
              },
            },
          ]),
        /Unrecognized function 'nope'/,
      );
    });

    describe('nested calls in a component naming a catalog other than the surface default', () => {
      const lowerFn = createFunctionImplementation(
        {
          name: 'lower',
          returnType: 'string' as const,
          schema: z.object({value: z.string()}).strict(),
        },
        args => args.value.toLowerCase(),
      );

      /** Processes a v1.0 surface on `base` whose root component is `root`. */
      function processRoot(
        proc: MessageProcessor<ComponentApi>,
        root: Record<string, unknown>,
      ): void {
        proc.processMessages([
          {version: '1.0', createSurface: {surfaceId: 's', catalogId: 'base'}},
          {version: '1.0', updateComponents: {surfaceId: 's', components: [root]}},
        ]);
      }

      function newProcessor(): MessageProcessor<ComponentApi> {
        const base = new Catalog<ComponentApi>('base', '1.0', [textApi], [upperFn]);
        const custom = new Catalog<ComponentApi>('custom', '1.0', [textApi], [lowerFn]);
        return new MessageProcessor<ComponentApi>([base, custom], undefined, {
          validationConfig: STRICT_FUNCTIONS_ONLY,
        });
      }

      it('accepts a catalogless call to a function only in the surface default', () => {
        const proc = newProcessor();
        processRoot(proc, {
          id: 'root',
          component: 'Text',
          catalogId: 'custom',
          text: {'@call': 'upper', args: {value: 'x'}},
        });
        assert.ok(proc.getSurface('s')?.componentsModel.get('root'));
      });

      it('rejects an unknown catalogless call in a component naming the surface default', () => {
        // A component naming the surface default is in the catalog its
        // catalogless calls run in, so component validation checks them.
        assert.throws(
          () =>
            processRoot(newProcessor(), {
              id: 'root',
              component: 'Text',
              catalogId: 'base',
              text: {'@call': 'noSuchFn'},
            }),
          (err: unknown) =>
            err instanceof A2uiValidationError &&
            (err.message.match(/Unrecognized function 'noSuchFn'/g) ?? []).length === 1,
        );
      });

      it('checks a catalogless call in a component naming the surface default once', () => {
        let checks = 0;
        const countedFn = createFunctionImplementation(
          {
            name: 'counted',
            returnType: 'string' as const,
            schema: z
              .object({
                value: z.string().refine(() => {
                  checks++;
                  return true;
                }),
              })
              .strict(),
          },
          args => args.value,
        );
        const base = new Catalog<ComponentApi>('base', '1.0', [textApi], [countedFn]);
        const custom = new Catalog<ComponentApi>('custom', '1.0', [textApi], [lowerFn]);
        const proc = new MessageProcessor<ComponentApi>([base, custom], undefined, {
          validationConfig: STRICT_FUNCTIONS_ONLY,
        });
        processRoot(proc, {
          id: 'root',
          component: 'Text',
          catalogId: 'base',
          text: {'@call': 'counted', args: {value: 'x'}},
        });
        assert.ok(proc.getSurface('s')?.componentsModel.get('root'));
        assert.strictEqual(checks, 1);
      });

      it('checks a catalogless call against the surface default', () => {
        assert.throws(
          () =>
            processRoot(newProcessor(), {
              id: 'root',
              component: 'Text',
              catalogId: 'custom',
              text: {'@call': 'upper', args: {value: 3}},
            }),
          /Validation failed for function 'upper'/,
        );
        assert.throws(
          () =>
            processRoot(newProcessor(), {
              id: 'root',
              component: 'Text',
              catalogId: 'custom',
              text: {'@call': 'lower', args: {value: 'x'}},
            }),
          /Unrecognized function 'lower'/,
        );
      });

      it("checks a call naming the component's catalog against that catalog", () => {
        const proc = newProcessor();
        processRoot(proc, {
          id: 'root',
          component: 'Text',
          catalogId: 'custom',
          text: {'@call': 'lower', catalogId: 'custom', args: {value: 'X'}},
        });
        assert.ok(proc.getSurface('s')?.componentsModel.get('root'));

        assert.throws(
          () =>
            processRoot(newProcessor(), {
              id: 'root',
              component: 'Text',
              catalogId: 'custom',
              text: {'@call': 'lower', catalogId: 'custom', args: {value: 3}},
            }),
          /Validation failed for function 'lower'/,
        );
        assert.throws(
          () =>
            processRoot(newProcessor(), {
              id: 'root',
              component: 'Text',
              catalogId: 'custom',
              text: {'@call': 'upper', catalogId: 'custom', args: {value: 'x'}},
            }),
          /Unrecognized function 'upper'/,
        );
      });

      it('checks the calls of a component type its catalog does not define', () => {
        const newProc = () => {
          const base = new Catalog<ComponentApi>('base', '1.0', [textApi], [upperFn]);
          const custom = new Catalog<ComponentApi>('custom', '1.0', [], [lowerFn]);
          return new MessageProcessor<ComponentApi>([base, custom], undefined, {
            validationConfig: {...THEME_ONLY_VALIDATION, allowUnknownElements: true},
          });
        };
        const widget = (catalogId: string, text: unknown) => ({
          id: 'root',
          component: 'Widget',
          catalogId,
          text,
        });
        // Component validation can't check the properties of an unknown type,
        // but it still checks the calls in them.
        assert.throws(
          () =>
            processRoot(
              newProc(),
              widget('custom', {'@call': 'lower', catalogId: 'custom', args: {value: 3}}),
            ),
          /Validation failed for function 'lower'/,
        );
        assert.throws(
          () => processRoot(newProc(), widget('base', {'@call': 'upper', args: {value: 3}})),
          /Validation failed for function 'upper'/,
        );
        // Reserved system functions too.
        assert.throws(
          () => processRoot(newProc(), widget('base', {'@call': '@index', catalogId: 'base'})),
          /System function '@index' belongs to no catalog and must not name a catalogId/,
        );
        assert.throws(
          () => processRoot(newProc(), widget('base', {'@call': '@index', args: {offset: 'one'}})),
          /Validation failed for function '@index'/,
        );
        processRoot(newProc(), widget('base', {'@call': '@index', args: {offset: 1}}));
      });

      it('rejects a non-string catalogId on a call', () => {
        const base = new Catalog<ComponentApi>('base', '1.0', [textApi], [upperFn]);
        for (const component of ['Text', 'Widget']) {
          const proc = new MessageProcessor<ComponentApi>([base]);
          assert.throws(
            () =>
              processRoot(proc, {
                id: 'root',
                component,
                text: {'@call': 'upper', catalogId: 7, args: {value: 'x'}},
              }),
            (err: unknown) =>
              err instanceof A2uiValidationError &&
              err.message === "Function call 'upper' has a non-string 'catalogId'.",
            component,
          );
        }
      });

      it('rejects a call with an empty name', () => {
        const base = new Catalog<ComponentApi>('base', '1.0', [textApi], [upperFn]);
        // `Widget` is unknown to the catalog; its call is checked all the same.
        for (const component of ['Text', 'Widget']) {
          const proc = new MessageProcessor<ComponentApi>([base]);
          assert.throws(
            () => processRoot(proc, {id: 'root', component, text: {'@call': ''}}),
            (err: unknown) =>
              err instanceof A2uiValidationError &&
              /Function name '' must be a valid UAX #31 identifier/.test(err.message),
            component,
          );
        }
      });

      it('accepts a closed component schema in a named catalog', () => {
        const tagApi = {name: 'Tag', schema: z.object({label: z.string()}).strict()};
        const closed = new Catalog<ComponentApi>('closed', '1.0', [tagApi]);
        const proc = new MessageProcessor<ComponentApi>([closed], undefined, {
          validationConfig: STRICT_VALIDATION,
        });
        proc.processMessages([
          {version: '1.0', createSurface: {surfaceId: 's'}},
          {
            version: '1.0',
            updateComponents: {
              surfaceId: 's',
              components: [
                {id: 'root', component: 'Tag', catalogId: 'closed', label: 'Hello'} as any,
              ],
            },
          },
        ]);
        assert.strictEqual(proc.model.getSurface('s')?.componentsModel.get('root')?.type, 'Tag');
      });

      it('rejects a non-string catalogId on a component', () => {
        const base = new Catalog<ComponentApi>('base', '1.0', [textApi], [upperFn]);
        for (const catalogId of [7, null, {}]) {
          const proc = new MessageProcessor<ComponentApi>([base]);
          assert.throws(
            () => processRoot(proc, {id: 'root', component: 'Text', catalogId, text: 'x'}),
            A2uiValidationError,
            String(catalogId),
          );
        }
      });

      it('reports a bad argument name in a call to another catalog once', () => {
        const proc = newProcessor();
        assert.throws(
          () =>
            processRoot(proc, {
              id: 'root',
              component: 'Text',
              text: {'@call': 'lower', catalogId: 'custom', args: {'1bad': 'v'}},
            }),
          (err: unknown) =>
            err instanceof A2uiValidationError &&
            err.message.split("Function argument '1bad'").length === 2,
        );
      });
    });

    it('reports component and function catalog faults with the same messages', () => {
      const base = new Catalog<ComponentApi>('base', '1.0', [textApi], [upperFn]);
      const v09 = new Catalog<ComponentApi>('v09', '0.9', [textApi], [upperFn]);
      const cases: Array<[Record<string, unknown>, string]> = [
        [
          {id: 'root', component: 'Text', catalogId: 'missing', text: 'x'},
          'Catalog not found: missing',
        ],
        [
          {
            id: 'root',
            component: 'Text',
            catalogId: 'base',
            text: {'@call': 'upper', catalogId: 'missing'},
          },
          'Catalog not found: missing',
        ],
        [
          {id: 'root', component: 'Text', catalogId: 'v09', text: 'x'},
          "Component 'root' names catalog 'v09', whose specification version (0.9) does not match surface 's' version (1.0).",
        ],
        [
          {
            id: 'root',
            component: 'Text',
            catalogId: 'base',
            text: {'@call': 'upper', catalogId: 'v09'},
          },
          "Function call 'upper' names catalog 'v09', whose specification version (0.9) does not match surface 's' version (1.0).",
        ],
        [
          {id: 'root', component: 'Text', text: 'x'},
          "Component 'root' names no catalogId and surface 's' has no default catalogId.",
        ],
        [
          {id: 'root', component: 'Text', catalogId: 'base', text: {'@call': 'upper'}},
          "Function call 'upper' names no catalogId and surface 's' has no default catalogId.",
        ],
      ];
      for (const [component, message] of cases) {
        const proc = new MessageProcessor<ComponentApi>([base, v09]);
        assert.throws(
          () =>
            proc.processMessages([
              {version: '1.0', createSurface: {surfaceId: 's'}},
              {version: '1.0', updateComponents: {surfaceId: 's', components: [component]}},
            ]),
          (err: unknown) => err instanceof A2uiCatalogError && err.message === message,
          message,
        );
      }
    });
  });
});
