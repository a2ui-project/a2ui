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
import {InternalCreateSurfaceOp} from '../operations.js';
import {VersionAdapter} from './base.js';

describe('VersionAdapterFactory', () => {
  it('resolves v1.0 adapter and extracts operations with initial state and surface properties', () => {
    const payload = {
      version: 'v1.0',
      createSurface: {
        surfaceId: 's1',
        catalogId: 'basic',
        theme: {primaryColor: '#00FF00'},
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
    assert.deepStrictEqual(op.theme, {primaryColor: '#00FF00'});
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
        theme: {dark: true},
      },
    };

    const adapter = VersionAdapterFactory.resolveFromPayload(payload);
    assert.strictEqual(adapter.version, 'v0.8');

    const ops = adapter.extractOperations(payload);
    assert.strictEqual(ops.length, 1);
    const op = ops[0] as InternalCreateSurfaceOp;
    assert.strictEqual(op.type, 'createSurface');
    assert.strictEqual(op.surfaceId, 's1');
    assert.deepStrictEqual(op.theme, {dark: true});
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
        components: [
          {id: 't1', component: 'Text', text: 'Hello', color: 'red'},
        ],
      },
    });

    processor.processMessages({
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [
          {id: 't1', color: 'blue'},
        ],
      },
    });

    const surface = processor.getSurface('s1');
    const comp = surface?.componentsModel.get('t1');
    assert.strictEqual(comp?.properties.text, 'Hello');
    assert.strictEqual(comp?.properties.color, 'blue');
  });
});
