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

import {
  createSandboxResourceReadyMessage,
  isMessageFromFrame,
  isSandboxProxyReadyMessage,
  listenForSandboxProxyReady,
  sendSandboxResourceReady,
} from './sandbox_bootstrap.js';

const SANDBOX_ORIGIN = 'https://host.example';

describe('sandbox bootstrap', () => {
  let frame: HTMLIFrameElement;

  beforeEach(() => {
    frame = document.createElement('iframe');
    document.body.appendChild(frame);
  });

  afterEach(() => {
    frame.remove();
  });

  function frameMessage(data: unknown, origin = SANDBOX_ORIGIN): MessageEvent {
    return new MessageEvent('message', {data, origin, source: frame.contentWindow});
  }

  describe('isSandboxProxyReadyMessage', () => {
    it('recognises the message of each protocol only', () => {
      const a2ui = {type: 'a2ui_sandbox_proxy_ready'};
      const mcp = {jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {}};
      expect(isSandboxProxyReadyMessage(a2ui, 'a2ui')).toBeTrue();
      expect(isSandboxProxyReadyMessage(a2ui, 'mcp')).toBeFalse();
      expect(isSandboxProxyReadyMessage(mcp, 'mcp')).toBeTrue();
      expect(isSandboxProxyReadyMessage(mcp, 'a2ui')).toBeFalse();
    });

    it('rejects other shapes', () => {
      expect(isSandboxProxyReadyMessage(null, 'a2ui')).toBeFalse();
      expect(isSandboxProxyReadyMessage('a2ui_sandbox_proxy_ready', 'a2ui')).toBeFalse();
      expect(isSandboxProxyReadyMessage({type: 'a2ui_app_frame_ready'}, 'a2ui')).toBeFalse();
      expect(isSandboxProxyReadyMessage([], 'mcp')).toBeFalse();
    });
  });

  describe('createSandboxResourceReadyMessage', () => {
    it('builds the A2UI envelope with html under both keys', () => {
      expect(
        createSandboxResourceReadyMessage(
          {html: '<p>hi</p>', sandbox: 'allow-scripts', permissions: {camera: {}}},
          'a2ui',
        ),
      ).toEqual({
        type: 'a2ui_sandbox_resource_ready',
        html: '<p>hi</p>',
        htmlContent: '<p>hi</p>',
        sandbox: 'allow-scripts',
        permissions: {camera: {}},
      });
    });

    it('builds the MCP Apps notification and omits absent fields', () => {
      expect(createSandboxResourceReadyMessage({url: 'https://app.example/ui'}, 'mcp')).toEqual({
        jsonrpc: '2.0',
        method: 'ui/notifications/sandbox-resource-ready',
        params: {url: 'https://app.example/ui'},
      });
    });
  });

  describe('isMessageFromFrame', () => {
    it('requires the frame window as source and the expected origin', () => {
      expect(isMessageFromFrame(frameMessage({}), frame, SANDBOX_ORIGIN)).toBeTrue();
      expect(
        isMessageFromFrame(frameMessage({}, 'https://evil.example'), frame, SANDBOX_ORIGIN),
      ).toBeFalse();
      const fromTop = new MessageEvent('message', {
        data: {},
        origin: SANDBOX_ORIGIN,
        source: window,
      });
      expect(isMessageFromFrame(fromTop, frame, SANDBOX_ORIGIN)).toBeFalse();
    });

    it('rejects everything for a detached frame', () => {
      const detached = document.createElement('iframe');
      const event = new MessageEvent('message', {data: {}, origin: SANDBOX_ORIGIN, source: window});
      expect(isMessageFromFrame(event, detached, SANDBOX_ORIGIN)).toBeFalse();
    });
  });

  describe('listenForSandboxProxyReady', () => {
    let target: EventTarget;
    let onReady: jasmine.Spy;
    let stop: () => void;

    beforeEach(() => {
      target = new EventTarget();
      onReady = jasmine.createSpy('onReady');
      stop = listenForSandboxProxyReady({
        frame,
        sandboxOrigin: SANDBOX_ORIGIN,
        protocol: 'a2ui',
        onReady,
        target,
      });
    });

    afterEach(() => {
      stop();
    });

    it('fires for the proxy-ready message of its protocol from the frame', () => {
      target.dispatchEvent(frameMessage({type: 'a2ui_sandbox_proxy_ready'}));
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('ignores other messages, other origins and other sources', () => {
      target.dispatchEvent(frameMessage({type: 'a2ui_app_frame_ready'}));
      target.dispatchEvent(
        frameMessage({type: 'a2ui_sandbox_proxy_ready'}, 'https://evil.example'),
      );
      target.dispatchEvent(
        new MessageEvent('message', {
          data: {type: 'a2ui_sandbox_proxy_ready'},
          origin: SANDBOX_ORIGIN,
          source: window,
        }),
      );
      target.dispatchEvent(
        frameMessage({jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {}}),
      );
      expect(onReady).not.toHaveBeenCalled();
    });

    it('stops listening once the returned function runs', () => {
      stop();
      target.dispatchEvent(frameMessage({type: 'a2ui_sandbox_proxy_ready'}));
      expect(onReady).not.toHaveBeenCalled();
    });

    it('defaults to listening on window', () => {
      const onWindowReady = jasmine.createSpy('onWindowReady');
      const stopWindow = listenForSandboxProxyReady({
        frame,
        sandboxOrigin: SANDBOX_ORIGIN,
        protocol: 'mcp',
        onReady: onWindowReady,
      });
      window.dispatchEvent(
        frameMessage({jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {}}),
      );
      stopWindow();
      expect(onWindowReady).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendSandboxResourceReady', () => {
    it('posts the message to the frame window addressed to the sandbox origin', () => {
      const postMessage: jasmine.Spy = spyOn(frame.contentWindow!, 'postMessage');
      const sent = sendSandboxResourceReady({
        frame,
        sandboxOrigin: SANDBOX_ORIGIN,
        protocol: 'a2ui',
        resource: {html: '<p>hi</p>', sandbox: 'allow-scripts allow-forms allow-modals'},
      });
      expect(sent).toBeTrue();
      expect(postMessage).toHaveBeenCalledOnceWith(
        {
          type: 'a2ui_sandbox_resource_ready',
          html: '<p>hi</p>',
          htmlContent: '<p>hi</p>',
          sandbox: 'allow-scripts allow-forms allow-modals',
        },
        SANDBOX_ORIGIN,
      );
    });

    it('reports false for a frame without a window', () => {
      const detached = document.createElement('iframe');
      expect(
        sendSandboxResourceReady({
          frame: detached,
          sandboxOrigin: SANDBOX_ORIGIN,
          protocol: 'mcp',
          resource: {url: 'https://app.example/ui'},
        }),
      ).toBeFalse();
    });
  });
});
