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
 * Host side of the sandbox proxy handshake, shared by the `a2ui_*` and the MCP Apps bridges.
 *
 * The host frame loads the proxy page; the proxy announces itself with a proxy-ready message in
 * both protocols; the host answers with a resource-ready message carrying the content to load in
 * the inner frame. Both messages travel over ambient `postMessage`, so the host checks the source
 * window and origin of everything it receives.
 */

import {
  A2uiSandboxMessageType,
  PROXY_READY_NOTIFICATION,
  RESOURCE_READY_NOTIFICATION,
  type SandboxPermissions,
} from './sandbox.js';

/** Framing of the handshake messages: the flat A2UI envelope or MCP Apps JSON-RPC notifications. */
export type SandboxProtocol = 'a2ui' | 'mcp';

/** Content for the inner frame and the restrictions it runs under. */
export interface SandboxResource {
  /** Inline HTML, loaded through `srcdoc`. Takes precedence over `url`. */
  readonly html?: string;
  /** External URL, loaded through `src`. */
  readonly url?: string;
  /** Sandbox flags of the inner frame; the proxy keeps its strict default when omitted. */
  readonly sandbox?: string;
  /** Permissions delegated to the inner frame; everything sensitive is denied when omitted. */
  readonly permissions?: SandboxPermissions;
}

/** Where `message` events arrive: `window` in production, any `EventTarget` in tests. */
export type MessageListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `data` is the proxy-ready message of the given protocol. */
export function isSandboxProxyReadyMessage(data: unknown, protocol: SandboxProtocol): boolean {
  if (!isRecord(data)) {
    return false;
  }
  return protocol === 'mcp'
    ? data['method'] === PROXY_READY_NOTIFICATION
    : data['type'] === A2uiSandboxMessageType.SandboxProxyReady;
}

/**
 * Builds the resource-ready message for a protocol. The A2UI envelope repeats the HTML under
 * `htmlContent` for proxies that predate the `html` key.
 */
export function createSandboxResourceReadyMessage(
  resource: SandboxResource,
  protocol: SandboxProtocol,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (resource.html !== undefined) {
    payload['html'] = resource.html;
    payload['htmlContent'] = resource.html;
  }
  if (resource.url !== undefined) {
    payload['url'] = resource.url;
  }
  if (resource.sandbox !== undefined) {
    payload['sandbox'] = resource.sandbox;
  }
  if (resource.permissions !== undefined) {
    payload['permissions'] = resource.permissions;
  }
  return protocol === 'mcp'
    ? {jsonrpc: '2.0', method: RESOURCE_READY_NOTIFICATION, params: payload}
    : {type: A2uiSandboxMessageType.SandboxResourceReady, ...payload};
}

/**
 * Whether a `message` event was posted by the given frame's window from the expected origin.
 * Both checks are required: the origin alone does not identify the frame, and the source alone
 * would accept a message the frame posted before the proxy page finished loading.
 */
export function isMessageFromFrame(
  event: MessageEvent,
  frame: HTMLIFrameElement,
  expectedOrigin: string,
): boolean {
  return (
    frame.contentWindow !== null &&
    event.source === frame.contentWindow &&
    event.origin === expectedOrigin
  );
}

/** Inputs of {@link listenForSandboxProxyReady}. */
export interface SandboxProxyReadyListenerOptions {
  /** The frame that loads the proxy page. */
  readonly frame: HTMLIFrameElement;
  /** Origin the proxy page is served from. */
  readonly sandboxOrigin: string;
  readonly protocol: SandboxProtocol;
  /** Called each time the proxy reports ready, including after the frame reloads. */
  readonly onReady: () => void;
  /** Where the events arrive; defaults to `window`. */
  readonly target?: MessageListenerTarget;
}

/**
 * Calls `onReady` whenever the proxy in `frame` announces itself. Returns a function that removes
 * the listener.
 */
export function listenForSandboxProxyReady(options: SandboxProxyReadyListenerOptions): () => void {
  const {frame, sandboxOrigin, protocol, onReady} = options;
  const target: MessageListenerTarget = options.target ?? window;
  const listener = (event: Event) => {
    if (
      event instanceof MessageEvent &&
      isMessageFromFrame(event, frame, sandboxOrigin) &&
      isSandboxProxyReadyMessage(event.data, protocol)
    ) {
      onReady();
    }
  };
  target.addEventListener('message', listener);
  return () => {
    target.removeEventListener('message', listener);
  };
}

/** Inputs of {@link sendSandboxResourceReady}. */
export interface SendSandboxResourceReadyOptions {
  readonly frame: HTMLIFrameElement;
  /** Origin the proxy page is served from; the message is addressed to it only. */
  readonly sandboxOrigin: string;
  readonly protocol: SandboxProtocol;
  readonly resource: SandboxResource;
}

/**
 * Posts the resource-ready message to the proxy in `frame`. Returns false when the frame has no
 * window yet, in which case nothing is sent.
 */
export function sendSandboxResourceReady(options: SendSandboxResourceReadyOptions): boolean {
  const {frame, sandboxOrigin, protocol, resource} = options;
  const proxyWindow = frame.contentWindow;
  if (!proxyWindow) {
    return false;
  }
  proxyWindow.postMessage(createSandboxResourceReadyMessage(resource, protocol), sandboxOrigin);
  return true;
}
