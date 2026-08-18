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
            components: [] as any,
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
});
