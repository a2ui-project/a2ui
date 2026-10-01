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
import {A2uiIntegrityError, A2uiValidationError} from '../errors.js';
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
        version: 'v1.0',
        createSurface: {surfaceId: 'surface-1', catalogId: 'cat-basic'},
      });

      const responses = await processor.processMessagesAsync({
        version: 'v1.0',
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
        version: 'v1.0',
        createSurface: {surfaceId: 's1', catalogId: 'rpc-cat'},
      });

      const responses = await proc.processMessagesAsync({
        version: 'v1.0',
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

    it('enforces requiresUserActivation in processMessagesAsync via context options', async () => {
      const proc = new MessageProcessor([rpcCatalog]);
      proc.processMessages({
        version: 'v1.0',
        createSurface: {surfaceId: 's1', catalogId: 'rpc-cat'},
      });

      // Without user activation
      const unauthResponses = await proc.processMessagesAsync({
        version: 'v1.0',
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
          version: 'v1.0',
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
      assert.strictEqual(emittedMessage.callAgentFunction.callFunction.call, 'fetchAgentData');
      const callId = emittedMessage.callAgentFunction.functionCallId;

      // Inbound response processed through standard message processing pipeline
      proc.processMessages({
        version: 'v1.0',
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
        version: 'v1.0',
        createSurface: {surfaceId: 's1', catalogId: 'rpc-cat'},
      });

      // Fire-and-forget callRendererFunction in synchronous pipeline
      proc.processMessages({
        version: 'v1.0',
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
          version: 'v1.0',
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
          version: 'v1.0',
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
          version: 'v1.0',
          createSurface: {
            surfaceId: 'comp_meta_surface',
          },
        },
        {
          version: 'v1.0',
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
          version: 'v1.0',
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

    it('resolves version-compatible default catalog when catalogId is omitted', () => {
      const catV09 = new Catalog('cat-09', '0.9', []);
      const catV10A = new Catalog('cat-10-a', '1.0', []);
      const catV10B = new Catalog('cat-10-b', '1.0', []);
      const proc = new MessageProcessor<ComponentApi>([catV09, catV10A, catV10B]);

      // Message version v1.0 should skip incompatible catV09 (index 0) and select catV10A
      proc.processMessages([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's_v10',
          },
        },
      ]);

      const surfaceV10 = proc.getSurface('s_v10');
      assert.ok(surfaceV10);
      assert.strictEqual(surfaceV10.defaultCatalog.id, 'cat-10-a');
    });
  });
});
