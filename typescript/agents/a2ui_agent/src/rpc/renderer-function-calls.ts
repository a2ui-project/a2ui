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

import {
  A2uiRpcError,
  type CallRendererFunctionMessage,
  type CatalogApi,
  isValidUax31Identifier,
  type RendererFunctionResponseMessage,
  RpcErrorCode,
} from '../internal/web-core.js';

/**
 * Default timeout in milliseconds (`30_000` ms = 30 seconds) that a `callRendererFunction`
 * waits for its `rendererFunctionResponse`, matching the renderer's default `callAgentFunction`
 * timeout.
 */
export const DEFAULT_RENDERER_CALL_TIMEOUT_MS = 30_000;

/**
 * Default timeout in seconds (`30.0`) for `callRendererFunction` requests.
 */
export const DEFAULT_RENDERER_CALL_TIMEOUT = 30.0;

const ALLOWED_TOP_LEVEL_KEYS = new Set(['version', 'rendererFunctionResponse']);
const ALLOWED_BODY_KEYS = new Set(['functionCallId', 'value', 'error']);
const ALLOWED_ERROR_KEYS = new Set(['code', 'message']);

/**
 * A `Promise` representing a pending renderer function call that can also be
 * cancelled via {@link CancellablePromise.cancel}.
 */
export interface CancellablePromise<T> extends Promise<T> {
  /**
   * Cancels the pending call, rejecting this promise with {@link A2uiRpcError}
   * (`code: RpcErrorCode.CANCELLED`) and removing its `functionCallId` from
   * the pending calls map.
   */
  cancel(reason?: string): void;
}

/**
 * Return value of {@link RendererFunctionCalls.call}, supporting both tuple
 * destructuring (`const [message, result] = calls.call(...)`) and named
 * property destructuring (`const {message, result, functionCallId, cancel} = calls.call(...)`).
 */
export type PendingRendererCall<T = unknown> = readonly [
  CallRendererFunctionMessage,
  CancellablePromise<T>,
] & {
  readonly message: CallRendererFunctionMessage;
  readonly result: CancellablePromise<T>;
  readonly functionCallId: string;
  readonly cancel: (reason?: string) => void;
};

/**
 * Options for configuring {@link RendererFunctionCalls}.
 */
export interface RendererFunctionCallsOptions {
  /**
   * Default timeout in milliseconds for each call. Defaults to `30_000` (30s).
   * Pass `null` to disable the default timeout.
   */
  readonly defaultTimeoutMs?: number | null;
  /**
   * Maximum number of concurrent pending calls allowed.
   * Pass `null` or omit for no limit.
   */
  readonly maxPending?: number | null;
  /** Optional catalogs declaring renderer functions to check permissions on call. */
  readonly catalogs?: readonly CatalogApi[];
}

/**
 * Parameters for {@link RendererFunctionCalls.call}.
 */
export interface CallRendererFunctionOptions {
  /** Required catalog identifier declaring the renderer function. */
  readonly catalogId: string;
  /** Name of the renderer function to invoke (must be a valid UAX #31 identifier). */
  readonly name: string;
  /** Optional arguments object (keys must be valid UAX #31 identifiers). */
  readonly args?: Record<string, unknown>;
  /** Optional target surface ID whose data model provides evaluation context. */
  readonly surfaceId?: string;
  /**
   * Optional per-call timeout in milliseconds, overriding `defaultTimeoutMs`.
   * Pass `null` to disable the timeout for this call.
   */
  readonly timeoutMs?: number | null;
  /** Optional custom `functionCallId`. When omitted, a UUID is generated. */
  readonly functionCallId?: string;
}

interface PendingEntry {
  readonly functionCallId: string;
  readonly name: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: A2uiRpcError) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Builds outbound `callRendererFunction` messages and correlates inbound
 * `rendererFunctionResponse` messages with their pending result promises.
 */
export class RendererFunctionCalls {
  private readonly _defaultTimeoutMs: number | null;
  private readonly _maxPending: number | null;
  private readonly _catalogs?: readonly CatalogApi[];
  private readonly _pending = new Map<string, PendingEntry>();
  private _disposed = false;

  /**
   * Creates a new `RendererFunctionCalls` correlation tracker.
   *
   * @param options Optional default timeout and maximum pending calls limit.
   * @throws {RangeError} If `defaultTimeoutMs <= 0` or `maxPending < 1`.
   */
  constructor(options?: RendererFunctionCallsOptions) {
    if (options?.defaultTimeoutMs === undefined) {
      this._defaultTimeoutMs = DEFAULT_RENDERER_CALL_TIMEOUT_MS;
    } else if (options.defaultTimeoutMs === null) {
      this._defaultTimeoutMs = null;
    } else {
      if (
        typeof options.defaultTimeoutMs !== 'number' ||
        !Number.isFinite(options.defaultTimeoutMs) ||
        options.defaultTimeoutMs <= 0
      ) {
        throw new RangeError('defaultTimeoutMs must be greater than 0.');
      }
      this._defaultTimeoutMs = options.defaultTimeoutMs;
    }

    if (options?.maxPending === undefined || options.maxPending === null) {
      this._maxPending = null;
    } else {
      if (!Number.isInteger(options.maxPending) || options.maxPending < 1) {
        throw new RangeError('maxPending must be at least 1.');
      }
      this._maxPending = options.maxPending;
    }
    this._catalogs = options?.catalogs;
  }

  /**
   * Number of calls currently awaiting a `rendererFunctionResponse`.
   */
  get pendingCount(): number {
    return this._pending.size;
  }

  /**
   * Whether `dispose()` has been called on this tracker.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Builds a `callRendererFunction` message and registers a pending result promise.
   *
   * @template T Expected return value type from the renderer function.
   * @param options Call parameters (`catalogId`, `name`, `args`, `surfaceId`, `timeoutMs`, `functionCallId`).
   * @returns A {@link PendingRendererCall} containing `[message, result]`.
   * @throws {RangeError} If `options.timeoutMs <= 0`.
   * @throws {A2uiRpcError} With `DISPOSED`, `DUPLICATE`, `TOO_MANY_PENDING`, or `INVALID_FUNCTION_CALL`.
   */
  call<T = unknown>(options: CallRendererFunctionOptions): PendingRendererCall<T> {
    if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
      if (
        typeof options.timeoutMs !== 'number' ||
        !Number.isFinite(options.timeoutMs) ||
        options.timeoutMs <= 0
      ) {
        throw new RangeError('timeoutMs must be greater than 0.');
      }
    }

    if (this._disposed) {
      throw new A2uiRpcError('RendererFunctionCalls has been disposed.', RpcErrorCode.DISPOSED);
    }

    let callId: string;
    if (options.functionCallId !== undefined) {
      if (typeof options.functionCallId !== 'string' || options.functionCallId.length === 0) {
        throw new A2uiRpcError(
          'functionCallId must not be empty.',
          RpcErrorCode.INVALID_FUNCTION_CALL,
        );
      }
      callId = options.functionCallId;
    } else {
      callId = generateCallId();
    }

    if (this._pending.has(callId)) {
      throw new A2uiRpcError(
        `A renderer function call with id '${callId}' is already pending.`,
        RpcErrorCode.DUPLICATE,
        callId,
      );
    }

    if (this._maxPending !== null && this._pending.size >= this._maxPending) {
      throw new A2uiRpcError(
        `Too many pending renderer function calls (limit is ${this._maxPending}).`,
        RpcErrorCode.TOO_MANY_PENDING,
        callId,
      );
    }

    if (typeof options.catalogId !== 'string' || options.catalogId.length === 0) {
      throw new A2uiRpcError(
        'catalogId must not be empty.',
        RpcErrorCode.INVALID_FUNCTION_CALL,
        callId,
      );
    }

    if (this._catalogs) {
      const cat = this._catalogs.find(c => c.id === options.catalogId);
      if (cat) {
        const fn = cat.functions?.get(options.name);
        if (fn) {
          const callers = fn.allowedCallers ?? 'rendererOnly';
          if (callers !== 'agentOnly' && callers !== 'rendererOrAgent') {
            throw new A2uiRpcError(
              `Function '${options.name}' cannot be called by agent (allowedCallers is ${callers}).`,
              RpcErrorCode.INVALID_FUNCTION_CALL,
              callId,
            );
          }
          if (fn.requiresUserActivation) {
            throw new A2uiRpcError(
              `Function '${options.name}' requires user activation.`,
              RpcErrorCode.INVALID_FUNCTION_CALL,
              callId,
            );
          }
        }
      }
    }

    if (typeof options.name !== 'string' || !isValidUax31Identifier(options.name)) {
      throw new A2uiRpcError(
        `Function name '${String(options.name)}' must be a valid UAX #31 identifier.`,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        callId,
      );
    }

    if (
      options.surfaceId !== undefined &&
      (typeof options.surfaceId !== 'string' || options.surfaceId.length === 0)
    ) {
      throw new A2uiRpcError(
        'surfaceId must not be empty when provided.',
        RpcErrorCode.INVALID_FUNCTION_CALL,
        callId,
      );
    }

    if (options.args !== undefined) {
      if (!isPlainObject(options.args)) {
        throw new A2uiRpcError(
          'args must be a plain object.',
          RpcErrorCode.INVALID_FUNCTION_CALL,
          callId,
        );
      }
      for (const argName of Object.keys(options.args)) {
        if (!isValidUax31Identifier(argName)) {
          throw new A2uiRpcError(
            `Argument name '${argName}' in call to '${options.name}' must be a valid UAX #31 identifier.`,
            RpcErrorCode.INVALID_FUNCTION_CALL,
            callId,
          );
        }
      }
    }

    const message: CallRendererFunctionMessage = {
      version: '1.0',
      callRendererFunction: {
        ...(options.surfaceId !== undefined ? {surfaceId: options.surfaceId} : {}),
        functionCallId: callId,
        callFunction: {
          '@call': options.name,
          catalogId: options.catalogId,
          args: {...(options.args ?? {})},
        },
      },
    };

    const effectiveTimeoutMs =
      options.timeoutMs === undefined ? this._defaultTimeoutMs : options.timeoutMs;

    let resolveFn!: (value: unknown) => void;
    let rejectFn!: (error: A2uiRpcError) => void;

    const rawPromise = new Promise<T>((resolve, reject) => {
      resolveFn = resolve as (value: unknown) => void;
      rejectFn = reject;
    });

    // Attach a no-op rejection handler so that rejections occurring before the
    // caller awaits `result` (e.g., via `resolve`, `dispose`, `cancel`, or timeout)
    // do not trigger Node/V8 `UnhandledPromiseRejection` crashes.
    rawPromise.catch(() => {});

    const entry: PendingEntry = {
      functionCallId: callId,
      name: options.name,
      resolve: resolveFn,
      reject: rejectFn,
    };

    if (effectiveTimeoutMs !== null) {
      entry.timer = setTimeout(() => {
        const current = this._pending.get(callId);
        if (current !== entry) return;
        this._pending.delete(callId);
        entry.reject(
          new A2uiRpcError(
            `Renderer function '${options.name}' timed out after ${effectiveTimeoutMs}ms.`,
            RpcErrorCode.TIMEOUT,
            callId,
          ),
        );
      }, effectiveTimeoutMs);
    }

    this._pending.set(callId, entry);

    const cancel = (reason?: string): void => {
      const current = this._pending.get(callId);
      if (current !== entry) return;
      this._pending.delete(callId);
      if (entry.timer !== undefined) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
      entry.reject(
        new A2uiRpcError(
          reason ?? `Renderer function call '${options.name}' ('${callId}') was cancelled.`,
          RpcErrorCode.CANCELLED,
          callId,
        ),
      );
    };

    const result = Object.assign(rawPromise, {cancel}) as CancellablePromise<T>;

    const tuple = [message, result] as unknown as PendingRendererCall<T>;
    Object.defineProperties(tuple, {
      message: {value: message, enumerable: false},
      result: {value: result, enumerable: false},
      functionCallId: {value: callId, enumerable: false},
      cancel: {value: cancel, enumerable: false},
    });
    return tuple;
  }

  /**
   * Tracks an already constructed callRendererFunction message and registers a pending promise.
   */
  track<T = unknown>(
    message: CallRendererFunctionMessage | Record<string, unknown>,
    timeoutMs?: number | null,
  ): CancellablePromise<T> {
    if (this._disposed) {
      throw new A2uiRpcError('RendererFunctionCalls has been disposed.', RpcErrorCode.DISPOSED);
    }
    const callBody = (
      'callRendererFunction' in message
        ? (message as CallRendererFunctionMessage).callRendererFunction
        : (message as unknown as Record<string, unknown>)
    ) as Record<string, unknown>;
    const callId = typeof callBody['functionCallId'] === 'string' ? (callBody['functionCallId'] as string) : '';
    const callFn = (callBody['callFunction'] ?? {}) as Record<string, unknown>;
    const name = typeof callFn['@call'] === 'string' ? (callFn['@call'] as string) : '';

    if (!callId) {
      throw new A2uiRpcError('functionCallId must not be empty.', RpcErrorCode.INVALID_FUNCTION_CALL);
    }
    if (this._pending.has(callId)) {
      throw new A2uiRpcError(
        `A renderer function call with id '${callId}' is already pending.`,
        RpcErrorCode.DUPLICATE,
        callId,
      );
    }
    if (this._maxPending !== null && this._pending.size >= this._maxPending) {
      throw new A2uiRpcError(
        `Too many pending renderer function calls (limit is ${this._maxPending}).`,
        RpcErrorCode.TOO_MANY_PENDING,
        callId,
      );
    }

    let settlePromise: ((value: T) => void) | undefined;
    let failPromise: ((error: A2uiRpcError) => void) | undefined;
    const promise = new Promise<T>((resolve, reject) => {
      settlePromise = resolve;
      failPromise = reject;
    }) as CancellablePromise<T>;

    const effectiveTimeoutMs = timeoutMs !== undefined ? timeoutMs : this._defaultTimeoutMs;
    const entry: PendingEntry = {
      functionCallId: callId,
      name,
      resolve: settlePromise as (value: unknown) => void,
      reject: failPromise as (error: A2uiRpcError) => void,
    };
    if (effectiveTimeoutMs !== null) {
      entry.timer = setTimeout(() => {
        this._pending.delete(callId);
        failPromise?.(
          new A2uiRpcError(
            `Renderer function call '${name}' (${callId}) timed out after ${effectiveTimeoutMs}ms.`,
            RpcErrorCode.TIMEOUT,
            callId,
          ),
        );
      }, effectiveTimeoutMs);
    }
    promise.cancel = (reason?: string) => {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      this._pending.delete(callId);
      failPromise?.(
        new A2uiRpcError(
          reason ?? `Renderer function call '${name}' (${callId}) was cancelled.`,
          RpcErrorCode.CANCELLED,
          callId,
        ),
      );
    };
    this._pending.set(callId, entry);
    return promise;
  }

  /**
   * Settles the pending call matching `message.rendererFunctionResponse.functionCallId`.
   *
   * Responses with an unknown `functionCallId`, duplicate responses, late responses
   * arriving after a timeout or cancellation, and malformed responses are ignored
   * without throwing.
   *
   * @param message Inbound `rendererFunctionResponse` message.
   */
  resolve(message: RendererFunctionResponseMessage | Record<string, unknown>): void {
    const parsed = parseRendererFunctionResponse(message);
    if (!parsed) return;

    const pending = this._pending.get(parsed.functionCallId);
    if (!pending) return;

    this._pending.delete(parsed.functionCallId);
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
      pending.timer = undefined;
    }

    if (parsed.error !== undefined) {
      pending.reject(
        new A2uiRpcError(
          `Renderer function '${pending.name}' failed (${parsed.error.code}): ${parsed.error.message}`,
          parsed.error.code,
          parsed.functionCallId,
          parsed.error,
        ),
      );
    } else {
      pending.resolve(parsed.value);
    }
  }

  /**
   * Fails all currently pending calls with {@link A2uiRpcError}
   * (`code: RpcErrorCode.CANCELLED`) and rejects future calls with
   * `code: RpcErrorCode.DISPOSED`.
   *
   * Idempotent: calling `dispose()` on an already-disposed tracker is a no-op.
   *
   * @param reason Human-readable disposal reason included in the `CANCELLED` error message.
   */
  dispose(reason = 'RendererFunctionCalls was disposed.'): void {
    if (this._disposed) return;
    this._disposed = true;

    const entries = [...this._pending.values()];
    this._pending.clear();
    for (const entry of entries) {
      if (entry.timer !== undefined) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
      entry.reject(new A2uiRpcError(reason, RpcErrorCode.CANCELLED, entry.functionCallId));
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function generateCallId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const randSuffix = Math.random().toString(36).substring(2, 15).padEnd(13, '0');
  return `call-${Date.now()}-${randSuffix}`;
}

type ParsedResponse =
  | {readonly functionCallId: string; readonly value: unknown; readonly error?: undefined}
  | {
      readonly functionCallId: string;
      readonly value?: undefined;
      readonly error: {readonly code: string; readonly message: string};
    };

function parseRendererFunctionResponse(message: unknown): ParsedResponse | undefined {
  if (!isPlainObject(message)) return undefined;
  for (const key of Object.keys(message)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) return undefined;
  }
  if (message['version'] !== '1.0') return undefined;

  const rawBody = message['rendererFunctionResponse'];
  if (!isPlainObject(rawBody)) return undefined;
  for (const key of Object.keys(rawBody)) {
    if (!ALLOWED_BODY_KEYS.has(key)) return undefined;
  }

  const functionCallId = rawBody['functionCallId'];
  if (typeof functionCallId !== 'string' || functionCallId.length === 0) {
    return undefined;
  }

  const hasValueProp = Object.hasOwn(rawBody, 'value');
  const hasErrorProp =
    Object.hasOwn(rawBody, 'error') && rawBody['error'] !== undefined && rawBody['error'] !== null;

  if (hasErrorProp) {
    if (hasValueProp && rawBody['value'] !== undefined) {
      return undefined;
    }
    const rawError = rawBody['error'];
    if (!isPlainObject(rawError)) return undefined;
    for (const key of Object.keys(rawError)) {
      if (!ALLOWED_ERROR_KEYS.has(key)) return undefined;
    }
    const code = rawError['code'];
    const errMsg = rawError['message'];
    if (typeof code !== 'string' || code.length === 0) return undefined;
    if (typeof errMsg !== 'string' || errMsg.length === 0) return undefined;
    return {
      functionCallId,
      error: {code, message: errMsg},
    };
  }

  if (!hasValueProp) {
    return undefined;
  }

  return {
    functionCallId,
    value: rawBody['value'],
  };
}
