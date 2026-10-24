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

import {FakeFrameHost} from '../shared/sandbox/testing/fake_frame_host.js';
import {A2uiMessageType, type AppFrameInitMessage} from './messages.js';
import {WebAppFrameBridge, type WebAppFrameBridgeProps} from './web_app_frame_bridge.js';

const SANDBOX_ORIGIN = 'https://sandbox.example';

/** The app side of a channel opened by the bridge. */
interface ConnectedApp {
  readonly init: AppFrameInitMessage;
  readonly targetOrigin: string;
  readonly port: MessagePort;
  readonly received: Array<Record<string, unknown>>;
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400 && !predicate(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(predicate()).withContext(what).toBeTrue();
}

/** Gives queued port messages a chance to arrive when nothing is expected. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/**
 * The messages of one type the app received. Host context updates arrive at any time (the
 * `ResizeObserver` reports the initial size), so assertions pick the type they care about.
 */
function messagesOf(app: ConnectedApp, type: string): Array<Record<string, unknown>> {
  return app.received.filter(message => message['type'] === type);
}

describe('WebAppFrameBridge', () => {
  let container: HTMLDivElement;
  let frame: HTMLIFrameElement;
  let host: FakeFrameHost;
  let target: EventTarget;
  let props: WebAppFrameBridgeProps;
  let postMessage: jasmine.Spy;
  let onSandboxProxyReady: jasmine.Spy;
  let warn: jasmine.Spy;
  let bridge: WebAppFrameBridge;

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

    target = new EventTarget();
    props = {
      config: {theme: 'dark'},
      dataPaths: {game: '/game', title: '/title'},
      allowedEvents: {
        submit: {type: 'object', properties: {value: {type: 'number'}}, required: ['value']},
      },
      allowedFunctions: {
        double: {type: 'object', properties: {n: {type: 'number'}}, required: ['n']},
        fail: {},
      },
      mutableData: {
        game: {
          type: 'object',
          properties: {score: {type: 'number'}, player: {type: 'string'}},
          additionalProperties: false,
        },
      },
    };

    postMessage = spyOn(frame.contentWindow!, 'postMessage');
    onSandboxProxyReady = jasmine.createSpy('onSandboxProxyReady');
    warn = spyOn(console, 'warn');
    bridge = new WebAppFrameBridge({
      frame,
      host,
      sandboxOrigin: SANDBOX_ORIGIN,
      getProps: () => props,
      onSandboxProxyReady,
      messageTarget: target,
    });
    bridge.start();
  });

  afterEach(() => {
    bridge.dispose();
    container.remove();
  });

  function ambient(
    data: unknown,
    origin = SANDBOX_ORIGIN,
    source: Window | null = frame.contentWindow,
  ) {
    target.dispatchEvent(new MessageEvent('message', {data, origin, source}));
  }

  function connectApp(): ConnectedApp {
    ambient({type: A2uiMessageType.AppFrameReady});
    const [init, targetOrigin, transfer] = postMessage.calls.mostRecent().args as [
      AppFrameInitMessage,
      string,
      Transferable[],
    ];
    const port = transfer[0] as MessagePort;
    const received: Array<Record<string, unknown>> = [];
    port.onmessage = event => {
      received.push(event.data as Record<string, unknown>);
    };
    return {init, targetOrigin, port, received};
  }

  describe('handshake', () => {
    it('forwards the proxy ready signal from the frame only', () => {
      ambient({type: A2uiMessageType.SandboxProxyReady});
      expect(onSandboxProxyReady).toHaveBeenCalledTimes(1);

      ambient({type: A2uiMessageType.SandboxProxyReady}, 'https://evil.example');
      ambient({type: A2uiMessageType.SandboxProxyReady}, SANDBOX_ORIGIN, window);
      expect(onSandboxProxyReady).toHaveBeenCalledTimes(1);
    });

    it('registers its listener once even if started twice', () => {
      bridge.start();
      ambient({type: A2uiMessageType.SandboxProxyReady});
      expect(onSandboxProxyReady).toHaveBeenCalledTimes(1);
    });

    it('opens a channel on app ready and sends the init message with a transferred port', () => {
      expect(bridge.connected).toBeFalse();
      const app = connectApp();
      expect(bridge.connected).toBeTrue();
      expect(app.targetOrigin).toBe(SANDBOX_ORIGIN);
      expect(app.port).toBeInstanceOf(MessagePort);
      expect(app.init).toEqual({
        type: 'a2ui_app_frame_init',
        value: {
          config: {theme: 'dark'},
          initialData: {game: {score: 1, player: 'ann'}, title: 'Pong'},
          allowedEvents: props.allowedEvents!,
          allowedFunctions: props.allowedFunctions!,
          mutableDataKeys: ['game'],
          hostContext: {containerDimensions: {width: 300, height: 150}},
        },
      });
    });

    it('ignores app ready from another origin or window', () => {
      ambient({type: A2uiMessageType.AppFrameReady}, 'https://evil.example');
      ambient({type: A2uiMessageType.AppFrameReady}, SANDBOX_ORIGIN, window);
      expect(postMessage).not.toHaveBeenCalled();
      expect(bridge.connected).toBeFalse();
    });

    it('ignores port-only messages on the ambient channel', () => {
      ambient({type: A2uiMessageType.Action, action: 'submit', data: {value: 1}});
      expect(host.actions).toEqual([]);
    });

    it('replaces the channel when the app reports ready again', async () => {
      const first = connectApp();
      const second = connectApp();
      host.setData('/title', 'Tennis');
      await waitFor(
        () => messagesOf(second, 'a2ui_data_model_update').length === 1,
        'update on the new channel',
      );
      await settle();
      expect(messagesOf(first, 'a2ui_data_model_update')).toEqual([]);
      expect(host.subscriberCount).toBe(2);
    });
  });

  describe('actions', () => {
    let app: ConnectedApp;

    beforeEach(() => {
      app = connectApp();
    });

    it('dispatches a listed action with a valid payload', async () => {
      app.port.postMessage({type: A2uiMessageType.Action, action: 'submit', data: {value: 1}});
      await waitFor(() => host.actions.length === 1, 'action dispatched');
      expect(host.actions[0]).toEqual({name: 'submit', context: {value: 1}});
    });

    it('drops an action that is not listed', async () => {
      app.port.postMessage({type: A2uiMessageType.Action, action: 'reset', data: {}});
      await waitFor(() => warn.calls.count() === 1, 'warning logged');
      expect(warn.calls.mostRecent().args[0]).toContain('not in allowedEvents');
      expect(host.actions).toEqual([]);
    });

    it('drops an action whose payload fails its schema', async () => {
      app.port.postMessage({type: A2uiMessageType.Action, action: 'submit', data: {value: 'x'}});
      await waitFor(() => warn.calls.count() === 1, 'warning logged');
      expect(warn.calls.mostRecent().args[0]).toContain('failed schema validation');
      expect(host.actions).toEqual([]);
    });

    it('dispatches an invalid payload when schema validation is disabled', async () => {
      props = {...props, disableSchemaValidation: true};
      app.port.postMessage({type: A2uiMessageType.Action, action: 'submit', data: {value: 'x'}});
      await waitFor(() => host.actions.length === 1, 'action dispatched');
      expect(host.actions[0].context).toEqual({value: 'x'});
    });

    it('drops an action whose payload is not an object', async () => {
      app.port.postMessage({type: A2uiMessageType.Action, action: 'submit', data: 'text'});
      await waitFor(() => warn.calls.count() === 1, 'warning logged');
      expect(host.actions).toEqual([]);
    });

    it('drops messages that fail the security check', async () => {
      const polluted = JSON.parse(
        '{"type":"a2ui_action","action":"submit","data":{"value":1,"__proto__":{"admin":true}}}',
      );
      app.port.postMessage(polluted);
      app.port.postMessage({
        type: A2uiMessageType.Action,
        action: 'submit',
        data: {value: 1, padding: 'x'.repeat(70_000)},
      });
      await waitFor(() => warn.calls.count() === 2, 'two warnings logged');
      expect(warn.calls.argsFor(0)[0]).toContain('Dropping insecure message');
      expect(warn.calls.argsFor(1)[0]).toContain('Dropping insecure message');
      expect(host.actions).toEqual([]);
    });
  });

  describe('data model', () => {
    let app: ConnectedApp;

    beforeEach(() => {
      app = connectApp();
    });

    it('pushes host changes to the app as updates', async () => {
      host.setData('/game/score', 7);
      host.setData('/title', 'Tennis');
      await waitFor(
        () => messagesOf(app, 'a2ui_data_model_update').length === 2,
        'two updates received',
      );
      expect(messagesOf(app, 'a2ui_data_model_update')).toEqual([
        {type: 'a2ui_data_model_update', key: 'game', subpath: '/score', value: 7},
        {type: 'a2ui_data_model_update', key: 'title', value: 'Tennis'},
      ]);
    });

    it('writes a valid change from the app without echoing it', async () => {
      app.port.postMessage({
        type: A2uiMessageType.DataModelChange,
        key: 'game',
        subpath: '/score',
        value: 9,
      });
      await waitFor(() => host.getData('/game/score') === 9, 'score written');
      app.port.postMessage({
        type: A2uiMessageType.DataModelChange,
        key: 'game',
        value: {score: 10, player: 'bob'},
      });
      await waitFor(() => host.getData('/game/player') === 'bob', 'whole value written');
      await settle();
      expect(messagesOf(app, 'a2ui_data_model_update')).toEqual([]);
    });

    it('rejects changes to keys that are not mutable', async () => {
      app.port.postMessage({type: A2uiMessageType.DataModelChange, key: 'title', value: 'Tennis'});
      await waitFor(() => warn.calls.count() === 1, 'warning logged');
      expect(warn.calls.mostRecent().args[0]).toContain('not authorized for mutation');
      expect(host.getData('/title')).toBe('Pong');
    });

    it('validates a subpath change as the whole value it produces', async () => {
      app.port.postMessage({
        type: A2uiMessageType.DataModelChange,
        key: 'game',
        subpath: '/score',
        value: 'high',
      });
      app.port.postMessage({
        type: A2uiMessageType.DataModelChange,
        key: 'game',
        subpath: '/extra',
        value: 1,
      });
      await waitFor(() => warn.calls.count() === 2, 'two warnings logged');
      expect(host.getData('/game')).toEqual({score: 1, player: 'ann'});
    });

    it('refuses subpaths with prototype pollution segments', async () => {
      app.port.postMessage({
        type: A2uiMessageType.DataModelChange,
        key: 'game',
        subpath: '/__proto__',
        value: {admin: true},
      });
      await waitFor(() => warn.calls.count() === 1, 'warning logged');
      expect(warn.calls.mostRecent().args[0]).toContain('forbidden subpath');
      expect(host.getData('/game')).toEqual({score: 1, player: 'ann'});
    });

    it('rejects changes to mutable keys that are not bound', async () => {
      props = {...props, mutableData: {...props.mutableData, loose: {}}};
      app.port.postMessage({type: A2uiMessageType.DataModelChange, key: 'loose', value: 1});
      await waitFor(() => warn.calls.count() === 1, 'warning logged');
      expect(warn.calls.mostRecent().args[0]).toContain('not bound in data.paths');
    });
  });

  describe('function calls', () => {
    let app: ConnectedApp;

    beforeEach(() => {
      app = connectApp();
    });

    it('replies with the result of a listed function', async () => {
      app.port.postMessage({
        type: A2uiMessageType.FunctionCall,
        call: 'double',
        callId: 'c1',
        args: {n: 21},
      });
      await waitFor(() => messagesOf(app, 'a2ui_function_result').length === 1, 'result received');
      expect(messagesOf(app, 'a2ui_function_result')[0]).toEqual({
        type: 'a2ui_function_result',
        call: 'double',
        callId: 'c1',
        status: 'success',
        result: 42,
      });
      expect(host.functionCalls).toEqual([{name: 'double', args: {n: 21}}]);
    });

    it('replies with an error for a function that is not listed', async () => {
      app.port.postMessage({type: A2uiMessageType.FunctionCall, call: 'secret', callId: 2});
      await waitFor(() => messagesOf(app, 'a2ui_function_result').length === 1, 'error received');
      expect(messagesOf(app, 'a2ui_function_result')[0]).toEqual({
        type: 'a2ui_function_result',
        call: 'secret',
        callId: 2,
        status: 'error',
        error: {code: 'NOT_ALLOWED', message: 'Function secret is not in allowedFunctions'},
      });
      expect(host.functionCalls).toEqual([]);
    });

    it('replies with a validation error for arguments that fail the schema', async () => {
      app.port.postMessage({
        type: A2uiMessageType.FunctionCall,
        call: 'double',
        callId: 'c3',
        args: {n: 'x'},
      });
      app.port.postMessage({
        type: A2uiMessageType.FunctionCall,
        call: 'double',
        callId: 'c4',
        args: 5,
      });
      await waitFor(() => messagesOf(app, 'a2ui_function_result').length === 2, 'errors received');
      const results = messagesOf(app, 'a2ui_function_result');
      expect(results[0]).toEqual(
        jasmine.objectContaining({
          callId: 'c3',
          status: 'error',
          error: {code: 'VALIDATION_ERROR', message: 'Arguments failed schema validation'},
        }),
      );
      expect(results[1]).toEqual(
        jasmine.objectContaining({
          callId: 'c4',
          status: 'error',
          error: {code: 'VALIDATION_ERROR', message: 'Arguments must be an object'},
        }),
      );
      expect(host.functionCalls).toEqual([]);
    });

    it('replies with an execution error when the function throws', async () => {
      app.port.postMessage({type: A2uiMessageType.FunctionCall, call: 'fail', callId: 'c5'});
      await waitFor(() => messagesOf(app, 'a2ui_function_result').length === 1, 'error received');
      expect(messagesOf(app, 'a2ui_function_result')[0]).toEqual({
        type: 'a2ui_function_result',
        call: 'fail',
        callId: 'c5',
        status: 'error',
        error: {code: 'EXECUTION_ERROR', message: 'boom'},
      });
    });
  });

  describe('sizing and host context', () => {
    it('applies resize requests from the app', async () => {
      const app = connectApp();
      app.port.postMessage({type: A2uiMessageType.SizeChanged, height: 400});
      await waitFor(() => frame.style.height === '400px', 'frame resized');
      expect(container.style.height).toBe('400px');
    });

    it('reports container size changes to the app', async () => {
      const app = connectApp();
      frame.style.width = '360px';
      await waitFor(
        () =>
          app.received.some(
            message =>
              message['type'] === 'a2ui_host_context_update' &&
              (message['value'] as {containerDimensions: {width: number}}).containerDimensions
                .width === 360,
          ),
        'host context update received',
      );
    });
  });

  describe('dispose', () => {
    it('stops listening, closes the channel and releases the subscriptions', async () => {
      const app = connectApp();
      bridge.dispose();
      expect(bridge.connected).toBeFalse();
      expect(host.subscriberCount).toBe(0);

      host.setData('/title', 'Tennis');
      ambient({type: A2uiMessageType.SandboxProxyReady});
      ambient({type: A2uiMessageType.AppFrameReady});
      await settle();
      expect(messagesOf(app, 'a2ui_data_model_update')).toEqual([]);
      expect(onSandboxProxyReady).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledTimes(1);
    });
  });
});
