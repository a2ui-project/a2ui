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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {z} from 'zod';
import {RpcHandler, RpcError, RpcErrorCode} from './rpc-handler.js';
import {Catalog, createFunctionImplementation} from '../../catalog/types.js';
import {DataContext} from '../../rendering/data-context.js';
import {SurfaceModel} from '../../state/surface-model.js';
import {IndexImplementation} from '../functions/system_functions.js';

describe('Stage 3 (Sauce-TS) Bidirectional RPC & @index Function Verification', () => {
  const customRpcApi = {
    name: 'customRpc',
    returnType: 'string' as const,
    schema: z.object({text: z.string()}),
    allowedCallers: 'rendererOrAgent' as const,
  };
  const customRpcImpl = createFunctionImplementation(
    customRpcApi,
    args => `Processed: ${args.text}`,
  );

  const rendererOnlyApi = {
    name: 'internalRenderer',
    returnType: 'void' as const,
    schema: z.object({}),
    allowedCallers: 'rendererOnly' as const,
  };
  const rendererOnlyImpl = createFunctionImplementation(rendererOnlyApi, () => {});

  const restrictedApi = {
    name: 'userActionOnly',
    returnType: 'boolean' as const,
    schema: z.object({}),
    allowedCallers: 'rendererOrAgent' as const,
    requiresUserActivation: true,
  };
  const restrictedImpl = createFunctionImplementation(restrictedApi, () => true);

  const mockCatalog = new Catalog(
    'basic',
    [],
    [customRpcImpl, rendererOnlyImpl, restrictedImpl, IndexImplementation],
  );

  it('instantiates via options bag RpcHandlerOptions', () => {
    const handler = new RpcHandler({
      catalogs: [mockCatalog],
      defaultTimeoutMs: 5000,
    });
    assert.strictEqual(handler.disposed, false);
  });

  it('executes valid callRendererFunction remote RPC and returns value payload', async () => {
    const handler = new RpcHandler({catalogs: [mockCatalog]});
    const surface = new SurfaceModel('s1', mockCatalog);
    const context = new DataContext(surface, '/');

    const message = {
      version: 'v1.0' as const,
      callRendererFunction: {
        functionCallId: 'rpc-1',
        callFunction: {
          call: 'customRpc',
          catalogId: 'basic',
          args: {text: 'Hello A2UI'},
        },
      },
    };

    const response = await handler.handleCallRendererFunction(message, context, false);
    assert.strictEqual(response.version, 'v1.0');
    assert.strictEqual(response.rendererFunctionResponse.functionCallId, 'rpc-1');
    assert.strictEqual(response.rendererFunctionResponse.value, 'Processed: Hello A2UI');
    assert.strictEqual(response.rendererFunctionResponse.error, undefined);
  });

  it('rejects callRendererFunction targeting rendererOnly function with INVALID_FUNCTION_CALL', async () => {
    const handler = new RpcHandler([mockCatalog]);
    const surface = new SurfaceModel('s1', mockCatalog);
    const context = new DataContext(surface, '/');

    const message = {
      version: 'v1.0' as const,
      callRendererFunction: {
        functionCallId: 'rpc-2',
        callFunction: {
          call: 'internalRenderer',
          catalogId: 'basic',
        },
      },
    };

    const response = await handler.handleCallRendererFunction(message, context, false);
    assert.strictEqual(response.rendererFunctionResponse.functionCallId, 'rpc-2');
    assert.strictEqual(response.rendererFunctionResponse.value, undefined);
    assert.strictEqual(
      response.rendererFunctionResponse.error?.code,
      RpcErrorCode.INVALID_FUNCTION_CALL,
    );
  });

  it('rejects function call requiring user activation when isUserActivated is false', async () => {
    const handler = new RpcHandler([mockCatalog]);
    const surface = new SurfaceModel('s1', mockCatalog);
    const context = new DataContext(surface, '/');

    const message = {
      version: 'v1.0' as const,
      callRendererFunction: {
        functionCallId: 'rpc-3',
        callFunction: {
          call: 'userActionOnly',
          catalogId: 'basic',
        },
      },
    };

    const response = await handler.handleCallRendererFunction(message, context, false);
    assert.strictEqual(
      response.rendererFunctionResponse.error?.code,
      RpcErrorCode.INVALID_FUNCTION_CALL,
    );

    const authorizedResponse = await handler.handleCallRendererFunction(message, context, true);
    assert.strictEqual(authorizedResponse.rendererFunctionResponse.value, true);
  });

  it('tracks outbound callAgentFunction and resolves promise via handleAgentFunctionResponse', async () => {
    let emittedMessage: any;
    const handler = new RpcHandler({
      catalogs: [mockCatalog],
      outboundListener: msg => {
        emittedMessage = msg;
      },
    });

    const callPromise = handler.callAgentFunction('surface-1', 'agent-call-100', {
      call: 'fetchRemoteData',
      catalogId: 'basic',
      args: {query: 'test'},
    });

    assert.strictEqual(emittedMessage.version, 'v1.0');
    assert.strictEqual(emittedMessage.callAgentFunction.functionCallId, 'agent-call-100');

    handler.handleAgentFunctionResponse({
      version: 'v1.0',
      agentFunctionResponse: {
        functionCallId: 'agent-call-100',
        value: {items: [1, 2, 3]},
      },
    });

    const result = await callPromise;
    assert.deepStrictEqual(result, {items: [1, 2, 3]});
  });

  it('evaluates @index function returning loop index from nested DataContext path with offset', () => {
    const surface = new SurfaceModel('s1', mockCatalog);
    const context = new DataContext(surface, '/items/3/user/address');
    const indexValue = IndexImplementation.execute({offset: 1}, context);
    assert.strictEqual(indexValue, 4);

    // Alphanumeric segment starting with digit should be ignored
    const context2 = new DataContext(surface, '/order_99/items/2');
    const indexValue2 = IndexImplementation.execute({offset: 0}, context2);
    assert.strictEqual(indexValue2, 2);

    // Schema coercion parses string offsets and falls back safely on NaN
    const parsedArgs = IndexImplementation.schema?.parse({offset: '5'});
    const indexValue3 = IndexImplementation.execute(parsedArgs, context2);
    assert.strictEqual(indexValue3, 7);
  });

  it('generates fallback call function ID when globalThis.crypto is unavailable', async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      let emittedMsg: any;
      const handler = new RpcHandler({
        catalogs: [mockCatalog],
        outboundListener: msg => {
          emittedMsg = msg;
        },
      });

      const callPromise = handler.callAgentFunction('s1', {call: 'testFunc'});
      assert.ok(emittedMsg.callAgentFunction.functionCallId.startsWith('call-'));
      handler.dispose();
      await assert.rejects(callPromise, /CANCELLED/);
    } finally {
      if (originalCrypto) {
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
      }
    }
  });

  it('rejects pending agent function calls when RpcHandler is disposed', async () => {
    const handler = new RpcHandler({
      catalogs: [mockCatalog],
      outboundListener: () => {},
    });
    const promise = handler.callAgentFunction('surface-1', 'pending-1', {
      call: 'slowFunc',
    });
    handler.dispose();
    assert.strictEqual(handler.disposed, true);
    await assert.rejects(promise, (err: any) => {
      assert.ok(err instanceof RpcError);
      assert.strictEqual(err.code, RpcErrorCode.CANCELLED);
      return true;
    });
  });

  it('fails fast on post-disposal calls', async () => {
    const handler = new RpcHandler({
      catalogs: [mockCatalog],
      outboundListener: () => {},
    });
    handler.dispose();

    const surface = new SurfaceModel('s1', mockCatalog);
    const context = new DataContext(surface, '/');
    const response = await handler.handleCallRendererFunction(
      {
        version: 'v1.0',
        callRendererFunction: {
          functionCallId: 'call-post-dispose',
          callFunction: {call: 'customRpc', catalogId: 'basic', args: {text: 'hi'}},
        },
      },
      context,
      true,
    );

    assert.strictEqual(response.rendererFunctionResponse.error?.code, RpcErrorCode.DISPOSED);

    await assert.rejects(handler.callAgentFunction('surface-1', {call: 'test'}), (err: any) => {
      assert.ok(err instanceof RpcError);
      assert.strictEqual(err.code, RpcErrorCode.DISPOSED);
      return true;
    });
  });

  it('fails fast when calling callAgentFunction without outboundListener', async () => {
    const handler = new RpcHandler({catalogs: [mockCatalog]});
    await assert.rejects(handler.callAgentFunction('surface-1', {call: 'test'}), (err: any) => {
      assert.ok(err instanceof RpcError);
      assert.strictEqual(err.code, RpcErrorCode.NO_LISTENER);
      return true;
    });
  });

  it('times out callAgentFunction when timeoutMs is exceeded', async () => {
    const handler = new RpcHandler({
      catalogs: [mockCatalog],
      outboundListener: () => {},
    });
    const promise = handler.callAgentFunction(
      'surface-1',
      'pending-timeout',
      {call: 'timeoutFunc'},
      10,
    );
    await assert.rejects(promise, (err: any) => {
      assert.ok(err instanceof RpcError);
      assert.strictEqual(err.code, RpcErrorCode.TIMEOUT);
      return true;
    });
  });

  it('falls back to surface default catalog when catalogId is omitted', async () => {
    const handler = new RpcHandler([mockCatalog]);
    const surface = new SurfaceModel('s1', mockCatalog);
    const dataContext = new DataContext(surface, '/');

    const res = await handler.handleCallRendererFunction(
      {
        version: 'v1.0',
        callRendererFunction: {
          functionCallId: 'call-default-cat',
          callFunction: {
            call: 'customRpc',
            args: {text: 'hello'},
          },
        },
      },
      dataContext,
      true,
    );

    assert.strictEqual(res.rendererFunctionResponse.value, 'Processed: hello');
  });

  it('rejects callRendererFunction with INVALID_FUNCTION_CALL when argument schema validation fails', async () => {
    const handler = new RpcHandler([mockCatalog]);
    const surface = new SurfaceModel('s1', mockCatalog);
    const dataContext = new DataContext(surface, '/');

    const res = await handler.handleCallRendererFunction(
      {
        version: 'v1.0',
        callRendererFunction: {
          functionCallId: 'call-invalid-args',
          callFunction: {
            call: 'customRpc',
            catalogId: 'basic',
            args: {text: 12345}, // Number instead of expected string
          },
        },
      },
      dataContext,
      true,
    );

    assert.ok(res.rendererFunctionResponse.error);
    assert.strictEqual(res.rendererFunctionResponse.error.code, RpcErrorCode.INVALID_FUNCTION_CALL);
  });

  it('cleans up pending agent call when outboundListener throws', async () => {
    const handler = new RpcHandler([mockCatalog], () => {
      throw new Error('Connection failed');
    });

    await assert.rejects(
      handler.callAgentFunction('surface-1', 'fail-outbound', {call: 'testFunc'}),
      /Connection failed/,
    );
  });

  it('rejects callAgentFunction when function call or call name is missing', async () => {
    const handler = new RpcHandler([mockCatalog], () => {});
    await assert.rejects(
      handler.callAgentFunction('surface-1', 'call-1', undefined as any),
      (err: RpcError) => err.code === RpcErrorCode.INVALID_FUNCTION_CALL,
    );
  });

  it('handles null/undefined message gracefully in handleCallRendererFunction', async () => {
    const handler = new RpcHandler([mockCatalog]);
    const surface = new SurfaceModel('s1', mockCatalog);
    const dataContext = new DataContext(surface, '/');
    const res = await handler.handleCallRendererFunction(null as any, dataContext);
    assert.strictEqual(
      res.rendererFunctionResponse.error?.code,
      RpcErrorCode.INVALID_FUNCTION_CALL,
    );
  });

  it('handles null/undefined message gracefully in handleAgentFunctionResponse', () => {
    const handler = new RpcHandler([mockCatalog]);
    assert.doesNotThrow(() => {
      handler.handleAgentFunctionResponse(null as any);
    });
  });

  it('handles null/undefined options in RpcHandler constructor', () => {
    const handler = new RpcHandler(null as any);
    assert.strictEqual(handler.disposed, false);
  });
});
