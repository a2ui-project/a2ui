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
} from './message-processor.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {CardApi, RowApi, TabsApi} from '../v0_9/basic_catalog/components/basic_components.js';
import {A2uiValidationError} from '../errors.js';
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
      assert.strictEqual(cardChild.$ref, 'common_types.json#/$defs/ComponentId');
      assert.strictEqual(cardChild.type, undefined);

      const rowChildren = components.Row.allOf[1].properties.children;
      assert.strictEqual(rowChildren.$ref, 'common_types.json#/$defs/ChildList');

      const tabChild = components.Tabs.allOf[1].properties.tabs.items.properties.child;
      assert.strictEqual(tabChild.$ref, 'common_types.json#/$defs/ComponentId');
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
      assert.strictEqual(comp?.properties.label, 'Btn');
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
      }, /Invalid v0.9 message/);
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
          assert.strictEqual(err.message, 'Missing root component');
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
        schema: z.object({child: z.string().describe('Child component ID')}),
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
          assert.strictEqual(
            err.message,
            "Orphaned component 'orphan1' is not reachable from root",
          );
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
});
