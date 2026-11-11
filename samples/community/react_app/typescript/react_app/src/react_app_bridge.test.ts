/*
 * Copyright 2026 Google LLC
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

import {
  MAX_ACTIONS_PER_SECOND,
  ReactAppBridge,
  ReactAppErrorCode,
  type ReactAppBridgeEvent,
  type ReactAppBridgeProps,
  type ReactAppBridgeTransport,
} from './react_app_bridge.js';
import {FakeFrameHost} from './shared/sandbox/testing/fake_frame_host.js';

/** A transport the test drives: `fromApp` delivers a message, `sent` records the replies. */
class MemoryTransport implements ReactAppBridgeTransport {
  readonly sent: Array<Record<string, unknown>> = [];
  private handler: ((message: unknown) => void) | null = null;

  send(message: Readonly<Record<string, unknown>>): void {
    this.sent.push(structuredClone(message) as Record<string, unknown>);
  }

  listen(handler: (message: unknown) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }

  fromApp(message: unknown): void {
    this.handler?.(message);
  }

  /** Sends a request and waits for its response. */
  async request(id: number, method: string, params: Record<string, unknown> = {}) {
    this.fromApp({jsonrpc: '2.0', id, method, params});
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = this.sent.find(message => message['id'] === id);
      if (response) {
        return response;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    throw new Error(`No response to ${method}`);
  }

  notifications(method: string) {
    return this.sent.filter(message => message['method'] === method && message['id'] === undefined);
  }
}

const THEME = {colorScheme: 'light' as const, cssVars: {'--a2ui-color-primary': '#c8553d'}};

describe('ReactAppBridge', () => {
  let transport: MemoryTransport;
  let host: FakeFrameHost;
  let props: ReactAppBridgeProps;
  let events: ReactAppBridgeEvent[];
  let bridge: ReactAppBridge;
  let clock: number;
  let userActive: boolean;

  function createBridge(onResize?: (height: number) => void): ReactAppBridge {
    return new ReactAppBridge({
      transport,
      frameId: 'plan/app',
      host,
      getProps: () => props,
      getTheme: () => THEME,
      getContainerSize: () => ({width: 640, height: 360}),
      ...(onResize ? {onResize} : {}),
      onEvent: event => events.push(event),
      now: () => clock,
      hasUserActivation: () => userActive,
    });
  }

  function denials() {
    return events.filter(event => event.type === 'denied');
  }

  beforeEach(() => {
    transport = new MemoryTransport();
    host = new FakeFrameHost({loan: {rate: 5, principal: 250000}, other: {secret: 1}});
    props = {dataPaths: ['/loan', '/nothing']};
    events = [];
    clock = 100;
    userActive = true;
    bridge = createBridge();
    bridge.start();
  });

  afterEach(() => {
    bridge.dispose();
  });

  async function initialize(paths: string[] = []) {
    return transport.request(1, 'reactApp/initialize', {
      protocolVersion: '1',
      runtimeVersion: '0.1.0',
      paths,
    });
  }

  it('answers initialize with the theme, size and a snapshot of the allowed requested paths', async () => {
    props = {dataPaths: ['/loan']};

    const response = await initialize(['/loan/rate', '/loan/missing', '/other/secret']);

    expect(response['result']).toEqual({
      protocolVersion: '1',
      theme: THEME,
      containerSize: {width: 640, height: 360},
      dataSnapshot: {'/loan/rate': 5},
      deniedPaths: ['/other/secret'],
    });
    expect(host.subscriberCount).toBe(2);
  });

  it('rejects requests before initialize, and a protocol version it does not speak', async () => {
    const early = await transport.request(1, 'data/get', {path: '/loan/rate'});
    const wrongVersion = await transport.request(2, 'reactApp/initialize', {protocolVersion: '2'});

    expect((early['error'] as {code: number}).code).toBe(ReactAppErrorCode.NotInitialized);
    expect((wrongVersion['error'] as {code: number}).code).toBe(ReactAppErrorCode.InvalidParams);
  });

  it('pushes data/changed for subscribed paths when the data model changes', async () => {
    await initialize(['/loan/rate']);

    host.setData('/loan/rate', 7);
    host.setData('/loan/rate', 7);
    host.setData('/loan', {rate: 8, principal: 1});

    expect(transport.notifications('data/changed').map(m => m['params'])).toEqual([
      {path: '/loan/rate', value: 7},
      {path: '/loan/rate', value: 8},
    ]);
  });

  it('writes data/set to the host, acks with the new value and suppresses the echo', async () => {
    await initialize(['/loan/rate']);
    await transport.request(2, 'data/subscribe', {path: '/loan'});

    const response = await transport.request(3, 'data/set', {path: '/loan/rate', value: 6, seq: 1});

    expect(response['result']).toEqual({seq: 1, value: 6});
    expect(host.getData('/loan/rate')).toBe(6);
    // The written path gets no echo; the subscribed parent changed for another reason and does.
    expect(transport.notifications('data/changed').map(m => m['params'])).toEqual([
      {path: '/loan', value: {rate: 6, principal: 250000}},
    ]);
  });

  it('enforces dataPaths on every data method and rejects forbidden segments', async () => {
    props = {dataPaths: ['/loan']};
    await initialize();

    const get = await transport.request(2, 'data/get', {path: '/other/secret'});
    const set = await transport.request(3, 'data/set', {path: '/loans', value: 1, seq: 1});
    const polluted = await transport.request(4, 'data/set', {
      path: '/loan/__proto__/x',
      value: 1,
      seq: 2,
    });
    const allowed = await transport.request(5, 'data/get', {path: '/loan/principal'});

    expect((get['error'] as {code: number}).code).toBe(ReactAppErrorCode.PathNotAllowed);
    expect((set['error'] as {code: number}).code).toBe(ReactAppErrorCode.PathNotAllowed);
    expect((polluted['error'] as {code: number}).code).toBe(ReactAppErrorCode.InvalidParams);
    expect(allowed['result']).toEqual({value: 250000});
  });

  it('answers data/get without a value for an empty path, and unsubscribes', async () => {
    await initialize();
    const empty = await transport.request(2, 'data/get', {path: '/nothing'});
    await transport.request(3, 'data/subscribe', {path: '/loan/rate'});
    await transport.request(4, 'data/unsubscribe', {path: '/loan/rate'});

    host.setData('/loan/rate', 9);

    expect(empty['result']).toEqual({});
    expect(transport.notifications('data/changed')).toEqual([]);
  });

  it('calls functions, awaiting promises, and enforces the functions allowlist', async () => {
    host.functions.set('formatCurrency', args => `$${args['value'] as number}`);
    host.functions.set('estimateTravelTime', () => Promise.resolve(74));
    host.functions.set('explode', () => {
      throw new Error('boom');
    });
    props = {functions: ['formatCurrency', 'estimateTravelTime', 'explode']};
    await initialize();

    const local = await transport.request(2, 'function/call', {
      name: 'formatCurrency',
      args: {value: 5},
    });
    const remote = await transport.request(3, 'function/call', {
      name: 'estimateTravelTime',
      args: {},
    });
    const failed = await transport.request(4, 'function/call', {name: 'explode', args: {}});
    const refused = await transport.request(5, 'function/call', {
      name: 'deleteEverything',
      args: {},
    });

    expect(local['result']).toEqual({value: '$5'});
    expect(remote['result']).toEqual({value: 74});
    expect(failed['error']).toEqual({
      code: ReactAppErrorCode.FunctionFailed,
      message: 'boom',
      data: {name: 'explode'},
    });
    expect((refused['error'] as {code: number}).code).toBe(ReactAppErrorCode.FunctionNotAllowed);
    expect(host.functionCalls.map(call => call.name)).toEqual([
      'formatCurrency',
      'estimateTravelTime',
      'explode',
    ]);
  });

  it('dispatches listed actions during a user gesture', async () => {
    props = {actions: ['confirmItinerary']};
    await initialize();

    const response = await transport.request(2, 'action/dispatch', {
      name: 'confirmItinerary',
      context: {stops: ['a']},
    });

    expect(response['result']).toEqual({});
    expect(host.actions).toEqual([{name: 'confirmItinerary', context: {stops: ['a']}}]);
    expect(denials()).toEqual([]);
  });

  it('refuses an action without a user gesture, and reports it as denied', async () => {
    props = {actions: ['confirmItinerary']};
    userActive = false;
    await initialize();

    const response = await transport.request(2, 'action/dispatch', {
      name: 'confirmItinerary',
      context: {},
    });

    expect(response['error']).toEqual({
      code: ReactAppErrorCode.ActionNeedsUserGesture,
      message: jasmine.stringContaining('needs a user gesture'),
      data: {name: 'confirmItinerary'},
    });
    expect(host.actions).toEqual([]);
    expect(denials()).toEqual([
      jasmine.objectContaining({
        type: 'denied',
        frameId: 'plan/app',
        reason: 'userGesture',
        method: 'action/dispatch',
        target: 'confirmItinerary',
        code: ReactAppErrorCode.ActionNeedsUserGesture,
      }),
    ]);
  });

  it('refuses an action outside actions before it checks the gesture', async () => {
    props = {actions: ['confirmItinerary']};
    userActive = false;
    await initialize();

    const response = await transport.request(2, 'action/dispatch', {name: 'bookFlight'});

    expect((response['error'] as {code: number}).code).toBe(ReactAppErrorCode.ActionNotAllowed);
    expect(denials().map(event => event.type === 'denied' && event.reason)).toEqual(['action']);
  });

  it('accepts at most MAX_ACTIONS_PER_SECOND actions per second', async () => {
    props = {actions: ['tick']};
    await initialize();

    const codes: Array<number | undefined> = [];
    for (let id = 2; id < 2 + MAX_ACTIONS_PER_SECOND + 1; id++) {
      const response = await transport.request(id, 'action/dispatch', {name: 'tick'});
      codes.push((response['error'] as {code: number} | undefined)?.code);
    }
    clock += 1000;
    const later = await transport.request(20, 'action/dispatch', {name: 'tick'});

    expect(codes).toEqual([
      ...Array<undefined>(MAX_ACTIONS_PER_SECOND).fill(undefined),
      ReactAppErrorCode.TooManyRequests,
    ]);
    expect(later['result']).toEqual({});
    expect(host.actions.length).toBe(MAX_ACTIONS_PER_SECOND + 1);
    expect(denials().map(event => event.type === 'denied' && event.reason)).toEqual(['rateLimit']);
  });

  it('denies every path, function and action when the allowlists are absent', async () => {
    props = {};
    host.functions.set('formatCurrency', () => '$1');

    const init = await initialize(['/loan/rate']);
    const get = await transport.request(2, 'data/get', {path: '/loan/rate'});
    const call = await transport.request(3, 'function/call', {name: 'formatCurrency', args: {}});
    const action = await transport.request(4, 'action/dispatch', {name: 'confirmItinerary'});

    expect((init['result'] as {deniedPaths: string[]}).deniedPaths).toEqual(['/loan/rate']);
    expect((get['error'] as {code: number}).code).toBe(ReactAppErrorCode.PathNotAllowed);
    expect((call['error'] as {code: number}).code).toBe(ReactAppErrorCode.FunctionNotAllowed);
    expect((action['error'] as {code: number}).code).toBe(ReactAppErrorCode.ActionNotAllowed);
    expect(host.functionCalls).toEqual([]);
    expect(host.actions).toEqual([]);
    expect(
      denials().map(event => event.type === 'denied' && [event.reason, event.method, event.target]),
    ).toEqual([
      ['path', 'reactApp/initialize', '/loan/rate'],
      ['path', 'data/get', '/loan/rate'],
      ['function', 'function/call', 'formatCurrency'],
      ['action', 'action/dispatch', 'confirmItinerary'],
    ]);
  });

  it('rejects oversized or polluted messages with payload rejected', async () => {
    await initialize();

    const big = await transport.request(2, 'data/set', {
      path: '/loan/rate',
      value: 'x'.repeat(70 * 1024),
      seq: 1,
    });
    const polluted = JSON.parse(
      '{"jsonrpc":"2.0","id":3,"method":"action/dispatch","params":{"name":"a","context":{"__proto__":{"x":1}}}}',
    );
    transport.fromApp(polluted);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect((big['error'] as {code: number}).code).toBe(ReactAppErrorCode.PayloadRejected);
    expect((transport.sent.find(m => m['id'] === 3)?.['error'] as {code: number}).code).toBe(
      ReactAppErrorCode.PayloadRejected,
    );
    expect(host.actions).toEqual([]);
    expect(denials().map(event => event.type === 'denied' && [event.reason, event.code])).toEqual([
      ['payload', ReactAppErrorCode.PayloadRejected],
      ['payload', ReactAppErrorCode.PayloadRejected],
    ]);
  });

  it('measures proxy ready to ui/rendered, and reports errors, logs and resizes', async () => {
    const resizes: number[] = [];
    bridge.dispose();
    bridge = createBridge(height => resizes.push(height));
    bridge.start();

    clock = 1000;
    transport.fromApp({type: 'a2ui_sandbox_proxy_ready'});
    clock = 1180;
    transport.fromApp({
      jsonrpc: '2.0',
      method: 'ui/rendered',
      params: {timings: {rendered: 83, transpileMs: 4}},
    });
    transport.fromApp({
      jsonrpc: '2.0',
      method: 'ui/error',
      params: {phase: 'compile', message: 'Unexpected token', line: 3},
    });
    transport.fromApp({jsonrpc: '2.0', method: 'ui/log', params: {level: 'info', args: ['hi']}});
    transport.fromApp({jsonrpc: '2.0', method: 'ui/resize', params: {height: 512}});

    expect(events.filter(e => e.type !== 'message')).toEqual([
      {type: 'ready', time: 1000, frameId: 'plan/app'},
      {
        type: 'rendered',
        timings: {rendered: 83, transpileMs: 4},
        frameReadyToRenderedMs: 180,
        frameId: 'plan/app',
      },
      {
        type: 'error',
        error: {phase: 'compile', message: 'Unexpected token', line: 3},
        frameId: 'plan/app',
      },
      {type: 'log', level: 'info', args: ['hi'], frameId: 'plan/app'},
    ]);
    expect(events.every(event => event.frameId === 'plan/app')).toBeTrue();
    expect(resizes).toEqual([512]);
  });

  it('sends theme/changed once initialized, and stops answering after dispose', async () => {
    bridge.sendTheme(THEME);
    await initialize();
    bridge.sendTheme({colorScheme: 'dark', cssVars: {}});
    bridge.dispose();
    transport.fromApp({jsonrpc: '2.0', id: 9, method: 'data/get', params: {path: '/loan/rate'}});
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(transport.notifications('theme/changed').map(m => m['params'])).toEqual([
      {colorScheme: 'dark', cssVars: {}},
    ]);
    expect(transport.sent.some(m => m['id'] === 9)).toBeFalse();
    expect(host.subscriberCount).toBe(0);
  });

  it('answers unknown methods with method not found and ignores non JSON-RPC messages', async () => {
    await initialize();
    transport.fromApp({type: 'sandbox-init'});
    transport.fromApp('hello');

    const unknown = await transport.request(2, 'app/eval', {});

    expect((unknown['error'] as {code: number}).code).toBe(ReactAppErrorCode.MethodNotFound);
  });
});
