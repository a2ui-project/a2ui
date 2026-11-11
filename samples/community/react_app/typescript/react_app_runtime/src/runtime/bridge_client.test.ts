/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {afterEach, describe, expect, it, vi} from 'vitest';
import {BridgeClient, BridgeError, BridgeErrorCode} from './bridge_client.js';
import {FakeHost, flush} from './testing/fake_host.js';

describe('BridgeClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends JSON-RPC requests with increasing ids and resolves with the result', async () => {
    const host = new FakeHost();
    host.handlers.set('data/get', params => ({result: {value: `value of ${params['path']}`}}));
    const client = host.createClient();

    const first = client.request('data/get', {path: '/a'});
    const second = client.request('data/get', {path: '/b'});

    await expect(first).resolves.toEqual({value: 'value of /a'});
    await expect(second).resolves.toEqual({value: 'value of /b'});
    expect(host.received.map(message => message.id)).toEqual([1, 2]);
    expect(host.received[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'data/get',
      params: {path: '/a'},
    });
  });

  it('matches out-of-order responses to their requests', async () => {
    const host = new FakeHost();
    host.holdReplies = true;
    host.handlers.set('function/call', params => ({result: {value: params['name']}}));
    const client = host.createClient();

    const slow = client.request('function/call', {name: 'slow'});
    const fast = client.request('function/call', {name: 'fast'});
    host.releaseReplies([1, 0]);

    await expect(fast).resolves.toEqual({value: 'fast'});
    await expect(slow).resolves.toEqual({value: 'slow'});
  });

  it('rejects with a BridgeError carrying the code and data of an error response', async () => {
    const host = new FakeHost();
    host.handlers.set('data/set', () => ({
      error: {code: BridgeErrorCode.PathNotAllowed, message: 'Path /x is not allowed'},
    }));
    const client = host.createClient();

    const error = await client.request('data/set', {path: '/x'}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).code).toBe(BridgeErrorCode.PathNotAllowed);
    expect((error as BridgeError).message).toBe('Path /x is not allowed');
  });

  it('times out, and ignores a response that arrives after the timeout', async () => {
    vi.useFakeTimers();
    const host = new FakeHost();
    host.holdReplies = true;
    host.handlers.set('data/get', () => ({result: {value: 1}}));
    const client = host.createClient();

    const request = client.request('data/get', {path: '/a'}, 50);
    const settled = request.catch((e: unknown) => e);
    vi.advanceTimersByTime(51);
    const error = await settled;
    host.releaseReplies();

    expect((error as BridgeError).code).toBe(BridgeErrorCode.Timeout);
  });

  it('delivers notifications to the handler of their method', async () => {
    const host = new FakeHost();
    const client = host.createClient();
    const changes: unknown[] = [];
    client.onNotification('data/changed', params => changes.push(params));

    host.notify('data/changed', {path: '/a', value: 2});
    host.notify('theme/changed', {colorScheme: 'dark'});

    expect(changes).toEqual([{path: '/a', value: 2}]);
  });

  it('ignores messages from other windows and messages that are not JSON-RPC 2.0', async () => {
    const host = new FakeHost();
    const client = host.createClient();
    const changes: unknown[] = [];
    client.onNotification('data/changed', params => changes.push(params));

    const foreign = new Event('message');
    Object.defineProperty(foreign, 'data', {
      value: {jsonrpc: '2.0', method: 'data/changed', params: {path: '/a'}},
    });
    Object.defineProperty(foreign, 'source', {value: {}});
    host.events.dispatchEvent(foreign);
    const handshake = new Event('message');
    Object.defineProperty(handshake, 'data', {value: {type: 'sandbox-init'}});
    Object.defineProperty(handshake, 'source', {value: host});
    host.events.dispatchEvent(handshake);

    expect(changes).toEqual([]);
  });

  it('answers a request from the host with method not found', async () => {
    const host = new FakeHost();
    host.createClient();
    const request = new Event('message');
    Object.defineProperty(request, 'data', {value: {jsonrpc: '2.0', id: 9, method: 'app/eval'}});
    Object.defineProperty(request, 'source', {value: host});

    host.events.dispatchEvent(request);
    await flush();

    expect(host.received).toContainEqual({
      jsonrpc: '2.0',
      id: 9,
      error: {code: BridgeErrorCode.MethodNotFound, message: 'Unknown method app/eval'},
    });
  });

  it('fails pending requests on dispose', async () => {
    const host = new FakeHost();
    host.holdReplies = true;
    host.handlers.set('data/get', () => ({result: {}}));
    const client: BridgeClient = host.createClient();

    const pending = client.request('data/get', {path: '/a'}).catch((e: unknown) => e);
    client.dispose();

    expect(((await pending) as BridgeError).code).toBe(BridgeErrorCode.InternalError);
  });
});
