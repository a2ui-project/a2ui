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
import {A2uiValidationError} from '../../errors.js';
import {VersionAdapterFactory} from './factory.js';
import {
  InternalCreateSurfaceOp,
  InternalUpdateComponentsOp,
  InternalUpdateDataModelOp,
  InternalDeleteSurfaceOp,
} from '../operations.js';
import {VersionAdapter} from './base.js';

describe('VersionAdapterFactory', () => {
  it('resolves v1.0 adapter and extracts operations with initial state and surface properties', () => {
    const payload = {
      version: 'v1.0',
      createSurface: {
        surfaceId: 's1',
        catalogId: 'basic',
        sendDataModel: true,
        components: [{id: 'root', component: 'Column'}],
        dataModel: {
          key: 'value',
        },
      },
    };

    const adapter = VersionAdapterFactory.resolveFromPayload(payload);
    assert.strictEqual(adapter.version, 'v1.0');

    const ops = adapter.extractOperations(payload);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as InternalCreateSurfaceOp;
    assert.strictEqual(op.type, 'createSurface');
    assert.strictEqual(op.surfaceId, 's1');
    assert.strictEqual(op.theme, undefined);
    assert.strictEqual(op.sendDataModel, true);
    assert.deepStrictEqual(op.components, [{id: 'root', component: 'Column'}]);
    assert.deepStrictEqual(op.dataModel, {key: 'value'});
  });

  it('resolves v0.9 adapter and extracts createSurface operations', () => {
    const payload = {
      version: 'v0.9',
      createSurface: {
        surfaceId: 's1',
        catalogId: 'basic',
        theme: {primaryColor: '#FF0000'},
      },
    };

    const adapter = VersionAdapterFactory.resolveFromPayload(payload);
    assert.strictEqual(adapter.version, 'v0.9');

    const ops = adapter.extractOperations(payload);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as InternalCreateSurfaceOp;
    assert.strictEqual(op.surfaceId, 's1');
    assert.deepStrictEqual(op.theme, {primaryColor: '#FF0000'});
  });

  it('resolves v0.8 adapter and normalizes beginRendering into createSurface operation', () => {
    const payload = {
      version: 'v0.8',
      beginRendering: {
        surfaceId: 's1',
        root: 'root',
        styles: {primaryColor: '#FF0000'},
      },
    };

    const adapter = VersionAdapterFactory.resolveFromPayload(payload);
    assert.strictEqual(adapter.version, 'v0.8');

    const ops = adapter.extractOperations(payload);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as InternalCreateSurfaceOp;
    assert.strictEqual(op.type, 'createSurface');
    assert.strictEqual(op.surfaceId, 's1');
    assert.deepStrictEqual(op.theme, {primaryColor: '#FF0000'});
  });

  it('extracts surfaceUpdate and dataModelUpdate operations in v0.8 adapter', () => {
    const adapter = VersionAdapterFactory.getAdapter('v0.8');

    const surfaceOps = adapter.extractOperations({
      surfaceUpdate: {
        surfaceId: 's1',
        components: [{id: 'btn1', component: 'Button', label: 'Click'}],
      },
    });
    assert.strictEqual(surfaceOps.length, 1);
    assert.strictEqual(surfaceOps[0].type, 'updateComponents');
    assert.strictEqual(surfaceOps[0].surfaceId, 's1');

    const dataOps = adapter.extractOperations({
      dataModelUpdate: {
        surfaceId: 's1',
        path: '/count',
        value: 42,
      },
    });
    assert.strictEqual(dataOps.length, 1);
    assert.strictEqual(dataOps[0].type, 'updateDataModel');
    assert.strictEqual(dataOps[0].surfaceId, 's1');
    assert.strictEqual((dataOps[0] as any).value, 42);
  });

  it('supports dynamic registration of custom version adapters', () => {
    const customAdapter: VersionAdapter = {
      version: 'v2.0',
      extractOperations: () => [
        {
          type: 'createSurface',
          surfaceId: 's_custom',
          catalogId: 'custom',
        },
      ],
    };

    VersionAdapterFactory.registerAdapter(customAdapter);
    const resolved = VersionAdapterFactory.getAdapter('v2.0');
    assert.strictEqual(resolved.version, 'v2.0');

    const ops = resolved.extractOperations({});
    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].surfaceId, 's_custom');
  });

  it('throws an A2uiValidationError for unrecognized or missing version strings', () => {
    assert.throws(
      () => VersionAdapterFactory.getAdapter('v99.0'),
      err =>
        err instanceof A2uiValidationError &&
        /Unsupported protocol version 'v99\.0'/.test(err.message),
    );
    assert.throws(
      () => VersionAdapterFactory.resolveFromPayload({}),
      err =>
        err instanceof A2uiValidationError && /missing a valid 'version' string/.test(err.message),
    );
  });

  it('resolves v0.9.1 version string to v0.9 adapter', () => {
    const adapter = VersionAdapterFactory.getAdapter('v0.9.1');
    assert.strictEqual(adapter.version, 'v0.9');

    const fromPayload = VersionAdapterFactory.resolveFromPayload({version: 'v0.9.1'});
    assert.strictEqual(fromPayload.version, 'v0.9');
  });

  it('resolves adapter and extracts operations from batch array payloads', () => {
    const payload = [
      {version: 'v1.0', createSurface: {surfaceId: 's1', catalogId: 'basic'}},
      {version: 'v1.0', deleteSurface: {surfaceId: 's1'}},
    ];

    const adapter = VersionAdapterFactory.resolveFromPayload(payload);
    assert.strictEqual(adapter.version, 'v1.0');

    const ops = adapter.extractOperations(payload);
    assert.strictEqual(ops.length, 2);
    assert.strictEqual(ops[0].type, 'createSurface');
    assert.strictEqual(ops[1].type, 'deleteSurface');
  });

  it('resolves adapter and extracts operations from wrapped { messages: [...] } payload', () => {
    const payload = {
      messages: [
        {version: 'v1.0', createSurface: {surfaceId: 's1'}},
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'root', component: 'Column'}],
          },
        },
      ],
    };

    const adapter = VersionAdapterFactory.resolveFromPayload(payload);
    assert.strictEqual(adapter.version, 'v1.0');

    const ops = adapter.extractOperations(payload);
    assert.strictEqual(ops.length, 2);
    assert.strictEqual(ops[0].type, 'createSurface');
    assert.strictEqual(ops[1].type, 'updateComponents');
  });

  it('extracts updateComponents, updateDataModel, and deleteSurface operations', () => {
    const adapter = VersionAdapterFactory.getAdapter('v1.0');

    const ucOps = adapter.extractOperations({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [{id: 'c1', component: 'Text', text: 'Hi'}],
      },
    });
    assert.strictEqual(ucOps.length, 1);
    const ucOp = ucOps[0] as InternalUpdateComponentsOp;
    assert.strictEqual(ucOp.type, 'updateComponents');
    assert.strictEqual(ucOp.surfaceId, 's1');
    assert.deepStrictEqual(ucOp.components, [{id: 'c1', component: 'Text', text: 'Hi'}]);

    const udOps = adapter.extractOperations({
      version: 'v1.0',
      updateDataModel: {
        surfaceId: 's1',
        path: '/user/name',
        value: 'Alice',
      },
    });
    assert.strictEqual(udOps.length, 1);
    const udOp = udOps[0] as InternalUpdateDataModelOp;
    assert.strictEqual(udOp.type, 'updateDataModel');
    assert.strictEqual(udOp.surfaceId, 's1');
    assert.strictEqual(udOp.path, '/user/name');
    assert.strictEqual(udOp.value, 'Alice');

    const dsOps = adapter.extractOperations({
      version: 'v1.0',
      deleteSurface: {
        surfaceId: 's1',
      },
    });
    assert.strictEqual(dsOps.length, 1);
    const dsOp = dsOps[0] as InternalDeleteSurfaceOp;
    assert.strictEqual(dsOp.type, 'deleteSurface');
    assert.strictEqual(dsOp.surfaceId, 's1');
  });

  it('throws A2uiValidationError for null, undefined, primitive, or non-object payloads in resolveFromPayload', () => {
    const invalidPayloads = [null, undefined, 42, 'v1.0', [], {version: 123}, {version: null}];
    for (const invalid of invalidPayloads) {
      assert.throws(
        () => VersionAdapterFactory.resolveFromPayload(invalid),
        err =>
          err instanceof A2uiValidationError &&
          /missing a valid 'version' string/.test(err.message),
      );
    }
  });

  it('returns empty array when extractOperations is called with non-object/null values', () => {
    const adapter = VersionAdapterFactory.getAdapter('v1.0');
    assert.deepStrictEqual(adapter.extractOperations(null), []);
    assert.deepStrictEqual(adapter.extractOperations(undefined), []);
    assert.deepStrictEqual(adapter.extractOperations('not-an-object'), []);
    assert.deepStrictEqual(adapter.extractOperations(123), []);
  });
});

import {MessageProcessor} from '../message-processor.js';
import {Catalog} from '../../catalog/types.js';

describe('MessageProcessor Dependency Injection', () => {
  it('uses custom injected adapterRegistry when provided in MessageProcessorOptions', () => {
    let customRegistryInvoked = false;
    const customRegistry = {
      getAdapter: () => ({
        version: 'vCustom',
        extractOperations: () => [
          {
            type: 'createSurface' as const,
            surfaceId: 'injected_surface',
            catalogId: 'basic',
          },
        ],
      }),
      resolveFromPayload: () => {
        customRegistryInvoked = true;
        return {
          version: 'vCustom',
          extractOperations: () => [
            {
              type: 'createSurface' as const,
              surfaceId: 'injected_surface',
              catalogId: 'basic',
            },
          ],
        };
      },
    };

    const processor = new MessageProcessor([new Catalog('basic', [])], undefined, {
      adapterRegistry: customRegistry,
    });

    processor.processMessages({version: 'vCustom'});
    assert.strictEqual(customRegistryInvoked, true);
    assert.notStrictEqual(processor.getSurface('injected_surface'), undefined);
  });

  it('merges existing properties on partial updateComponents operations', () => {
    const textApi = {
      name: 'Text',
      schema: z.object({
        text: z.string(),
        color: z.string().optional(),
      }),
    };
    const catalog = new Catalog('basic', [textApi]);
    const processor = new MessageProcessor([catalog]);

    processor.processMessages({
      version: 'v1.0',
      createSurface: {
        surfaceId: 's1',
        catalogId: 'basic',
        components: [{id: 't1', component: 'Text', text: 'Hello', color: 'red'}],
      },
    });

    processor.processMessages({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [{id: 't1', color: 'blue'}],
      },
    });

    const surface = processor.getSurface('s1');
    const comp = surface?.componentsModel.get('t1');
    assert.strictEqual(comp?.properties.text, 'Hello');
    assert.strictEqual(comp?.properties.color, 'blue');
  });
});
