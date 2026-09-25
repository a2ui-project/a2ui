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

/**
 * These tests connect the bridge to a real `App` from the MCP Apps App SDK over an in-memory
 * transport pair, so both ends run the real protocol; only the frame boundary is left out.
 */

import {App} from '@modelcontextprotocol/ext-apps';
import type {Protocol} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ErrorCode,
  McpError,
  type JSONRPCMessage,
  type Notification,
  type Request,
  type Result,
} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {FakeFrameHost} from '../shared/sandbox/testing/fake_frame_host.js';
import {
  DATA_MODEL_CHANGE_METHOD,
  DATA_MODEL_UPDATE_METHOD,
  DEFAULT_MCP_APP_HOST_INFO,
  FUNCTION_CALL_METHOD,
  McpAppBridge,
  type McpAppBridgeProps,
} from './mcp_app_bridge.js';

const DataModelUpdateNotificationSchema = z.object({
  method: z.literal(DATA_MODEL_UPDATE_METHOD),
  params: z.object({key: z.string(), subpath: z.string().optional(), value: z.unknown()}),
});

const FunctionCallResultSchema = z
  .object({status: z.literal('success'), result: z.unknown()})
  .passthrough();

/** One end of an in-memory JSON-RPC channel; messages reach the other end asynchronously. */
class LinkedTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  peer!: LinkedTransport;
  readonly sent: JSONRPCMessage[] = [];
  closed = false;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
    const peer = this.peer;
    setTimeout(() => {
      if (!peer.closed) {
        peer.onmessage?.(structuredClone(message));
      }
    }, 0);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.onclose?.();
  }
}

function linkTransports(): [LinkedTransport, LinkedTransport] {
  const host = new LinkedTransport();
  const app = new LinkedTransport();
  host.peer = app;
  app.peer = host;
  return [host, app];
}

/** The app side of a connected bridge. */
interface ConnectedApp {
  readonly app: App;
  /** The protocol underneath, which sends the A2UI extension methods the App types leave out. */
  readonly protocol: Pick<Protocol<Request, Notification, Result>, 'request' | 'notification'>;
  /** The `data-model-update` params received so far. */
  readonly updates: Array<Record<string, unknown>>;
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400 && !predicate(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(predicate()).withContext(what).toBeTrue();
}

/** Gives queued messages a chance to arrive when nothing is expected. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('McpAppBridge', () => {
  let container: HTMLDivElement;
  let frame: HTMLIFrameElement;
  let host: FakeFrameHost;
  let props: McpAppBridgeProps;
  let hostTransport: LinkedTransport;
  let appTransport: LinkedTransport;
  let onSizeChange: jasmine.Spy;
  let warn: jasmine.Spy;
  let bridge: McpAppBridge;
  let connected: ConnectedApp | null;

  beforeEach(() => {
    container = document.createElement('div');
    frame = document.createElement('iframe');
    frame.style.width = '300px';
    frame.style.height = '150px';
    frame.style.border = '0';
    container.appendChild(frame);
    document.body.appendChild(container);

    host = new FakeFrameHost({game: {score: 1, player: 'ann'}, title: 'Pong'});
    host.functions.set('double', args => (args['n'] as number) * 2);
    host.functions.set('fail', () => {
      throw new Error('boom');
    });

    props = {
      allowedTools: ['submit'],
      allowedFunctions: {
        double: {type: 'object', properties: {n: {type: 'number'}}, required: ['n']},
        fail: {},
      },
      dataPaths: {game: '/game', title: '/title'},
    };

    [hostTransport, appTransport] = linkTransports();
    onSizeChange = jasmine.createSpy('onSizeChange');
    warn = spyOn(console, 'warn');
    connected = null;
    bridge = new McpAppBridge({
      frame,
      host,
      getProps: () => props,
      onSizeChange,
      transport: hostTransport,
    });
    bridge.start();
  });

  afterEach(async () => {
    bridge.dispose();
    await connected?.app.close();
    container.remove();
  });

  /** Connects a real App SDK client: the `ui/initialize` handshake runs against the bridge. */
  async function connectApp(): Promise<ConnectedApp> {
    const app = new App({name: 'Test app', version: '1.0.0'}, {}, {autoResize: false});
    const updates: Array<Record<string, unknown>> = [];
    app.setNotificationHandler(DataModelUpdateNotificationSchema, notification => {
      updates.push(notification.params);
    });
    await app.connect(appTransport);
    connected = {app, protocol: app, updates};
    return connected;
  }

  describe('handshake', () => {
    it('answers ui/initialize with the host info, capabilities and the frame size', async () => {
      const {app} = await connectApp();

      expect(app.getHostVersion()).toEqual(DEFAULT_MCP_APP_HOST_INFO);
      expect(app.getHostCapabilities()).toEqual({openLinks: {}, logging: {}, serverTools: {}});
      expect(app.getHostContext()).toEqual({containerDimensions: {width: 300, height: 150}});
    });

    it('announces the host info given in the options', async () => {
      bridge.dispose();
      [hostTransport, appTransport] = linkTransports();
      bridge = new McpAppBridge({
        frame,
        host,
        getProps: () => props,
        hostInfo: {name: 'Custom host', version: '2.0.0'},
        transport: hostTransport,
      });
      bridge.start();

      const {app} = await connectApp();

      expect(app.getHostVersion()).toEqual({name: 'Custom host', version: '2.0.0'});
    });

    it('sends the value of every bound path once the app is initialized', async () => {
      const {updates} = await connectApp();

      await waitFor(() => updates.length === 2, 'initial updates received');
      expect(updates).toEqual([
        {key: 'game', value: {score: 1, player: 'ann'}},
        {key: 'title', value: 'Pong'},
      ]);
    });

    it('starts once', async () => {
      bridge.start();
      const {updates} = await connectApp();

      await waitFor(() => updates.length === 2, 'initial updates received');
      await settle();
      expect(updates.length).toBe(2);
      expect(host.subscriberCount).toBe(2);
    });
  });

  describe('tool calls', () => {
    it('dispatches an allowed tool call as an action and answers at once', async () => {
      const {app} = await connectApp();

      const result = await app.callServerTool({name: 'submit', arguments: {value: 1}});

      expect(result).toEqual({content: []});
      expect(host.actions).toEqual([{name: 'submit', context: {value: 1}}]);
    });

    it('dispatches a call without arguments with an empty context', async () => {
      const {app} = await connectApp();

      await app.callServerTool({name: 'submit'});

      expect(host.actions).toEqual([{name: 'submit', context: {}}]);
    });

    it('rejects a tool that is not listed', async () => {
      const {app} = await connectApp();

      await expectAsync(app.callServerTool({name: 'reset'})).toBeRejectedWithError(
        McpError,
        /Tool 'reset' is not allowed/,
      );

      expect(host.actions).toEqual([]);
      expect(warn.calls.mostRecent().args[0]).toContain('not in allowedTools');
    });

    it('answers a rejected call with the invalid params error code', async () => {
      const {app} = await connectApp();

      const error = await app.callServerTool({name: 'reset'}).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
    });

    it('rejects arguments that exceed the payload limits', async () => {
      const {app} = await connectApp();
      let deep: Record<string, unknown> = {};
      for (let level = 0; level < 12; level++) {
        deep = {inner: deep};
      }

      await expectAsync(
        app.callServerTool({name: 'submit', arguments: {padding: 'x'.repeat(70_000)}}),
      ).toBeRejectedWithError(McpError, /arguments rejected/);
      await expectAsync(
        app.callServerTool({name: 'submit', arguments: deep}),
      ).toBeRejectedWithError(McpError, /arguments rejected/);

      expect(host.actions).toEqual([]);
    });

    it('never passes a prototype pollution key on to the action', async () => {
      const {app} = await connectApp();
      const polluted = JSON.parse('{"value":1,"__proto__":{"admin":true}}') as Record<
        string,
        unknown
      >;
      expect(Object.getOwnPropertyNames(polluted)).toEqual(['value', '__proto__']);

      // The SDK's request schema strips the key before the bridge sees the call.
      await app.callServerTool({name: 'submit', arguments: polluted});

      expect(host.actions.length).toBe(1);
      const context = host.actions[0].context;
      expect(Object.getOwnPropertyNames(context)).toEqual(['value']);
      expect(Object.getPrototypeOf(context)).toBe(Object.prototype);
    });

    it('reads the allowlist on every call, so a property change applies at once', async () => {
      const {app} = await connectApp();

      props = {...props, allowedTools: ['reset']};
      await app.callServerTool({name: 'reset'});

      expect(host.actions).toEqual([{name: 'reset', context: {}}]);
    });
  });

  describe('data model', () => {
    let app: ConnectedApp;

    beforeEach(async () => {
      app = await connectApp();
      await waitFor(() => app.updates.length === 2, 'initial updates received');
    });

    it('pushes host changes to the app as updates', async () => {
      host.setData('/game/score', 7);
      host.setData('/title', 'Tennis');

      await waitFor(() => app.updates.length === 4, 'two more updates received');
      expect(app.updates.slice(2)).toEqual([
        {key: 'game', subpath: '/score', value: 7},
        {key: 'title', value: 'Tennis'},
      ]);
    });

    it('writes a change from the app without echoing it', async () => {
      await app.protocol.notification({
        method: DATA_MODEL_CHANGE_METHOD,
        params: {key: 'game', subpath: '/score', value: 9},
      });
      await waitFor(() => host.getData('/game/score') === 9, 'score written');

      await app.protocol.notification({
        method: DATA_MODEL_CHANGE_METHOD,
        params: {key: 'game', value: {score: 10, player: 'bob'}},
      });
      await waitFor(() => host.getData('/game/player') === 'bob', 'whole value written');

      await settle();
      expect(app.updates.length).toBe(2);
    });

    it('drops changes to keys that are not bound', async () => {
      await app.protocol.notification({
        method: DATA_MODEL_CHANGE_METHOD,
        params: {key: 'loose', value: 1},
      });

      await waitFor(() => warn.calls.count() === 1, 'warning logged');
      expect(warn.calls.mostRecent().args[0]).toContain('key not in data.paths');
      expect(host.getData('/loose')).toBeUndefined();
    });

    it('refuses subpaths with prototype pollution segments', async () => {
      await app.protocol.notification({
        method: DATA_MODEL_CHANGE_METHOD,
        params: {key: 'game', subpath: '/__proto__', value: {admin: true}},
      });

      await waitFor(() => warn.calls.count() === 1, 'warning logged');
      expect(warn.calls.mostRecent().args[0]).toContain('forbidden subpath');
      expect(host.getData('/game')).toEqual({score: 1, player: 'ann'});
    });

    it('drops values that fail the security check', async () => {
      await app.protocol.notification({
        method: DATA_MODEL_CHANGE_METHOD,
        params: {key: 'game', value: JSON.parse('{"score":2,"__proto__":{"admin":true}}')},
      });

      await waitFor(() => warn.calls.count() === 1, 'warning logged');
      expect(warn.calls.mostRecent().args[0]).toContain('rejected');
      expect(host.getData('/game')).toEqual({score: 1, player: 'ann'});
    });
  });

  describe('function calls', () => {
    let app: ConnectedApp;

    function callFunction(call: string, args?: Record<string, unknown>) {
      return app.protocol.request(
        {method: FUNCTION_CALL_METHOD, params: {call, args}},
        FunctionCallResultSchema,
      );
    }

    beforeEach(async () => {
      app = await connectApp();
    });

    it('answers a listed function call with its result', async () => {
      const response = await callFunction('double', {n: 21});

      expect(response).toEqual({status: 'success', result: 42});
      expect(host.functionCalls).toEqual([{name: 'double', args: {n: 21}}]);
    });

    it('rejects a function that is not listed', async () => {
      const error = await callFunction('secret').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
      expect((error as McpError).message).toContain("Function 'secret' is not allowed");
      expect(host.functionCalls).toEqual([]);
    });

    it('rejects arguments that fail the schema and lists the errors', async () => {
      const error = await callFunction('double', {n: 'x'}).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
      expect((error as McpError).message).toContain('failed schema validation');
      expect((error as McpError).data).toEqual({errors: [jasmine.stringContaining('number')]});
      expect(host.functionCalls).toEqual([]);
    });

    it('reports an execution error as an internal error', async () => {
      const error = await callFunction('fail').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(ErrorCode.InternalError);
      expect((error as McpError).message).toContain('boom');
    });
  });

  describe('sizing, host context and logging', () => {
    it('forwards size requests from the app', async () => {
      const {app} = await connectApp();

      await app.sendSizeChanged({height: 400});

      await waitFor(() => onSizeChange.calls.count() === 1, 'size request forwarded');
      expect(onSizeChange).toHaveBeenCalledWith(undefined, 400);
    });

    it('reports container size changes to the app', async () => {
      const {app} = await connectApp();
      const changes: Array<Record<string, unknown>> = [];
      app.onhostcontextchanged = params => {
        changes.push(params);
      };

      frame.style.width = '360px';

      await waitFor(
        () =>
          changes.some(
            change => (change['containerDimensions'] as {width: number} | undefined)?.width === 360,
          ),
        'host context change received',
      );
    });

    it('logs the messages the app sends', async () => {
      const {app} = await connectApp();
      const log = spyOn(console, 'log');
      const error = spyOn(console, 'error');

      await app.sendLog({level: 'info', data: 'hello'});
      await app.sendLog({level: 'error', data: 'broken'});

      await waitFor(() => error.calls.count() === 1, 'error logged');
      expect(log).toHaveBeenCalledWith('[McpApp] App log (info):', 'hello');
      expect(error).toHaveBeenCalledWith('[McpApp] App log (error):', 'broken');
    });
  });

  describe('dispose', () => {
    it('closes the transport and releases the subscriptions', async () => {
      const {updates} = await connectApp();
      await waitFor(() => updates.length === 2, 'initial updates received');

      bridge.dispose();

      expect(hostTransport.closed).toBeTrue();
      expect(host.subscriberCount).toBe(0);
      host.setData('/title', 'Tennis');
      await settle();
      expect(updates.length).toBe(2);
    });
  });
});
