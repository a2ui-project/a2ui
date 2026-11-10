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
 * App side of the ReactApp bridge: JSON-RPC 2.0 requests and notifications over `postMessage`
 * to the host, through the sandbox proxy (see `docs/bridge_protocol.md`).
 */

/** Error codes of the bridge protocol (section 7). */
export const BridgeErrorCode = {
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  PayloadRejected: -32001,
  NotInitialized: -32002,
  FunctionFailed: -32010,
  PathNotAllowed: -32011,
  FunctionNotAllowed: -32012,
  Timeout: -32013,
  ActionFailed: -32014,
} as const;

/** A failed request: the message of the error response, with its code. */
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

/** Default timeout of a request, in milliseconds (section 6). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** The window the app posts to, and the one whose messages it accepts. */
export interface BridgePeer {
  postMessage(message: unknown, targetOrigin: string): void;
}

/** Where `message` events arrive; `window` in the frame, a fake in tests. */
export interface BridgeEventSource {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** A message the client sent or received, for logging. */
export interface BridgeTraffic {
  readonly direction: 'out' | 'in';
  readonly message: Readonly<Record<string, unknown>>;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * JSON-RPC client of the app frame.
 *
 * Requests get increasing ids and a timeout; a response that arrives after the timeout is
 * ignored. Notifications from the host go to the handler registered for their method. Messages
 * from any window other than `peer` are ignored, which keeps the proxy's own handshake messages
 * and anything else out.
 */
export class BridgeClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly handlers = new Map<string, (params: Record<string, unknown>) => void>();
  private readonly listener = (event: MessageEvent) => this.handleMessage(event);

  constructor(
    private readonly peer: BridgePeer,
    private readonly events: BridgeEventSource,
    private readonly onTraffic?: (traffic: BridgeTraffic) => void,
  ) {
    events.addEventListener('message', this.listener);
  }

  /** Sends a request and resolves with its result; rejects with a {@link BridgeError}. */
  request<R = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<R> {
    const id = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BridgeError(
            `The host did not answer ${method} within ${timeoutMs} ms.`,
            BridgeErrorCode.Timeout,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {resolve: value => resolve(value as R), reject, timer});
      this.post({jsonrpc: '2.0', id, method, params});
    });
  }

  /** Sends a notification. */
  notify(method: string, params: Record<string, unknown>): void {
    this.post({jsonrpc: '2.0', method, params});
  }

  /** Handles the host notification `method`; a later call replaces the handler. */
  onNotification(method: string, handler: (params: Record<string, unknown>) => void): void {
    this.handlers.set(method, handler);
  }

  /** Stops listening and fails every pending request. */
  dispose(): void {
    this.events.removeEventListener('message', this.listener);
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new BridgeError('The bridge was closed.', BridgeErrorCode.InternalError));
      this.pending.delete(id);
    }
  }

  private post(message: Record<string, unknown>): void {
    this.onTraffic?.({direction: 'out', message});
    // The frame's own origin is opaque, and the proxy relays by window identity, so "*" is the
    // only target origin that reaches it.
    this.peer.postMessage(message, '*');
  }

  private handleMessage(event: MessageEvent): void {
    if (event.source !== (this.peer as unknown)) {
      return;
    }
    const data: unknown = event.data;
    if (!isRecord(data) || data['jsonrpc'] !== '2.0') {
      return;
    }
    this.onTraffic?.({direction: 'in', message: data});
    if (typeof data['method'] === 'string') {
      if (data['id'] !== undefined) {
        // The host never sends requests in version 1 of the protocol.
        this.post({
          jsonrpc: '2.0',
          id: data['id'],
          error: {
            code: BridgeErrorCode.MethodNotFound,
            message: `Unknown method ${data['method']}`,
          },
        });
        return;
      }
      const handler = this.handlers.get(data['method']);
      handler?.(isRecord(data['params']) ? data['params'] : {});
      return;
    }
    const id = data['id'];
    if (typeof id !== 'number') {
      return;
    }
    const request = this.pending.get(id);
    if (!request) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(request.timer);
    const error = data['error'];
    if (isRecord(error)) {
      request.reject(
        new BridgeError(
          typeof error['message'] === 'string' ? error['message'] : 'Request failed.',
          typeof error['code'] === 'number' ? error['code'] : BridgeErrorCode.InternalError,
          error['data'],
        ),
      );
      return;
    }
    request.resolve(isRecord(data['result']) ? data['result'] : {});
  }
}
