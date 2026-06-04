/*
 * Copyright 2025 Google LLC
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

import assert from 'node:assert';
import {describe, it, beforeEach} from 'node:test';
import {MessageProcessor} from './message-processor.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
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
      const caps: any = processor.getClientCapabilities();
      assert.strictEqual((caps['v0.9'] as any).inlineCatalogs, undefined);
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
      const inlineCat = caps['v0.9'].inlineCatalogs![0];

      assert.strictEqual(inlineCat.catalogId, 'cat-1');
      const buttonSchema = inlineCat.components!.Button;

      assert.ok(buttonSchema.allOf);
      assert.strictEqual(buttonSchema.allOf[0].$ref, 'common_types.json#/$defs/ComponentCommon');
      assert.strictEqual(buttonSchema.allOf[1].properties.component.const, 'Button');
      assert.strictEqual(buttonSchema.allOf[1].properties.label.description, 'The button label');
      assert.deepStrictEqual(buttonSchema.allOf[1].required, ['component', 'label']);
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
        caps['v0.9'].inlineCatalogs![0].components!.Custom.allOf[1].properties.title;

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
      const inlineCat = caps['v0.9'].inlineCatalogs![0];

      assert.strictEqual(inlineCat.catalogId, 'cat-full');

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
      const inlineCat = caps['v0.9'].inlineCatalogs![0];

      assert.strictEqual(inlineCat.catalogId, 'cat-empty');
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

      const properties = caps['v0.9'].inlineCatalogs![0].components!.DeepComp.allOf[1].properties;
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

      const properties = caps['v0.9'].inlineCatalogs![0].components!.EdgeComp.allOf[1].properties;

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

      assert.strictEqual(caps['v0.9'].inlineCatalogs!.length, 2);

      const inlineCat1 = caps['v0.9'].inlineCatalogs![0];
      assert.strictEqual(inlineCat1.catalogId, 'cat-1');
      assert.strictEqual(inlineCat1.functions, undefined);
      assert.strictEqual(inlineCat1.theme, undefined);

      const inlineCat2 = caps['v0.9'].inlineCatalogs![1];
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
});
