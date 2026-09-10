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
import {MessageProcessor, formatZodIssue} from './message-processor.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {CardApi, RowApi, TabsApi} from '../basic_catalog/components/basic_components.js';
import {ButtonApi} from '../basic_catalog/index.js';
import {A2uiStateError, A2uiValidationError} from '../errors.js';
import {z} from 'zod';

describe('MessageProcessor', () => {
  let processor: MessageProcessor<ComponentApi>;
  let testCatalog: Catalog<ComponentApi>;
  let actions: any[] = [];

  beforeEach(() => {
    actions = [];
    testCatalog = new Catalog('test-catalog', []);
    processor = new MessageProcessor<ComponentApi>([testCatalog], async a => {
      actions.push(a);
    });
  });

  describe('getClientCapabilities', () => {
    it('generates basic client capabilities with supportedCatalogIds', () => {
      const caps = processor.getClientCapabilities();
      assert.strictEqual(caps['v0.9']?.inlineCatalogs, undefined);
      assert.deepStrictEqual(caps, {
        'v0.9': {
          supportedCatalogIds: ['test-catalog'],
        },
      });
    });

    it('generates inline catalogs when requested', () => {
      const buttonApi: ComponentApi = {
        name: 'Button',
        schema: z.object({
          label: z.string().describe('The button label'),
        }),
      };
      const cat = new Catalog('cat-1', [buttonApi]);
      const proc = new MessageProcessor([cat]);

      const caps = proc.getClientCapabilities({includeInlineCatalogs: true});
      const inlineCat = caps['v0.9']?.inlineCatalogs?.[0];
      assert.strictEqual(inlineCat?.catalogId, 'cat-1');

      const buttonSchema = inlineCat?.components?.Button;
      assert.ok(buttonSchema);
      assert.ok(buttonSchema.allOf);
      assert.strictEqual(buttonSchema.allOf[0].$ref, 'common_types.json#/$defs/ComponentCommon');
      assert.strictEqual(buttonSchema.allOf[1].properties.component.const, 'Button');
      assert.strictEqual(buttonSchema.allOf[1].properties.label.description, 'The button label');
      assert.deepStrictEqual(buttonSchema.allOf[1].required, ['component', 'label']);
    });

    it('keeps $ref on basic catalog child references despite per-usage descriptions', () => {
      const cat = new Catalog('cat-basic', [CardApi, RowApi, TabsApi]);
      const proc = new MessageProcessor([cat]);

      const caps = proc.getClientCapabilities({includeInlineCatalogs: true});
      const components = caps['v0.9']?.inlineCatalogs?.[0]?.components;
      assert.ok(components);

      const cardChild = components.Card.allOf[1].properties.child;
      assert.strictEqual(cardChild.$ref, 'common_types.json#/$defs/ComponentId');
      assert.strictEqual(cardChild.type, undefined);

      const rowChildren = components.Row.allOf[1].properties.children;
      assert.strictEqual(rowChildren.$ref, 'common_types.json#/$defs/ChildList');

      const tabChild = components.Tabs.allOf[1].properties.tabs.items.properties.child;
      assert.strictEqual(tabChild.$ref, 'common_types.json#/$defs/ComponentId');
    });

    it('transforms REF: descriptions into valid $ref nodes', () => {
      const customApi: ComponentApi = {
        name: 'Custom',
        schema: z.object({
          title: z.string().describe('REF:common_types.json#/$defs/DynamicString|The title'),
        }),
      };
      const cat = new Catalog('cat-ref', [customApi]);
      const proc = new MessageProcessor([cat]);

      const caps = proc.getClientCapabilities({includeInlineCatalogs: true});
      const titleSchema =
        caps['v0.9']?.inlineCatalogs?.[0].components?.Custom.allOf[1].properties.title;
      assert.ok(titleSchema);
      assert.strictEqual(titleSchema.$ref, 'common_types.json#/$defs/DynamicString');
      assert.strictEqual(titleSchema.description, 'The title');
      // Ensure Zod's 'type: string' was removed
      assert.strictEqual(titleSchema.type, undefined);
    });

    it('generates inline catalogs with functions and theme schema', () => {
      const buttonApi: ComponentApi = {
        name: 'Button',
        schema: z.object({
          label: z.string(),
        }),
      };
      const addFn = {
        name: 'add',
        returnType: 'number' as const,
        schema: z.object({
          a: z.number().describe('First number'),
          b: z.number().describe('Second number'),
        }),
        execute: (args: any) => args.a + args.b,
      };

      const themeSchema = z.object({
        primaryColor: z.string().describe('REF:common_types.json#/$defs/Color|The main color'),
      });

      const cat = new Catalog('cat-full', [buttonApi], [addFn], themeSchema);
      const proc = new MessageProcessor([cat]);

      const caps = proc.getClientCapabilities({includeInlineCatalogs: true});
      const inlineCat = caps['v0.9']?.inlineCatalogs?.[0];
      assert.strictEqual(inlineCat?.catalogId, 'cat-full');
      // Verify Functions
      assert.ok(inlineCat.functions);
      assert.strictEqual(inlineCat.functions.length, 1);

      const fn = inlineCat.functions[0];
      assert.strictEqual(fn.name, 'add');
      assert.strictEqual(fn.returnType, 'number');
      assert.strictEqual(fn.parameters.properties.a.description, 'First number');
      // Verify Theme
      assert.ok(inlineCat.theme);
      assert.ok(inlineCat.theme.primaryColor);
      assert.strictEqual(inlineCat.theme.primaryColor.$ref, 'common_types.json#/$defs/Color');
      assert.strictEqual(inlineCat.theme.primaryColor.description, 'The main color');
    });

    it('omits functions and theme when catalog has none', () => {
      const compApi: ComponentApi = {name: 'EmptyComp', schema: z.object({})};
      const cat = new Catalog('cat-empty', [compApi]);
      const proc = new MessageProcessor([cat]);
      const caps = proc.getClientCapabilities({includeInlineCatalogs: true});
      const inlineCat = caps['v0.9']?.inlineCatalogs?.[0];
      assert.strictEqual(inlineCat?.catalogId, 'cat-empty');
      assert.strictEqual(inlineCat.functions, undefined);
      assert.strictEqual(inlineCat.theme, undefined);
    });

    it('processes REF: tags deeply nested in schema arrays and objects', () => {
      const deepApi: ComponentApi = {
        name: 'DeepComp',
        schema: z.object({
          items: z.array(
            z.object({
              action: z
                .string()
                .describe('REF:common_types.json#/$defs/Action|The action to perform'),
            }),
          ),
        }),
      };
      const cat = new Catalog('cat-deep', [deepApi]);
      const proc = new MessageProcessor([cat]);
      const caps = proc.getClientCapabilities({includeInlineCatalogs: true});

      const properties = caps['v0.9']?.inlineCatalogs?.[0].components?.DeepComp.allOf[1].properties;
      assert.ok(properties);

      const actionSchema = properties.items.items.properties.action;
      assert.strictEqual(actionSchema.$ref, 'common_types.json#/$defs/Action');
      assert.strictEqual(actionSchema.description, 'The action to perform');
      assert.strictEqual(actionSchema.type, undefined);
    });

    it('handles REF: tags without pipes or with multiple pipes', () => {
      const edgeApi: ComponentApi = {
        name: 'EdgeComp',
        schema: z.object({
          noPipe: z.string().describe('REF:common_types.json#/$defs/NoPipe'),
          multiPipe: z.string().describe('REF:common_types.json#/$defs/MultiPipe|First|Second'),
        }),
      };
      const cat = new Catalog('cat-edge', [edgeApi]);
      const proc = new MessageProcessor([cat]);
      const caps = proc.getClientCapabilities({includeInlineCatalogs: true});

      const properties = caps['v0.9']?.inlineCatalogs?.[0].components?.EdgeComp.allOf[1].properties;
      assert.ok(properties);

      assert.strictEqual(properties.noPipe.$ref, 'common_types.json#/$defs/NoPipe');
      assert.strictEqual(properties.noPipe.description, undefined);
      assert.strictEqual(properties.multiPipe.$ref, 'common_types.json#/$defs/MultiPipe');
      assert.strictEqual(properties.multiPipe.description, 'First');
    });

    it('handles multiple catalogs correctly', () => {
      const compApi: ComponentApi = {name: 'C1', schema: z.object({})};
      const cat1 = new Catalog('cat-1', [compApi]);

      const addFn = {
        name: 'add',
        returnType: 'number' as const,
        schema: z.object({}),
        execute: () => 0,
      };
      const themeSchema = z.object({color: z.string()});
      const cat2 = new Catalog('cat-2', [], [addFn], themeSchema);

      const proc = new MessageProcessor([cat1, cat2]);
      const caps = proc.getClientCapabilities({includeInlineCatalogs: true});
      assert.strictEqual(caps['v0.9']?.inlineCatalogs?.length, 2);

      const inlineCat1 = caps['v0.9']?.inlineCatalogs?.[0];
      assert.strictEqual(inlineCat1?.catalogId, 'cat-1');
      assert.strictEqual(inlineCat1?.functions, undefined);
      assert.strictEqual(inlineCat1?.theme, undefined);

      const inlineCat2 = caps['v0.9']?.inlineCatalogs?.[1];
      assert.strictEqual(inlineCat2.catalogId, 'cat-2');
      assert.strictEqual(inlineCat2.functions!.length, 1);
      assert.ok(inlineCat2.theme);
    });
  });

  it('creates surface', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'test-catalog',
          theme: {},
        },
      },
    ]);
    const surface = processor.model.getSurface('s1');
    assert.ok(surface);
    assert.strictEqual(surface.id, 's1');
    assert.strictEqual(surface.sendDataModel, false);
  });

  it('creates surface with sendDataModel enabled', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'test-catalog',
          sendDataModel: true,
        },
      },
    ]);
    const surface = processor.model.getSurface('s1');
    assert.strictEqual(surface?.sendDataModel, true);
  });

  it('getClientDataModel filters surfaces correctly', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'test-catalog',
          sendDataModel: true,
        },
      },
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's2',
          catalogId: 'test-catalog',
          sendDataModel: false,
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {surfaceId: 's1', value: {user: 'Alice'}},
      },
      {
        version: 'v0.9',
        updateDataModel: {surfaceId: 's2', value: {secret: 'Bob'}},
      },
    ]);

    const dataModel = processor.getClientDataModel();
    assert.ok(dataModel);
    assert.strictEqual(dataModel.version, 'v0.9');
    assert.deepStrictEqual(dataModel.surfaces, {
      s1: {user: 'Alice'},
    });
    assert.strictEqual((dataModel.surfaces as any).s2, undefined);
  });

  it('getClientDataModel returns undefined if no surfaces have sendDataModel enabled', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);
    assert.strictEqual(processor.getClientDataModel(), undefined);
  });

  it('uses configured processor version for getClientCapabilities and getClientDataModel', () => {
    const v091Proc = new MessageProcessor([testCatalog], undefined, {version: 'v0.9.1'});
    assert.strictEqual(v091Proc.version, 'v0.9.1');

    const caps = v091Proc.getClientCapabilities();
    assert.ok(caps['v0.9.1']);
    assert.strictEqual(caps['v0.9'], undefined);

    v091Proc.processMessages([
      {
        version: 'v0.9.1',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog', sendDataModel: true},
      },
    ]);
    const dataModel = v091Proc.getClientDataModel();
    assert.ok(dataModel);
    assert.strictEqual(dataModel.version, 'v0.9.1');
  });

  it('updates components on correct surface', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);

    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{id: 'root', component: 'Box'}],
        },
      },
    ]);

    const surface = processor.model.getSurface('s1');
    assert.ok(surface?.componentsModel.get('root'));
  });

  it('updates existing components via message', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);

    // Verify component creation.
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{id: 'btn', component: 'Button', label: 'Initial'}],
        },
      },
    ]);

    const surface = processor.model.getSurface('s1');
    const btn = surface?.componentsModel.get('btn');
    assert.strictEqual(btn?.properties.label, 'Initial');

    // Verify component update.
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{id: 'btn', component: 'Button', label: 'Updated'}],
        },
      },
    ]);

    assert.strictEqual(btn?.properties.label, 'Updated');
  });

  it('rejects malformed component properties against the catalog schema', () => {
    const catalogWithButton = new Catalog('catalog-with-button', [ButtonApi]);
    const proc = new MessageProcessor([catalogWithButton]);

    proc.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'catalog-with-button'},
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
                  id: 'btn_malformed',
                  component: 'Button',
                  child: 'text1',
                  action: {
                    call: 'openUrl',
                    args: {url: 'https://www.google.com/'},
                  } as any,
                },
              ],
            },
          },
        ]);
      },
      (err: any) => err instanceof A2uiValidationError && err.message.includes('Validation failed'),
    );

    const surface = proc.model.getSurface('s1');
    assert.strictEqual(surface?.componentsModel.get('btn_malformed'), undefined);
  });

  it('does not apply partial updates when one component in a message fails validation', () => {
    const catalogWithButton = new Catalog('catalog-with-button', [ButtonApi]);
    const proc = new MessageProcessor([catalogWithButton]);

    proc.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'catalog-with-button'},
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
                  id: 'btn_valid',
                  component: 'Button',
                  child: 'text1',
                },
                {
                  id: 'btn_malformed',
                  component: 'Button',
                  child: 'text1',
                  action: {
                    call: 'openUrl',
                    args: {url: 'https://www.google.com/'},
                  } as any,
                },
              ],
            },
          },
        ]);
      },
      (err: any) => err instanceof A2uiValidationError,
    );

    const surface = proc.model.getSurface('s1');
    assert.strictEqual(surface?.componentsModel.get('btn_valid'), undefined);
    assert.strictEqual(surface?.componentsModel.get('btn_malformed'), undefined);
  });

  it('deletes surface', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);
    assert.ok(processor.model.getSurface('s1'));

    processor.processMessages([
      {
        version: 'v0.9',
        deleteSurface: {surfaceId: 's1'},
      },
    ]);
    assert.strictEqual(processor.model.getSurface('s1'), undefined);
  });

  it('routes data model updates', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);

    processor.processMessages([
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's1',
          path: '/foo',
          value: 'bar',
        },
      },
    ]);

    const surface = processor.model.getSurface('s1');
    assert.strictEqual(surface?.dataModel.get('/foo'), 'bar');
  });

  it('notifies lifecycle listeners', () => {
    let created: any = null;
    let deletedId: string | null = null;

    const sub = processor.onSurfaceCreated(s => {
      created = s;
    });
    const sub2 = processor.onSurfaceDeleted(id => {
      deletedId = id;
    });

    // Verify creation notification.
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);
    assert.ok(created);
    assert.strictEqual(created.id, 's1');

    // Verify deletion notification.
    processor.processMessages([
      {
        version: 'v0.9',
        deleteSurface: {surfaceId: 's1'},
      },
    ]);
    assert.strictEqual(deletedId, 's1');

    // Verify unsubscribe stops notifications.
    created = null;
    sub.unsubscribe();
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's2', catalogId: 'test-catalog'},
      },
    ]);
    assert.strictEqual(created, null);

    sub2.unsubscribe();
  });
  it('throws on message with multiple update types', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);

    assert.throws(() => {
      processor.processMessages([
        {
          version: 'v0.9',
          updateComponents: {surfaceId: 's1', components: []},
          updateDataModel: {surfaceId: 's1', path: '/', value: {}},
        } as any,
      ]);
    }, /Message contains multiple update types/);
  });

  it('throws when creating component without type', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);

    assert.throws(() => {
      processor.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'comp1', label: 'No Type'} as any],
          },
        },
      ]);
    }, /Cannot create component comp1 without a type/);
    const surface = processor.model.getSurface('s1');
    assert.strictEqual(surface?.componentsModel.get('comp1'), undefined);
  });

  it('recreates component when type changes', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);

    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{id: 'comp1', component: 'Button', label: 'Btn'}],
        },
      },
    ]);

    let surface = processor.model.getSurface('s1');
    let comp = surface?.componentsModel.get('comp1');
    assert.strictEqual(comp?.type, 'Button');

    // Change type to Label
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{id: 'comp1', component: 'Label', text: 'Lbl'}],
        },
      },
    ]);

    surface = processor.model.getSurface('s1');
    comp = surface?.componentsModel.get('comp1');
    assert.strictEqual(comp?.type, 'Label');
    assert.strictEqual(comp?.properties.text, 'Lbl');
    assert.strictEqual(comp?.properties.label, undefined);
  });

  it('throws when catalog not found', () => {
    assert.throws(() => {
      processor.processMessages([
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'unknown-catalog',
          },
        },
      ]);
    }, /Catalog not found: unknown-catalog/);
  });

  it('throws when duplicate surface created', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);

    assert.throws(() => {
      processor.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
        },
      ]);
    }, /Surface s1 already exists/);
  });

  it('throws when updating non-existent surface', () => {
    assert.throws(() => {
      processor.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'unknown-s',
            components: [] as any,
          },
        },
      ]);
    }, /Surface not found for message: unknown-s/);
  });

  it('throws when component is missing id', () => {
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      },
    ]);
    assert.throws(() => {
      processor.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [{component: 'Button'} as any],
          },
        },
      ]);
    }, /missing an 'id'/);
  });

  it('throws when updating data on non-existent surface', () => {
    assert.throws(() => {
      processor.processMessages([
        {
          version: 'v0.9',
          updateDataModel: {surfaceId: 'unknown-s', path: '/', value: {}},
        },
      ]);
    }, /Surface not found for message: unknown-s/);
  });

  describe('processMessages wrapper', () => {
    it('processes a list of messages', () => {
      processor.processMessages({
        messages: [
          {
            version: 'v0.9',
            createSurface: {
              surfaceId: 's1',
              catalogId: 'test-catalog',
            },
          },
          {
            version: 'v0.9',
            createSurface: {
              surfaceId: 's2',
              catalogId: 'test-catalog',
            },
          },
        ],
      });
      assert.ok(processor.model.getSurface('s1'));
      assert.ok(processor.model.getSurface('s2'));
    });
  });

  it('resolves paths correctly via resolvePath', () => {
    assert.strictEqual(processor.resolvePath('/foo', '/bar'), '/foo');
    assert.strictEqual(processor.resolvePath('foo', '/bar'), '/bar/foo');
    assert.strictEqual(processor.resolvePath('foo', '/bar/'), '/bar/foo');
    assert.strictEqual(processor.resolvePath('foo'), '/foo');
  });

  describe('formatZodIssue and error reporting', () => {
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
        message: 'Expected undefined, received undefined', // simulates minified corrupted message
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

    it('surfaces unrecognized property validation error and details when processing component updates', () => {
      const strictButtonApi: ComponentApi = {
        name: 'MaterialButton',
        schema: z
          .object({
            label: z.string(),
          })
          .strict(),
      };
      const proc = new MessageProcessor([new Catalog('cat-m3', [strictButtonApi])]);
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
          assert.ok(Array.isArray(err.details));
          assert.strictEqual(err.details[0].code, 'unrecognized_keys');
          return true;
        },
      );
    });
  });

  describe('catalog alias resolution', () => {
    const CANONICAL_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
    const LEGACY_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

    const TextComp = {
      name: 'Text',
      schema: z.object({text: z.string()}),
    } satisfies ComponentApi;

    let aliasedCatalog: Catalog<ComponentApi>;
    let aliasedProcessor: MessageProcessor<ComponentApi>;

    beforeEach(() => {
      aliasedCatalog = new Catalog('canonical-catalog', [TextComp], [], undefined, [
        'legacy-catalog',
        'other-legacy-catalog',
      ]);
      aliasedProcessor = new MessageProcessor<ComponentApi>([aliasedCatalog]);
    });

    it('creates a surface when createSurface names an alias', () => {
      aliasedProcessor.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 's1', catalogId: 'legacy-catalog'},
        },
      ]);

      const surface = aliasedProcessor.model.getSurface('s1');
      assert.ok(surface, 'surface should be created from the aliased catalog id');
      // The surface must bind the canonical catalog object, not a synthetic
      // stand-in keyed by the legacy id.
      assert.strictEqual(surface.catalog, aliasedCatalog);
      assert.strictEqual(surface.catalog.id, 'canonical-catalog');
    });

    it('resolves every alias in the list, not just the first', () => {
      aliasedProcessor.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 's1', catalogId: 'other-legacy-catalog'},
        },
      ]);

      assert.strictEqual(aliasedProcessor.model.getSurface('s1')?.catalog, aliasedCatalog);
    });

    it('still resolves the canonical id when aliases are present', () => {
      aliasedProcessor.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 's1', catalogId: 'canonical-catalog'},
        },
      ]);

      assert.strictEqual(aliasedProcessor.model.getSurface('s1')?.catalog, aliasedCatalog);
    });

    it('renders components from the canonical catalog on an alias-created surface', () => {
      // Alias resolution is only useful if the surface then accepts the
      // canonical catalog's components.
      aliasedProcessor.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 's1', catalogId: 'legacy-catalog'},
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'root', component: 'Text', text: 'hello'}],
          },
        },
      ]);

      const root = aliasedProcessor.model.getSurface('s1')?.componentsModel.get('root');
      assert.strictEqual(root?.type, 'Text');
    });

    it('throws when the catalog id matches neither an id nor an alias', () => {
      assert.throws(
        () =>
          aliasedProcessor.processMessages([
            {
              version: 'v0.9',
              createSurface: {surfaceId: 's1', catalogId: 'unknown-catalog'},
            },
          ]),
        (err: unknown) =>
          err instanceof A2uiStateError && /Catalog not found: unknown-catalog/.test(err.message),
      );
      assert.strictEqual(aliasedProcessor.model.getSurface('s1'), undefined);
    });

    it('throws rather than failing on catalogs that declare no aliases', () => {
      // `aliases` is optional, so resolution must tolerate `undefined` while
      // scanning past a catalog that does not declare any.
      const plainProcessor = new MessageProcessor<ComponentApi>([
        new Catalog('plain-catalog', [TextComp]),
        aliasedCatalog,
      ]);

      assert.throws(
        () =>
          plainProcessor.processMessages([
            {
              version: 'v0.9',
              createSurface: {surfaceId: 's1', catalogId: 'unknown-catalog'},
            },
          ]),
        A2uiStateError,
      );

      plainProcessor.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 's2', catalogId: 'legacy-catalog'},
        },
      ]);
      assert.strictEqual(plainProcessor.model.getSurface('s2')?.catalog, aliasedCatalog);
    });

    it('prefers an exact id match over another catalog claiming it as an alias', () => {
      const owner = new Catalog<ComponentApi>('contested-id', [TextComp]);
      const claimant = new Catalog<ComponentApi>('claimant-id', [TextComp], [], undefined, [
        'contested-id',
      ]);

      // The claimant is listed first, so a pure array scan would return it.
      const proc = new MessageProcessor<ComponentApi>([claimant, owner]);
      proc.processMessages([
        {
          version: 'v0.9',
          createSurface: {surfaceId: 's1', catalogId: 'contested-id'},
        },
      ]);

      assert.strictEqual(
        proc.model.getSurface('s1')?.catalog,
        owner,
        'a catalog that owns the id outright should win over one that aliases it',
      );
    });

    it('advertises only canonical ids in client capabilities', () => {
      // Aliases exist to accept legacy traffic, not to invite it: the client
      // tells the agent which id it wants surfaces created with.
      const caps = aliasedProcessor.getClientCapabilities() as any;

      assert.deepStrictEqual(caps['v0.9'].supportedCatalogIds, ['canonical-catalog']);
    });

    it('accepts the legacy basic catalog id used by existing Flutter clients', () => {
      // The concrete compatibility case this support was added for.
      const basic = new Catalog<ComponentApi>(CANONICAL_ID, [TextComp], [], undefined, [LEGACY_ID]);
      const proc = new MessageProcessor<ComponentApi>([basic]);

      proc.processMessages([
        {version: 'v0.9', createSurface: {surfaceId: 'legacy', catalogId: LEGACY_ID}},
        {version: 'v0.9', createSurface: {surfaceId: 'modern', catalogId: CANONICAL_ID}},
      ]);

      assert.strictEqual(proc.model.getSurface('legacy')?.catalog.id, CANONICAL_ID);
      assert.strictEqual(proc.model.getSurface('modern')?.catalog.id, CANONICAL_ID);
    });
  });
});
