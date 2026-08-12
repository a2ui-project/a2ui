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
import assert from 'node:assert/strict';
import {A2uiProtocolVersion} from '../../schema/index.js';
import {VersionAdapterFactory} from './factory.js';
import {VersionAdapterV09} from './v0_9.js';
import {VersionAdapterV10} from './v1_0.js';

describe('VersionAdapterFactory', () => {
  it('resolves v0.9 adapter for v0.8, v0.9, and v0.9.1', () => {
    const adapter08 = VersionAdapterFactory.getAdapter(A2uiProtocolVersion.V0_8);
    const adapter09 = VersionAdapterFactory.getAdapter(A2uiProtocolVersion.V0_9);
    const adapter091 = VersionAdapterFactory.getAdapter(A2uiProtocolVersion.V0_9_1);

    assert.equal(adapter08 instanceof VersionAdapterV09, true);
    assert.equal(adapter09 instanceof VersionAdapterV09, true);
    assert.equal(adapter091 instanceof VersionAdapterV09, true);
  });

  it('resolves v1.0 adapter for v1.0', () => {
    const adapter10 = VersionAdapterFactory.getAdapter(A2uiProtocolVersion.V1_0);
    assert.equal(adapter10 instanceof VersionAdapterV10, true);

    const adapterStr = VersionAdapterFactory.getAdapter('v1.0');
    assert.equal(adapterStr instanceof VersionAdapterV10, true);
  });

  it('throws error for unsupported versions', () => {
    assert.throws(() => VersionAdapterFactory.getAdapter('v99.0'), {
      message: /Unsupported A2UI protocol version: v99.0/,
    });
  });

  it('resolves adapter from message using getAdapterForMessage', () => {
    const msgV10 = {
      version: 'v1.0',
      deleteSurface: {surfaceId: 'surf_1'},
    } as any;
    const adapter = VersionAdapterFactory.getAdapterForMessage(msgV10);
    assert.equal(adapter.version, A2uiProtocolVersion.V1_0);
  });
});

describe('VersionAdapterV09', () => {
  const adapter = new VersionAdapterV09();

  it('extracts surface properties from createSurface message', () => {
    const msg = {
      version: 'v0.9',
      createSurface: {
        surfaceId: 's1',
        catalogId: 'cat1',
        theme: {color: 'blue'},
        sendDataModel: true,
      },
    } as any;

    const props = adapter.extractSurfaceProperties(msg);
    assert.deepEqual(props, {
      surfaceId: 's1',
      catalogId: 'cat1',
      theme: {color: 'blue'},
      sendDataModel: true,
    });
    assert.equal(adapter.extractMessageType(msg), 'createSurface');
  });

  it('extracts initial state from updateComponents message', () => {
    const msg = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's1',
        components: [{component: 'Text', id: 'c1'}],
      },
    } as any;

    const state = adapter.extractInitialState(msg);
    assert.deepEqual(state, {
      components: [{component: 'Text', id: 'c1'}],
    });
    assert.equal(adapter.extractMessageType(msg), 'updateComponents');
  });

  it('extracts initial state from updateDataModel message', () => {
    const msg = {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 's1',
        path: '/user/name',
        value: 'Bob',
      },
    } as any;

    const state = adapter.extractInitialState(msg);
    assert.deepEqual(state, {
      dataModel: {'/user/name': 'Bob'},
    });
    assert.equal(adapter.extractMessageType(msg), 'updateDataModel');
  });
});

describe('VersionAdapterV10', () => {
  const adapter = new VersionAdapterV10();

  it('extracts surface properties and initial state from v1.0 createSurface message', () => {
    const msg = {
      version: 'v1.0',
      createSurface: {
        surfaceId: 's_v10',
        catalogId: 'cat_v10',
        sendDataModel: true,
        components: [{component: 'Header', id: 'root'}],
        dataModel: {app: {title: 'App'}},
        metadata: {extensions: {ext1: true}},
      },
    } as any;

    const props = adapter.extractSurfaceProperties(msg);
    assert.deepEqual(props, {
      surfaceId: 's_v10',
      catalogId: 'cat_v10',
      sendDataModel: true,
      metadata: {extensions: {ext1: true}},
    });

    const state = adapter.extractInitialState(msg);
    assert.deepEqual(state, {
      components: [{component: 'Header', id: 'root'}],
      dataModel: {app: {title: 'App'}},
    });

    assert.equal(adapter.extractMessageType(msg), 'createSurface');
  });

  it('extracts message types for v1.0 function invocation messages', () => {
    const callMsg = {
      version: 'v1.0',
      callRendererFunction: {
        functionCallId: 'fn_1',
        callFunction: {call: 'ping'},
      },
    } as any;
    assert.equal(adapter.extractMessageType(callMsg), 'callRendererFunction');

    const respMsg = {
      version: 'v1.0',
      agentFunctionResponse: {
        functionCallId: 'fn_1',
        value: 'pong',
      },
    } as any;
    assert.equal(adapter.extractMessageType(respMsg), 'agentFunctionResponse');
  });

  it('normalizes v1.0 messages as identity', () => {
    const msg = {
      version: 'v1.0',
      deleteSurface: {surfaceId: 's1'},
    } as any;
    assert.equal(adapter.normalizeMessage(msg), msg);
  });
});
