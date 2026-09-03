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
  RELAXED_VALIDATION,
  ProcessableMessagePayload,
} from './message-processor.js';
import {Catalog, ComponentApi, FunctionImplementation} from '../catalog/types.js';
import {CardApi, RowApi, TabsApi} from '../v0_9/basic_catalog/components/basic_components.js';
import {BASIC_COMPONENTS} from '../v1_0/basic_catalog/components/basic_components.js';
import {A2uiIntegrityError, A2uiRecursionError, A2uiValidationError} from '../errors.js';
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

  describe('getRendererCapabilities', () => {
    it('generates basic capabilities with supportedCatalogIds', () => {
      const caps = processor.getRendererCapabilities();
      assert.deepStrictEqual(caps.supportedCatalogIds, ['test-catalog']);
      assert.ok(caps['v0.9']);
    });

    it('includes inline catalogs when requested', () => {
      const caps = processor.getRendererCapabilities({includeInlineCatalogs: true});
      assert.ok(caps.inlineCatalogs);
      assert.strictEqual(caps.inlineCatalogs.length, 1);
    });

    it('supports custom componentEnvelopeRef for inline catalogs', () => {
      const strictComp: ComponentApi = {
        name: 'CustomButton',
        schema: z.object({label: z.string()}),
      };
      const proc = new MessageProcessor([new Catalog('cat-custom', [strictComp])]);
      const caps = proc.getRendererCapabilities({
        includeInlineCatalogs: true,
        componentEnvelopeRef: 'https://example.com/schema.json#/$defs/Base',
      });
      const inlineCat = caps.inlineCatalogs?.[0] as any;
      assert.strictEqual(
        inlineCat.components.CustomButton.allOf[0].$ref,
        'https://example.com/schema.json#/$defs/Base',
      );
    });

    it('keeps $ref on basic catalog child references despite per-usage descriptions', () => {
      const cat = new Catalog('cat-basic', [CardApi, RowApi, TabsApi]);
      const proc = new MessageProcessor([cat]);

      const caps = proc.getRendererCapabilities({includeInlineCatalogs: true});
      const inlineCat = caps.inlineCatalogs?.[0] as any;
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

    it('generates v1.0 inline catalog schemas with dictionary functions and top-level defs', () => {
      const greetFunc: FunctionImplementation = {
        name: 'greet',
        description: 'Greets user',
        returnType: 'string',
        schema: z.object({name: z.string()}),
        execute: async (args: any) => `Hello, ${args.name}!`,
      };
      const cat = new Catalog('cat-v1', [CardApi], [greetFunc]);
      const proc = new MessageProcessor([cat], undefined, {version: 'v1.0'});

      const caps = proc.getRendererCapabilities({
        version: 'v1.0',
        includeInlineCatalogs: true,
      });

      const inlineCat = (caps['v1.0'] as any)?.inlineCatalogs?.[0];
      assert.ok(inlineCat);
      assert.strictEqual(inlineCat.catalogId, 'cat-v1');
      assert.ok(inlineCat.components.Card);
      assert.ok(inlineCat.functions.greet);
      assert.strictEqual(inlineCat.functions.greet.type, 'object');
      assert.strictEqual(typeof inlineCat.functions, 'object');
      assert.ok(!Array.isArray(inlineCat.functions));
    });
  });

  describe('getRendererDataModel', () => {
    it('returns undefined when no surfaces have sendDataModel enabled', () => {
      const model = processor.getRendererDataModel();
      assert.strictEqual(model, undefined);
    });

    it('returns data model payload for surfaces with sendDataModel enabled', () => {
      processor.processMessages({
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'test-catalog',
          sendDataModel: true,
          dataModel: {user: {name: 'Alice'}},
        },
      });

      const model = processor.getRendererDataModel();
      assert.ok(model);
      assert.strictEqual((model as any).surfaces.s1.user.name, 'Alice');
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
    it('creates a surface and processes components and data model updates', () => {
      processor.processMessages({
        version: 'v0.9',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'test-catalog',
        },
      });

      const surface = processor.getSurface('s1');
      assert.ok(surface);
      assert.strictEqual(surface?.id, 's1');
    });

    it('recreates component when type changes', () => {
      processor.processMessages({
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      });

      processor.processMessages({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{id: 'comp1', component: 'Button', label: 'Btn'}],
        },
      });

      let surface = processor.getSurface('s1');
      let comp = surface?.componentsModel.get('comp1');
      assert.strictEqual(comp?.type, 'Button');

      // Change type to Label
      processor.processMessages({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [{id: 'comp1', component: 'Label', text: 'Lbl'}],
        },
      });

      surface = processor.getSurface('s1');
      comp = surface?.componentsModel.get('comp1');
      assert.strictEqual(comp?.type, 'Label');
      assert.strictEqual(comp?.properties.text, 'Lbl');
      assert.strictEqual(comp?.properties.label, undefined);
    });

    it('throws when creating component without type', () => {
      processor.processMessages({
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      });

      assert.throws(() => {
        processor.processMessages({
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'comp1', label: 'No Type'} as any],
          },
        });
      }, /Cannot create component comp1 without a type/);
    });

    it('throws when catalog not found', () => {
      assert.throws(() => {
        processor.processMessages({
          version: 'v0.9',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'unknown-catalog',
          },
        });
      }, /Catalog not found: unknown-catalog/);
    });

    it('throws when duplicate surface created', () => {
      processor.processMessages({
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      });

      assert.throws(() => {
        processor.processMessages({
          version: 'v0.9',
          createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
        });
      }, /Surface s1 already exists/);
    });

    it('throws when updating non-existent surface', () => {
      assert.throws(() => {
        processor.processMessages({
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'unknown-s',
            components: [{id: 'root', component: 'Column'}],
          },
        });
      }, /Surface not found for message: unknown-s/);
    });

    it('throws when component is missing id', () => {
      processor.processMessages({
        version: 'v0.9',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      });
      assert.throws(() => {
        processor.processMessages({
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [{component: 'Button'} as any],
          },
        });
      }, /missing an 'id'/);
    });

    it('processes updateDataModel message at root and specific JSON pointer paths', () => {
      processor.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's1', catalogId: 'test-catalog'},
      });

      processor.processMessages({
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's1',
          path: '/user/profile',
          value: {name: 'Bob', age: 30},
        },
      });

      const surface = processor.getSurface('s1');
      assert.strictEqual(surface?.dataModel.get('/user/profile/name'), 'Bob');

      processor.processMessages({
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's1',
          value: {rootKey: 'rootValue'},
        },
      });
      assert.strictEqual(surface?.dataModel.get('/rootKey'), 'rootValue');
    });

    it('throws A2uiStateError when updateDataModel targets non-existent surface', () => {
      assert.throws(() => {
        processor.processMessages({
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 'non_existent',
            path: '/key',
            value: 'val',
          },
        });
      }, /Surface not found for message: non_existent/);
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
          return true;
        },
      );
    });
  });

  describe('ValidationConfig', () => {
    it('enforces targetVersion matching when configured', () => {
      const proc = new MessageProcessor([new Catalog('cat-test', [])], undefined, {
        validationConfig: {targetVersion: 'v1.0'},
      });

      // Matching version passes
      assert.doesNotThrow(() => {
        proc.processMessages({
          version: 'v1.0',
          createSurface: {surfaceId: 's1', catalogId: 'cat-test'},
        });
      });

      // Non-matching version throws
      assert.throws(
        () => {
          proc.processMessages({
            version: 'v0.9',
            deleteSurface: {surfaceId: 's1'},
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.ok(
            err.message.includes(
              "Message version 'v0.9' does not match expected target version 'v1.0'",
            ),
          );
          return true;
        },
      );
    });

    it('enforces allowedMessages filter when configured', () => {
      const proc = new MessageProcessor([new Catalog('cat-test', [])], undefined, {
        validationConfig: {allowedMessages: ['createSurface', 'updateComponents']},
      });

      assert.doesNotThrow(() => {
        proc.processMessages({
          version: 'v1.0',
          createSurface: {surfaceId: 's1', catalogId: 'cat-test'},
        });
      });

      // Disallowed operation throws
      assert.throws(
        () => {
          proc.processMessages({
            version: 'v1.0',
            deleteSurface: {surfaceId: 's1'},
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.ok(err.message.includes("Operation 'deleteSurface' is not permitted"));
          return true;
        },
      );
    });

    it('validates themeSchema when validationConfig is active', () => {
      const themeCatalog = new Catalog(
        'cat-theme',
        [],
        undefined,
        z.object({primaryColor: z.string()}),
      );
      const proc = new MessageProcessor([themeCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      assert.throws(
        () => {
          proc.processMessages({
            version: 'v0.9',
            createSurface: {
              surfaceId: 's1',
              catalogId: 'cat-theme',
              theme: {primaryColor: 123},
            },
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.ok(err.message.includes("Validation failed for theme on surface 's1'"));
          return true;
        },
      );
    });

    it('enforces allowUnknownElements: false by rejecting unregistered components', () => {
      const proc = new MessageProcessor([new Catalog('cat-strict', [])], undefined, {
        validationConfig: {allowUnknownElements: false, allowMissingRoot: true},
      });

      proc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's1', catalogId: 'cat-strict'},
      });

      assert.throws(
        () => {
          proc.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [{id: 'c1', component: 'UnregisteredWidget'}],
            },
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.ok(
            err.message.includes(
              "Unknown component type 'UnregisteredWidget' not found in catalog 'cat-strict'",
            ),
          );
          return true;
        },
      );
    });

    it('permits unregistered components when allowUnknownElements is true', () => {
      const proc = new MessageProcessor([new Catalog('cat-loose', [])], undefined, {
        validationConfig: {allowUnknownElements: true, allowMissingRoot: true},
      });

      assert.doesNotThrow(() => {
        proc.processMessages([
          {
            version: 'v1.0',
            createSurface: {surfaceId: 's1', catalogId: 'cat-loose'},
          },
          {
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [{id: 'c1', component: 'UnregisteredWidget'}],
            },
          },
        ]);
      });
    });

    it('enforces allowMissingRoot constraint', () => {
      const compApi: ComponentApi = {
        name: 'Card',
        schema: z.object({}),
      };
      const cat = new Catalog('cat-root', [compApi]);

      // allowMissingRoot: false throws when no root component exists
      const strictProc = new MessageProcessor([cat], undefined, {
        validationConfig: {allowMissingRoot: false},
      });
      strictProc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's1', catalogId: 'cat-root'},
      });

      assert.throws(
        () => {
          strictProc.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [{id: 'leaf1', component: 'Card'}],
            },
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.ok(err.message.includes('Missing root component'));
          return true;
        },
      );

      // allowMissingRoot: true passes when no root component exists
      const relaxedProc = new MessageProcessor([cat], undefined, {
        validationConfig: {allowMissingRoot: true},
      });
      relaxedProc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's2', catalogId: 'cat-root'},
      });

      assert.doesNotThrow(() => {
        relaxedProc.processMessages({
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's2',
            components: [{id: 'leaf1', component: 'Card'}],
          },
        });
      });
    });

    it('enforces allowDanglingReferences constraint', () => {
      const containerApi: ComponentApi = {
        name: 'Container',
        schema: z.object({child: z.string().describe('REF:common_types.json#/$defs/ComponentId')}),
      };
      const cat = new Catalog('cat-refs', [containerApi]);

      const strictProc = new MessageProcessor([cat], undefined, {
        validationConfig: {allowDanglingReferences: false},
      });
      strictProc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's1', catalogId: 'cat-refs'},
      });

      assert.throws(
        () => {
          strictProc.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [{id: 'root', component: 'Container', child: 'nonexistent-child'}],
            },
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.ok(
            err.message.includes("Dangling reference 'nonexistent-child' in component 'root'"),
          );
          return true;
        },
      );

      const relaxedProc = new MessageProcessor([cat], undefined, {
        validationConfig: {allowDanglingReferences: true, allowOrphanComponents: true},
      });
      relaxedProc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's2', catalogId: 'cat-refs'},
      });

      assert.doesNotThrow(() => {
        relaxedProc.processMessages({
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's2',
            components: [{id: 'root', component: 'Container', child: 'nonexistent-child'}],
          },
        });
      });
    });

    it('enforces allowOrphanComponents constraint', () => {
      const compApi: ComponentApi = {
        name: 'Card',
        schema: z.object({}),
      };
      const cat = new Catalog('cat-orphans', [compApi]);

      const strictProc = new MessageProcessor([cat], undefined, {
        validationConfig: {allowOrphanComponents: false},
      });
      strictProc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's1', catalogId: 'cat-orphans'},
      });

      assert.throws(
        () => {
          strictProc.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [
                {id: 'root', component: 'Card'},
                {id: 'orphan1', component: 'Card'},
              ],
            },
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.ok(err.message.includes('orphan1'));
          assert.ok(err.message.includes('not reachable'));
          return true;
        },
      );

      const relaxedProc = new MessageProcessor([cat], undefined, {
        validationConfig: {allowOrphanComponents: true},
      });
      relaxedProc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's2', catalogId: 'cat-orphans'},
      });

      assert.doesNotThrow(() => {
        relaxedProc.processMessages({
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's2',
            components: [
              {id: 'root', component: 'Card'},
              {id: 'orphan1', component: 'Card'},
            ],
          },
        });
      });
    });

    it('uses STRICT_VALIDATION and RELAXED_VALIDATION presets', () => {
      const compApi: ComponentApi = {
        name: 'Card',
        schema: z.object({}),
      };
      const cat = new Catalog('cat-preset', [compApi]);

      const strictProc = new MessageProcessor([cat], undefined, {
        validationConfig: STRICT_VALIDATION,
      });
      strictProc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's1', catalogId: 'cat-preset'},
      });

      assert.throws(
        () => {
          strictProc.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [{id: 'orphan', component: 'Card'}],
            },
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          return true;
        },
      );

      const relaxedProc = new MessageProcessor([cat], undefined, {
        validationConfig: RELAXED_VALIDATION,
      });
      relaxedProc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's2', catalogId: 'cat-preset'},
      });

      assert.doesNotThrow(() => {
        relaxedProc.processMessages({
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's2',
            components: [{id: 'orphan', component: 'Card'}],
          },
        });
      });
    });
  });

  describe('Mixed Catalogs Support', () => {
    const basicCat: Catalog<ComponentApi> = new Catalog('cat-basic', [
      {
        name: 'Box',
        schema: z.object({child: z.string().describe('ChildComponentId').optional()}),
      },
      {
        name: 'Text',
        schema: z.object({text: z.string()}),
      },
    ]);

    const customCat: Catalog<ComponentApi> = new Catalog('cat-custom', [
      {
        name: 'CustomCard',
        schema: z.object({
          title: z.string(),
          contentSlot: z.string().describe('ChildComponentId'),
        }),
      },
      {
        name: 'CustomButton',
        schema: z.object({
          actionName: z.string(),
          variant: z.enum(['primary', 'secondary']),
        }),
      },
    ]);

    it('processes and validates components from multiple catalogs on a single surface', () => {
      const processor = new MessageProcessor([basicCat, customCat]);

      // Create surface with basicCat as default
      processor.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 'surface-1', catalogId: 'cat-basic'},
      });

      // Send components from both cat-basic and cat-custom
      processor.processMessages({
        version: 'v1.0',
        updateComponents: {
          surfaceId: 'surface-1',
          components: [
            {
              id: 'root',
              component: 'CustomCard',
              catalogId: 'cat-custom',
              title: 'Dashboard',
              contentSlot: 'btn1',
            },
            {
              id: 'btn1',
              component: 'CustomButton',
              catalogId: 'cat-custom',
              actionName: 'submit',
              variant: 'primary',
            },
            {
              id: 'status',
              component: 'Text',
              text: 'Active',
            },
          ],
        },
      });

      const surface = processor.getSurface('surface-1');
      assert.ok(surface);

      const rootComp = surface?.componentsModel.get('root');
      assert.strictEqual(rootComp?.type, 'CustomCard');
      assert.strictEqual(rootComp?.catalog?.id, 'cat-custom');

      const btnComp = surface?.componentsModel.get('btn1');
      assert.strictEqual(btnComp?.type, 'CustomButton');
      assert.strictEqual(btnComp?.catalog?.id, 'cat-custom');

      const statusComp = surface?.componentsModel.get('status');
      assert.strictEqual(statusComp?.type, 'Text');
      assert.strictEqual(statusComp?.catalog?.id, 'cat-basic');
    });

    it('fails schema validation if custom component properties are invalid against custom catalog', () => {
      const processor = new MessageProcessor([basicCat, customCat]);
      processor.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 'surface-1', catalogId: 'cat-basic'},
      });

      assert.throws(
        () => {
          processor.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 'surface-1',
              components: [
                {
                  id: 'btn1',
                  component: 'CustomButton',
                  catalogId: 'cat-custom',
                  actionName: 'submit',
                  variant: 'invalid-variant',
                },
              ],
            },
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.ok(err.message.includes("Validation failed for component 'CustomButton'"));
          return true;
        },
      );
    });

    it('fails when component references an unknown catalogId', () => {
      const processor = new MessageProcessor([basicCat, customCat]);
      processor.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 'surface-1', catalogId: 'cat-basic'},
      });

      assert.throws(
        () => {
          processor.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 'surface-1',
              components: [
                {
                  id: 'c1',
                  component: 'CustomCard',
                  catalogId: 'non-existent-catalog',
                },
              ],
            },
          });
        },
        (err: any) => {
          assert.ok(err instanceof A2uiValidationError);
          assert.ok(err.message.includes("Unknown catalog ID 'non-existent-catalog'"));
          return true;
        },
      );
    });
  });

  describe('MessageProcessor Full Pipeline & Validation Integration', () => {
    const basicCatalog = new Catalog('https://a2ui.org/catalog', BASIC_COMPONENTS);

    it('validates a valid message envelope stream', () => {
      const proc = new MessageProcessor([basicCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });
      const payload: ProcessableMessagePayload = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'main',
            catalogId: 'https://a2ui.org/catalog',
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'main',
            components: [
              {
                id: 'root',
                component: 'Column',
                children: ['c1'],
              },
              {
                id: 'c1',
                component: 'Text',
                text: 'Hello World',
              },
            ],
          },
        },
      ];

      assert.doesNotThrow(() => proc.processMessages(payload));
      assert.ok(proc.getSurface('main'));
      assert.strictEqual(proc.getSurface('main')?.componentsModel.size, 2);
    });

    it('validates inline components inside createSurface for v1.0', () => {
      const proc = new MessageProcessor([basicCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });
      const payload: ProcessableMessagePayload = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'main',
          catalogId: 'https://a2ui.org/catalog',
          components: [
            {
              id: 'root',
              component: 'Column',
              children: ['c1'],
            },
            {
              id: 'c1',
              component: 'Text',
              text: 'Inline text',
            },
          ],
        },
      };

      assert.doesNotThrow(() => proc.processMessages(payload));
      assert.ok(proc.getSurface('main'));
      assert.strictEqual(proc.getSurface('main')?.componentsModel.size, 2);
    });

    it('respects relaxed validation config for dangling references & orphans', () => {
      const strictProc = new MessageProcessor([basicCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });
      const relaxedProc = new MessageProcessor([basicCatalog], undefined, {
        validationConfig: RELAXED_VALIDATION,
      });

      const orphanPayload: ProcessableMessagePayload = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'https://a2ui.org/catalog',
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [
              {id: 'root', component: 'Column', children: ['c1']},
              {id: 'c1', component: 'Text', text: 'Child'},
              {id: 'orphan', component: 'Text', text: 'Unused'},
            ],
          },
        },
      ];

      assert.throws(
        () => strictProc.processMessages(orphanPayload),
        (err: any) => err instanceof A2uiIntegrityError && err.message.includes('not reachable'),
      );

      assert.doesNotThrow(() => relaxedProc.processMessages(orphanPayload));
      assert.ok(relaxedProc.getSurface('s1'));
      assert.strictEqual(relaxedProc.getSurface('s1')?.componentsModel.size, 3);
    });

    it('validates components split across multiple stream messages', () => {
      const proc = new MessageProcessor([basicCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      proc.processMessages({
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'https://a2ui.org/catalog',
        },
      });

      // Split across multiple update messages in relaxed intermediate or batched update
      const splitPayload: ProcessableMessagePayload = [
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [
              {id: 'root', component: 'Column', children: ['c1']},
              {id: 'c1', component: 'Text', text: 'Child in first message'},
            ],
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'c1', component: 'Text', text: 'Child updated in second message'}],
          },
        },
      ];

      assert.doesNotThrow(() => proc.processMessages(splitPayload));
      assert.strictEqual(
        proc.getSurface('s1')?.componentsModel.get('c1')?.properties.text,
        'Child updated in second message',
      );
    });

    it('validates v0.9 envelope messages with version adapter', () => {
      const v09Catalog = new Catalog('basic', BASIC_COMPONENTS);
      const proc = new MessageProcessor([v09Catalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      const v09Payload: ProcessableMessagePayload = [
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'basic',
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's1',
            components: [
              {id: 'root', component: 'Card', child: 'txt'},
              {id: 'txt', component: 'Text', text: 'Hello v0.9'},
            ],
          },
        },
      ];

      assert.doesNotThrow(() => proc.processMessages(v09Payload));
      assert.ok(proc.getSurface('s1'));
      assert.strictEqual(proc.getSurface('s1')?.componentsModel.size, 2);
    });

    it('enforces recursion depth limit (>50) and path syntax in processMessages', () => {
      const proc = new MessageProcessor([basicCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      // Build payload exceeding recursion depth 50
      let nested: any = {leaf: 'val'};
      for (let i = 0; i < 52; i++) {
        nested = {layer: nested};
      }

      const recursivePayload: ProcessableMessagePayload = {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's_deep',
          catalogId: 'https://a2ui.org/catalog',
          theme: nested,
        },
      };

      assert.throws(
        () => proc.processMessages(recursivePayload),
        (err: any) =>
          err instanceof A2uiRecursionError &&
          err.message.includes('Global recursion limit exceeded'),
      );
    });

    it('processes and validates multi-surface payloads across mixed catalogs', () => {
      const catalogA = new Catalog('cat-a', [
        {
          name: 'BoxA',
          schema: z.object({childSlot: z.string().describe('ChildComponentId')}),
        },
      ]);
      const catalogB = new Catalog('cat-b', [
        {
          name: 'BoxB',
          schema: z.object({contentSlot: z.string().describe('ChildComponentId')}),
        },
        {
          name: 'LeafB',
          schema: z.object({text: z.string()}),
        },
      ]);

      const proc = new MessageProcessor([catalogA, catalogB], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      const components = [
        {id: 'root', component: 'BoxA', catalogId: 'cat-a', childSlot: 'node-b'},
        {id: 'node-b', component: 'BoxB', catalogId: 'cat-b', contentSlot: 'leaf-b'},
        {id: 'leaf-b', component: 'LeafB', catalogId: 'cat-b', text: 'Hello'},
      ];

      assert.doesNotThrow(() =>
        proc.processMessages({
          version: 'v1.0',
          createSurface: {
            surfaceId: 'multi-surf',
            catalogId: 'cat-a',
            components,
          },
        }),
      );

      assert.ok(proc.getSurface('multi-surf'));
      assert.strictEqual(proc.getSurface('multi-surf')?.componentsModel.size, 3);
    });

    it('validates full component properties on updates', () => {
      const counterCatalog = new Catalog('counter-cat', [
        {
          name: 'Counter',
          schema: z.object({
            label: z.string(),
            count: z.number().min(0),
          }),
        },
      ]);
      const proc = new MessageProcessor([counterCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      // 1. Initial creation
      proc.processMessages({
        version: 'v1.0',
        createSurface: {
          surfaceId: 's_delta',
          catalogId: 'counter-cat',
          components: [{id: 'root', component: 'Counter', label: 'Score', count: 5}],
        },
      });

      // 2. Full component update with new values
      assert.doesNotThrow(() =>
        proc.processMessages({
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's_delta',
            components: [{id: 'root', component: 'Counter', label: 'Updated Score', count: 10}],
          },
        }),
      );
      assert.strictEqual(
        proc.getSurface('s_delta')?.componentsModel.get('root')?.properties.count,
        10,
      );
      assert.strictEqual(
        proc.getSurface('s_delta')?.componentsModel.get('root')?.properties.label,
        'Updated Score',
      );

      // 3. Update missing required field 'label' fails schema validation
      assert.throws(
        () =>
          proc.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's_delta',
              components: [{id: 'root', component: 'Counter', count: 15}],
            },
          }),
        (err: any) =>
          err instanceof A2uiValidationError &&
          err.message.includes("Validation failed for component 'Counter'"),
      );

      // 4. Update with invalid count (< 0) fails schema validation
      assert.throws(
        () =>
          proc.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's_delta',
              components: [{id: 'root', component: 'Counter', label: 'Score', count: -1}],
            },
          }),
        (err: any) =>
          err instanceof A2uiValidationError &&
          err.message.includes("Validation failed for component 'Counter'"),
      );
    });

    it('replaces component properties on update so omitted properties are removed', () => {
      const cardCatalog = new Catalog('card-cat', [
        {
          name: 'Card',
          schema: z.object({
            title: z.string(),
            subtitle: z.string().optional(),
            child: z.string().describe('ChildComponentId'),
          }),
        },
        {
          name: 'Text',
          schema: z.object({text: z.string()}),
        },
      ]);
      const proc = new MessageProcessor([cardCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      // 1. Initial creation
      proc.processMessages({
        version: 'v1.0',
        createSurface: {
          surfaceId: 's_card',
          catalogId: 'card-cat',
          components: [
            {
              id: 'root',
              component: 'Card',
              title: 'Initial Title',
              subtitle: 'Initial Subtitle',
              child: 'txt',
            },
            {id: 'txt', component: 'Text', text: 'Hello'},
          ],
        },
      });

      let rootComp = proc.getSurface('s_card')?.componentsModel.get('root');
      assert.strictEqual(rootComp?.properties.title, 'Initial Title');
      assert.strictEqual(rootComp?.properties.subtitle, 'Initial Subtitle');

      // 2. Update providing replacement Card definition with new title, omitting subtitle
      proc.processMessages({
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's_card',
          components: [{id: 'root', component: 'Card', title: 'New Title', child: 'txt'}],
        },
      });

      rootComp = proc.getSurface('s_card')?.componentsModel.get('root');
      assert.strictEqual(rootComp?.properties.title, 'New Title');
      assert.strictEqual(rootComp?.properties.subtitle, undefined); // Omitted property was removed
      assert.strictEqual(rootComp?.properties.child, 'txt');

      // 3. Update missing required schema field (child) throws validation error
      assert.throws(
        () =>
          proc.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's_card',
              components: [{id: 'root', component: 'Card', title: 'Incomplete'}],
            },
          }),
        /Validation failed for component 'Card'/,
      );
    });

    it('preserves container child relationships in composition constraint validation during updates', () => {
      const constraintCatalog = new Catalog('constraint-cat', [
        {
          name: 'StrictParent',
          schema: z.object({
            title: z.string().optional(),
            children: z.array(z.string()).describe('ChildList'),
          }),
        },
        {
          name: 'RestrictedChild',
          schema: z.object({text: z.string()}),
          allowedParents: ['StrictParent'],
        },
      ]);
      const proc = new MessageProcessor([constraintCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      // 1. Initial surface creation with StrictParent and RestrictedChild
      proc.processMessages({
        version: 'v1.0',
        createSurface: {
          surfaceId: 's_constr',
          catalogId: 'constraint-cat',
          components: [
            {id: 'root', component: 'StrictParent', children: ['c1']},
            {id: 'c1', component: 'RestrictedChild', text: 'Allowed'},
          ],
        },
      });

      // 2. Update modifying title on StrictParent while keeping children intact
      assert.doesNotThrow(() =>
        proc.processMessages({
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's_constr',
            components: [
              {id: 'root', component: 'StrictParent', title: 'Updated Title', children: ['c1']},
            ],
          },
        }),
      );
    });

    it('does not treat non-reference string properties matching child component IDs as child references', () => {
      const constraintCatalog = new Catalog('constraint-cat-2', [
        {
          name: 'RootContainer',
          schema: z.object({
            children: z.array(z.string()).describe('ChildList'),
          }),
        },
        {
          name: 'AllowedParent',
          schema: z.object({
            child: z.string().describe('Child'),
          }),
          allowedParents: ['RootContainer'],
        },
        {
          name: 'RestrictedChild',
          schema: z.object({text: z.string()}),
          allowedParents: ['AllowedParent'],
        },
        {
          name: 'TextDisplay',
          schema: z.object({text: z.string()}),
          allowedParents: ['RootContainer'],
        },
      ]);
      const proc = new MessageProcessor([constraintCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      // TextDisplay has text: 'rc1', which matches RestrictedChild's ID 'rc1'.
      // Because 'text' is not a schema reference property, TextDisplay must NOT be treated as a parent of rc1.
      assert.doesNotThrow(() =>
        proc.processMessages({
          version: 'v1.0',
          createSurface: {
            surfaceId: 's_text_test',
            catalogId: 'constraint-cat-2',
            components: [
              {id: 'root', component: 'RootContainer', children: ['ap1', 'td1']},
              {id: 'ap1', component: 'AllowedParent', child: 'rc1'},
              {id: 'rc1', component: 'RestrictedChild', text: 'Hello'},
              {id: 'td1', component: 'TextDisplay', text: 'rc1'},
            ],
          },
        }),
      );
    });

    it('leaves componentsModel untouched when updateComponents fails topology validation', () => {
      const proc = new MessageProcessor([basicCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      // 1. Initial valid surface
      proc.processMessages({
        version: 'v1.0',
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
            version: 'v1.0',
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

    it('leaves componentsModel untouched when updateComponents introduces a circular reference', () => {
      const proc = new MessageProcessor([basicCatalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });

      proc.processMessages({
        version: 'v1.0',
        createSurface: {
          surfaceId: 's_cycle',
          catalogId: 'https://a2ui.org/catalog',
          components: [
            {id: 'root', component: 'Column', children: ['c1']},
            {id: 'c1', component: 'Text', text: 'Child'},
          ],
        },
      });

      const surface = proc.getSurface('s_cycle')!;

      // Attempt to create a cycle (c1 -> c2 -> c1)
      assert.throws(
        () =>
          proc.processMessages({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's_cycle',
              components: [
                {id: 'root', component: 'Column', children: ['c1']},
                {id: 'c1', component: 'Column', children: ['c2']},
                {id: 'c2', component: 'Column', children: ['c1']},
              ],
            },
          }),
        (err: any) =>
          err instanceof A2uiRecursionError && err.message.includes('Circular reference'),
      );

      // Verify that componentsModel remains in the pre-update state
      assert.strictEqual(surface.componentsModel.size, 2);
      assert.strictEqual(surface.componentsModel.has('c2'), false);
      assert.strictEqual(surface.componentsModel.get('c1')?.type, 'Text');
    });

    it('leaves componentsModel untouched when updateComponents contains a valid component followed by an untyped new component', () => {
      const proc = new MessageProcessor([basicCatalog]);

      proc.processMessages({
        version: 'v1.0',
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

    it('handles empty message array without throwing or processing', () => {
      const proc = new MessageProcessor([basicCatalog]);
      assert.doesNotThrow(() => proc.processMessages([]));
      assert.strictEqual(proc.getSurfaces().size, 0);
    });

    it('allows partial streaming component updates before parent container arrives', () => {
      const cardComp: ComponentApi = {
        name: 'Card',
        allowedParents: ['Surface'],
        allowedChildren: ['Button'],
        schema: z.object({
          child: z.string().describe('REF:common_types.json#/$defs/ComponentId'),
        }),
      };
      const buttonComp: ComponentApi = {
        name: 'Button',
        allowedParents: ['Card'],
        schema: z.object({
          label: z.string(),
        }),
      };

      const customCat = new Catalog('custom-stream', [cardComp, buttonComp]);
      const proc = new MessageProcessor([customCat], undefined, {
        validationConfig: {allowOrphanComponents: true, allowMissingRoot: true},
      });

      // Stream child Button first before Card arrives
      assert.doesNotThrow(() =>
        proc.processMessages([
          {
            version: 'v1.0',
            createSurface: {
              surfaceId: 'stream-surface',
              catalogId: 'custom-stream',
            },
          },
          {
            version: 'v1.0',
            updateComponents: {
              surfaceId: 'stream-surface',
              components: [{id: 'b1', component: 'Button', label: 'Click'}],
            },
          },
        ]),
      );

      // Now attach root Card containing Button
      assert.doesNotThrow(() =>
        proc.processMessages({
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'stream-surface',
            components: [{id: 'root', component: 'Card', child: 'b1'}],
          },
        }),
      );

      const surface = proc.getSurface('stream-surface');
      assert.ok(surface);
      assert.strictEqual(surface.componentsModel.size, 2);
    });
  });
});
