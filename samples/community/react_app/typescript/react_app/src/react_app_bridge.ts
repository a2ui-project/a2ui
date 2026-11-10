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

/**
 * Host side of the ReactApp bridge for one frame: answers the app's JSON-RPC requests on top of
 * a {@link FrameHost} and pushes data model and theme changes, as `docs/bridge_protocol.md`
 * specifies. Structured like the MCP catalog's `McpAppBridge`, without the MCP SDK: the protocol
 * is small enough to implement directly.
 */

import {hasForbiddenSegment, isFunctionAllowed, isPathAllowed} from './allowlist.js';
import type {FrameHost, FrameHostSubscription} from './shared/sandbox/frame_host.js';
import {
  isMessageFromFrame,
  isSandboxProxyReadyMessage,
  type MessageListenerTarget,
} from './shared/sandbox/sandbox_bootstrap.js';
import {deepEqual} from './shared/sandbox/data_model_sync.js';
import {validateMessagePayload} from './shared/sandbox/payload_validation.js';
import type {ThemeTokens} from './theme_tokens.js';

const LOG_PREFIX = '[ReactApp]';

/** Version of the bridge protocol this host speaks. */
export const BRIDGE_PROTOCOL_VERSION = '1';

/** Error codes of bridge protocol section 7. */
export const ReactAppErrorCode = {
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  PayloadRejected: -32001,
  NotInitialized: -32002,
  FunctionFailed: -32010,
  PathNotAllowed: -32011,
  FunctionNotAllowed: -32012,
  ActionFailed: -32014,
} as const;

/** Most `ui/log` and `ui/error` notifications accepted per second (section 8). */
export const MAX_DIAGNOSTICS_PER_SECOND = 50;

/** Timings of `ui/rendered`, in milliseconds since the app document's time origin. */
export interface ReactAppTimings {
  readonly runtimeReady?: number;
  readonly initialized?: number;
  readonly compiled?: number;
  readonly rendered?: number;
  readonly transpileMs?: number;
}

/** A `ui/error` from the app. */
export interface ReactAppError {
  readonly phase: string;
  readonly message: string;
  readonly stack?: string;
  readonly line?: number;
  readonly column?: number;
}

/** What the bridge reports to the page, for logs, panels and tests. */
export type ReactAppBridgeEvent =
  | {
      readonly type: 'message';
      readonly direction: 'in' | 'out';
      readonly message: Readonly<Record<string, unknown>>;
      readonly time: number;
    }
  | {readonly type: 'ready'; readonly time: number}
  | {
      readonly type: 'rendered';
      readonly timings: ReactAppTimings;
      /** Host time from the proxy's ready message (or the bridge start) to `ui/rendered`. */
      readonly frameReadyToRenderedMs: number;
    }
  | {readonly type: 'error'; readonly error: ReactAppError}
  | {readonly type: 'log'; readonly level: string; readonly args: readonly unknown[]};

/** How the bridge reaches the frame. */
export interface ReactAppBridgeTransport {
  send(message: Readonly<Record<string, unknown>>): void;
  /** Calls `handler` with every message from the frame; returns a function that stops. */
  listen(handler: (message: unknown) => void): () => void;
}

/**
 * The transport to the sandbox proxy in `frame`: posts to the proxy window with its origin as
 * the target, and accepts only messages from that window and origin.
 */
export function createFrameTransport(
  frame: HTMLIFrameElement,
  sandboxOrigin: string,
  target: MessageListenerTarget = window,
): ReactAppBridgeTransport {
  return {
    send: message => frame.contentWindow?.postMessage(message, sandboxOrigin),
    listen: handler => {
      const listener = (event: Event) => {
        if (event instanceof MessageEvent && isMessageFromFrame(event, frame, sandboxOrigin)) {
          handler(event.data);
        }
      };
      target.addEventListener('message', listener);
      return () => target.removeEventListener('message', listener);
    },
  };
}

/** The component properties the bridge reads on every request. */
export interface ReactAppBridgeProps {
  readonly dataPaths?: readonly string[];
  readonly functions?: readonly string[];
}

/** Inputs of {@link ReactAppBridge}. */
export interface ReactAppBridgeOptions {
  readonly transport: ReactAppBridgeTransport;
  /** The surface side: data model, functions and actions. */
  readonly host: FrameHost;
  /** The component's current allowlists. */
  readonly getProps: () => ReactAppBridgeProps;
  /** The theme tokens to send in `initialize`. */
  readonly getTheme: () => ThemeTokens;
  /** The frame's size, sent in `initialize`. */
  readonly getContainerSize: () => {width: number; height: number};
  /** Applies a `ui/resize` request. */
  readonly onResize?: (height: number, width?: number) => void;
  /** Receives every {@link ReactAppBridgeEvent}. */
  readonly onEvent?: (event: ReactAppBridgeEvent) => void;
  /** Clock for latency measurements; defaults to `performance.now`. */
  readonly now?: () => number;
}

interface JsonRpcRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/** An error the request handlers throw to answer with a JSON-RPC error. */
class RequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface PathSubscription {
  readonly subscription: FrameHostSubscription;
  /** The value the app last received for the path; `undefined` when it holds nothing. */
  last: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function snapshot(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value);
}

/** Returns `{value}` for a present value and `{}` for `undefined`, as the protocol encodes it. */
function valueField(value: unknown): {value?: unknown} {
  return value === undefined ? {} : {value};
}

/**
 * Connects one ReactApp frame to its surface. {@link start} listens to the frame; {@link dispose}
 * drops the subscriptions and stops listening. An instance serves one app document: the element
 * creates a new bridge whenever the frame content or the context changes.
 */
export class ReactAppBridge {
  private stopListening: (() => void) | null = null;
  private initialized = false;
  private readonly subscriptions = new Map<string, PathSubscription>();
  /** The path the app is writing right now; changes to it are the app's own (echo). */
  private writingPath: string | null = null;
  private readyAt: number;
  private diagnosticsWindow = {start: 0, count: 0};
  private readonly now: () => number;

  constructor(private readonly options: ReactAppBridgeOptions) {
    this.now = options.now ?? (() => performance.now());
    this.readyAt = this.now();
  }

  /** Starts listening to the frame. */
  start(): void {
    if (this.stopListening) {
      return;
    }
    this.readyAt = this.now();
    this.stopListening = this.options.transport.listen(message => this.handleMessage(message));
  }

  /** Stops listening and unsubscribes from every path. */
  dispose(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.initialized = false;
    for (const {subscription} of this.subscriptions.values()) {
      subscription.unsubscribe();
    }
    this.subscriptions.clear();
  }

  /** Sends `theme/changed`, once the app is initialized. */
  sendTheme(theme: ThemeTokens): void {
    if (this.initialized) {
      this.send({jsonrpc: '2.0', method: 'theme/changed', params: {...theme}});
    }
  }

  private handleMessage(message: unknown): void {
    if (isSandboxProxyReadyMessage(message, 'a2ui')) {
      this.readyAt = this.now();
      this.emit({type: 'ready', time: this.readyAt});
      return;
    }
    if (!isRecord(message) || message['jsonrpc'] !== '2.0') {
      return;
    }
    this.emit({type: 'message', direction: 'in', message, time: this.now()});
    const {id, method} = message;
    const isRequest =
      typeof method === 'string' && (typeof id === 'string' || typeof id === 'number');
    const security = validateMessagePayload(message);
    if (!security.valid) {
      console.warn(`${LOG_PREFIX} Message rejected:`, security.reason);
      if (isRequest) {
        this.sendError(
          id as string | number,
          ReactAppErrorCode.PayloadRejected,
          `Message rejected: ${security.reason}`,
        );
      }
      return;
    }
    if (typeof method !== 'string') {
      return;
    }
    const params = isRecord(message['params']) ? message['params'] : {};
    if (isRequest) {
      this.handleRequest({id: id as string | number, method, params});
    } else if (id === undefined) {
      this.handleNotification(method, params);
    }
  }

  private handleRequest(request: JsonRpcRequest): void {
    Promise.resolve()
      .then(() => this.dispatchRequest(request))
      .then(
        result => {
          if (this.stopListening) {
            this.send({jsonrpc: '2.0', id: request.id, result});
          }
        },
        (error: unknown) => {
          if (!this.stopListening) {
            return;
          }
          if (error instanceof RequestError) {
            this.sendError(request.id, error.code, error.message, error.data);
          } else {
            console.error(`${LOG_PREFIX} ${request.method} failed:`, error);
            this.sendError(request.id, ReactAppErrorCode.InternalError, errorMessage(error));
          }
        },
      );
  }

  private async dispatchRequest(request: JsonRpcRequest): Promise<Record<string, unknown>> {
    const {method, params} = request;
    if (method === 'reactApp/initialize') {
      return this.initialize(params);
    }
    if (!this.initialized) {
      throw new RequestError(
        ReactAppErrorCode.NotInitialized,
        `${method} sent before reactApp/initialize.`,
      );
    }
    switch (method) {
      case 'data/get':
        return valueField(this.options.host.getData(this.checkedPath(params)));
      case 'data/set':
        return this.setData(params);
      case 'data/subscribe':
        return valueField(this.subscribe(this.checkedPath(params)));
      case 'data/unsubscribe': {
        const path = this.checkedPath(params);
        this.subscriptions.get(path)?.subscription.unsubscribe();
        this.subscriptions.delete(path);
        return {};
      }
      case 'function/call':
        return this.callFunction(params);
      case 'action/dispatch':
        return this.dispatchAction(params);
      default:
        throw new RequestError(ReactAppErrorCode.MethodNotFound, `Unknown method ${method}`);
    }
  }

  private initialize(params: Record<string, unknown>): Record<string, unknown> {
    if (params['protocolVersion'] !== BRIDGE_PROTOCOL_VERSION) {
      throw new RequestError(
        ReactAppErrorCode.InvalidParams,
        `Unsupported protocol version ${String(params['protocolVersion'])}; the host speaks ${BRIDGE_PROTOCOL_VERSION}.`,
      );
    }
    const requested = Array.isArray(params['paths'])
      ? params['paths'].filter((path): path is string => typeof path === 'string')
      : [];
    const {dataPaths} = this.options.getProps();
    const dataSnapshot: Record<string, unknown> = {};
    const deniedPaths: string[] = [];
    for (const path of requested) {
      if (hasForbiddenSegment(path) || !isPathAllowed(path, dataPaths)) {
        deniedPaths.push(path);
        continue;
      }
      const value = this.subscribe(path);
      if (value !== undefined) {
        dataSnapshot[path] = value;
      }
    }
    this.initialized = true;
    return {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      theme: {...this.options.getTheme()},
      containerSize: this.options.getContainerSize(),
      dataSnapshot,
      deniedPaths,
    };
  }

  /** Validates the `path` param against the limits and the allowlist. */
  private checkedPath(params: Record<string, unknown>): string {
    const path = params['path'];
    if (typeof path !== 'string') {
      throw new RequestError(ReactAppErrorCode.InvalidParams, 'The path param must be a string.');
    }
    if (hasForbiddenSegment(path)) {
      throw new RequestError(
        ReactAppErrorCode.InvalidParams,
        `Path ${path} has a forbidden segment.`,
      );
    }
    if (!isPathAllowed(path, this.options.getProps().dataPaths)) {
      throw new RequestError(
        ReactAppErrorCode.PathNotAllowed,
        `Path ${path} is not in the app's dataPaths.`,
        {path},
      );
    }
    return path;
  }

  /** Subscribes to `path` once per session and returns its current value. */
  private subscribe(path: string): unknown {
    const value = snapshot(this.options.host.getData(path));
    if (this.subscriptions.has(path)) {
      return value;
    }
    const entry: PathSubscription = {
      last: value,
      subscription: this.options.host.subscribeData(path, next =>
        this.handleHostChange(path, next),
      ),
    };
    this.subscriptions.set(path, entry);
    return value;
  }

  private handleHostChange(path: string, value: unknown): void {
    const entry = this.subscriptions.get(path);
    if (!entry) {
      return;
    }
    if (path === this.writingPath) {
      // The app's own write: it already holds the value.
      entry.last = snapshot(value);
      return;
    }
    if (deepEqual(entry.last, value)) {
      return;
    }
    entry.last = snapshot(value);
    if (this.initialized) {
      this.send({jsonrpc: '2.0', method: 'data/changed', params: {path, ...valueField(value)}});
    }
  }

  private setData(params: Record<string, unknown>): Record<string, unknown> {
    const path = this.checkedPath(params);
    const seq = typeof params['seq'] === 'number' ? params['seq'] : 0;
    const {host} = this.options;
    if (!deepEqual(host.getData(path), params['value'])) {
      this.writingPath = path;
      try {
        host.setData(path, params['value']);
      } finally {
        this.writingPath = null;
      }
    }
    const value = snapshot(host.getData(path));
    const entry = this.subscriptions.get(path);
    if (entry) {
      entry.last = value;
    }
    return {seq, ...valueField(value)};
  }

  private async callFunction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const name = params['name'];
    if (typeof name !== 'string') {
      throw new RequestError(ReactAppErrorCode.InvalidParams, 'The name param must be a string.');
    }
    const args = params['args'] ?? {};
    if (!isRecord(args)) {
      throw new RequestError(ReactAppErrorCode.InvalidParams, 'The args param must be an object.');
    }
    if (!isFunctionAllowed(name, this.options.getProps().functions)) {
      throw new RequestError(
        ReactAppErrorCode.FunctionNotAllowed,
        `Function ${name} is not in the app's functions.`,
        {name},
      );
    }
    try {
      return valueField(await this.options.host.invokeFunction(name, args));
    } catch (error) {
      throw new RequestError(ReactAppErrorCode.FunctionFailed, errorMessage(error), {name});
    }
  }

  private async dispatchAction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const name = params['name'];
    const context = params['context'] ?? {};
    if (typeof name !== 'string' || !isRecord(context)) {
      throw new RequestError(
        ReactAppErrorCode.InvalidParams,
        'action/dispatch needs a string name and an object context.',
      );
    }
    try {
      await this.options.host.dispatchAction(name, context);
    } catch (error) {
      throw new RequestError(ReactAppErrorCode.ActionFailed, errorMessage(error), {name});
    }
    return {};
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'ui/rendered': {
        const timings = isRecord(params['timings']) ? (params['timings'] as ReactAppTimings) : {};
        this.emit({
          type: 'rendered',
          timings,
          frameReadyToRenderedMs: Math.round(this.now() - this.readyAt),
        });
        return;
      }
      case 'ui/resize': {
        const height = params['height'];
        const width = params['width'];
        if (typeof height === 'number' && Number.isFinite(height)) {
          this.options.onResize?.(height, typeof width === 'number' ? width : undefined);
        }
        return;
      }
      case 'ui/error': {
        if (!this.allowDiagnostic()) {
          return;
        }
        const error: ReactAppError = {
          phase: typeof params['phase'] === 'string' ? params['phase'] : 'runtime',
          message: typeof params['message'] === 'string' ? params['message'] : 'Unknown error',
          ...(typeof params['stack'] === 'string' ? {stack: params['stack']} : {}),
          ...(typeof params['line'] === 'number' ? {line: params['line']} : {}),
          ...(typeof params['column'] === 'number' ? {column: params['column']} : {}),
        };
        console.warn(`${LOG_PREFIX} App error (${error.phase}):`, error.message);
        this.emit({type: 'error', error});
        return;
      }
      case 'ui/log': {
        if (!this.allowDiagnostic()) {
          return;
        }
        const level = typeof params['level'] === 'string' ? params['level'] : 'info';
        const args = Array.isArray(params['args']) ? params['args'] : [];
        this.emit({type: 'log', level, args});
        return;
      }
      default:
        return;
    }
  }

  private allowDiagnostic(): boolean {
    const time = this.now();
    if (time - this.diagnosticsWindow.start >= 1000) {
      this.diagnosticsWindow = {start: time, count: 0};
    }
    this.diagnosticsWindow.count++;
    return this.diagnosticsWindow.count <= MAX_DIAGNOSTICS_PER_SECOND;
  }

  private sendError(
    id: string | number,
    code: number,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.send({jsonrpc: '2.0', id, error: {code, message, ...(data ? {data} : {})}});
  }

  private send(message: Record<string, unknown>): void {
    this.emit({type: 'message', direction: 'out', message, time: this.now()});
    this.options.transport.send(message);
  }

  private emit(event: ReactAppBridgeEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch (error) {
      console.error(`${LOG_PREFIX} Event listener failed:`, error);
    }
  }
}
