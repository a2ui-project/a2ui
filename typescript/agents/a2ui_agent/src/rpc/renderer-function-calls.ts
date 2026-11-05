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
  A2uiCatalogError,
  A2uiRpcError,
  type CatalogInterface,
  type ComponentApi,
  type FunctionApi,
  type CallRendererFunctionMessage,
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
  /**
   * The catalogs the renderer was sent. When given, `call` checks that the
   * target catalog declares the function as a renderer function (not an
   * agent function) and lets the agent call it
   * (`allowedCallers` is `rendererOrAgent` or `agentOnly`, and it doesn't
   * require user activation) before anything is sent. Without them, calls
   * aren't checked against a catalog.
   */
  readonly catalogs?: Iterable<CatalogInterface<ComponentApi, FunctionApi>>;
}

/**
 * Parameters for {@link RendererFunctionCalls.call}.
 */
export interface CallRendererFunctionOptions {
  /** Required catalog identifier declaring the renderer function. */
  readonly catalogId: string;
  /** Name of the renderer function to invoke (must be a valid UAX #31 identifier). */
  readonly name: string;
  /**
   * Optional arguments: a JSON object whose keys are valid UAX #31
   * identifiers and whose values are JSON values (no NaN or infinity).
   */
  readonly args?: Record<string, unknown>;
  /**
   * Optional target surface ID whose data model provides evaluation context.
   * An empty string counts as omitted.
   */
  readonly surfaceId?: string;
  /**
   * Optional per-call timeout in milliseconds, a finite number greater than
   * 0, overriding `defaultTimeoutMs`. When omitted, `defaultTimeoutMs`
   * applies; only `defaultTimeoutMs: null` disables timeouts.
   */
  readonly timeoutMs?: number;
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
 *
 * `resolve` is bound to the instance, so it can be passed straight to
 * `RendererToAgentMessageProcessor` as `onRendererFunctionResponse`:
 *
 * ```ts
 * const calls = new RendererFunctionCalls();
 * const processor = new RendererToAgentMessageProcessor({
 *   catalogs,
 *   onRendererFunctionResponse: calls.resolve,
 * });
 * ```
 */
export class RendererFunctionCalls {
  private readonly _defaultTimeoutMs: number | null;
  private readonly _maxPending: number | null;
  private readonly _pending = new Map<string, PendingEntry>();
  private readonly _catalogs?: ReadonlyMap<string, CatalogInterface<ComponentApi, FunctionApi>>;
  private _disposed = false;

  /**
   * Creates a new `RendererFunctionCalls` correlation tracker.
   *
   * @param options Optional default timeout and maximum pending calls limit.
   * @throws {RangeError} If `defaultTimeoutMs <= 0` or `maxPending < 1`.
   * @throws {A2uiCatalogError} If two of `catalogs` have the same id.
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
    if (options?.catalogs !== undefined) {
      const catalogs = new Map<string, CatalogInterface<ComponentApi, FunctionApi>>();
      for (const catalog of options.catalogs) {
        if (catalogs.has(catalog.id)) {
          throw new A2uiCatalogError(`Two catalogs have the id '${catalog.id}'.`);
        }
        catalogs.set(catalog.id, catalog);
      }
      this._catalogs = catalogs;
    }
    this.resolve = this.resolve.bind(this);
  }

  /**
   * Number of calls currently awaiting a `rendererFunctionResponse`.
   */
  get pendingCount(): number {
    return this._pending.size;
  }

  /**
   * Whether a call with `functionCallId` is currently awaiting a renderer
   * response.
   *
   * @param functionCallId The call's id.
   * @returns `true` from `call` until the call is resolved, fails, times
   *   out, is cancelled or the tracker is disposed.
   */
  isPending(functionCallId: string): boolean {
    return this._pending.has(functionCallId);
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
   * The checks run in this order, each before anything is built, registered
   * or timed: the timeout; disposal (`DISPOSED`); an empty given
   * `functionCallId`; a pending id (`DUPLICATE`); `maxPending`
   * (`TOO_MANY_PENDING`); an empty `name`, then an empty `catalogId`; a `name`
   * that isn't a UAX #31 identifier or starts with `@`; the `args`; and, with
   * `catalogs`, the target (`UNKNOWN_FUNCTION` or `INVALID_FUNCTION_CALL`). An
   * empty `surfaceId` counts as omitted.
   *
   * @throws {RangeError} If `options.timeoutMs` isn't a finite number greater than 0.
   * @throws {A2uiRpcError} With `DISPOSED`, `DUPLICATE`, `TOO_MANY_PENDING`,
   *   `UNKNOWN_FUNCTION` or `INVALID_FUNCTION_CALL`.
   */
  call<T = unknown>(options: CallRendererFunctionOptions): PendingRendererCall<T> {
    // A runtime null counts as omitted: the instance default applies.
    const timeoutMs = options.timeoutMs ?? undefined;
    if (timeoutMs !== undefined) {
      if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError('timeoutMs must be a finite number greater than 0.');
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

    if (typeof options.name !== 'string' || options.name.length === 0) {
      throw new A2uiRpcError(
        'The call needs a function name.',
        RpcErrorCode.INVALID_FUNCTION_CALL,
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

    if (options.name.startsWith('@') || !isValidUax31Identifier(options.name)) {
      throw new A2uiRpcError(
        `Function name '${options.name}' must be a valid UAX #31 identifier that doesn't start with '@'.`,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        callId,
      );
    }

    if (options.args !== undefined) {
      if (!isJsonObject(options.args)) {
        throw new A2uiRpcError(
          `The args of the call to '${options.name}' must be a JSON object.`,
          RpcErrorCode.INVALID_FUNCTION_CALL,
          callId,
        );
      }
      for (const [argName, value] of Object.entries(options.args)) {
        if (!isValidUax31Identifier(argName)) {
          throw new A2uiRpcError(
            `Argument name '${argName}' in call to '${options.name}' must be a valid UAX #31 identifier.`,
            RpcErrorCode.INVALID_FUNCTION_CALL,
            callId,
          );
        }
        if (!isJsonValue(value, new Set())) {
          throw new A2uiRpcError(
            `Argument '${argName}' in call to '${options.name}' must be a JSON value: null, a boolean, a string, a finite number, or an array or object of these.`,
            RpcErrorCode.INVALID_FUNCTION_CALL,
            callId,
          );
        }
      }
    }

    if (this._catalogs !== undefined) {
      this._checkTarget(options.catalogId, options.name, callId);
    }

    // An empty surfaceId counts as omitted, since a renderer rejects one.
    const surfaceId = options.surfaceId === '' ? undefined : options.surfaceId;
    if (surfaceId !== undefined && typeof surfaceId !== 'string') {
      throw new A2uiRpcError(
        'surfaceId must be a string when provided.',
        RpcErrorCode.INVALID_FUNCTION_CALL,
        callId,
      );
    }

    const message: CallRendererFunctionMessage = {
      version: '1.0',
      callRendererFunction: {
        ...(surfaceId !== undefined ? {surfaceId} : {}),
        functionCallId: callId,
        callFunction: {
          '@call': options.name,
          catalogId: options.catalogId,
          args: {...(options.args ?? {})},
        },
      },
    };

    const effectiveTimeoutMs = timeoutMs ?? this._defaultTimeoutMs;

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
   * Settles the pending call matching `message.rendererFunctionResponse.functionCallId`.
   *
   * Responses with an unknown `functionCallId`, duplicate responses, and late
   * responses arriving after a timeout or cancellation are ignored without
   * throwing. A malformed response that carries the `functionCallId` of a
   * pending call fails that call right away with `UNKNOWN_ERROR`, rather than
   * leaving it to time out; any other malformed response is ignored.
   *
   * Used as `onRendererFunctionResponse`, it therefore declines the responses
   * it doesn't own, such as those to calls the model wrote, so they reach the
   * model.
   *
   * @param message Inbound `rendererFunctionResponse` message.
   * @returns `true` if the response settled or failed a pending call, `false`
   *   if its `functionCallId` isn't pending (unknown, late or a duplicate).
   */
  resolve(message: RendererFunctionResponseMessage | Record<string, unknown>): boolean {
    const parsed = parseRendererFunctionResponse(message);
    if (!parsed) {
      const callId = rawFunctionCallId(message);
      const pending = callId === undefined ? undefined : this._pending.get(callId);
      if (pending === undefined) return false;
      this._settle(pending);
      pending.reject(
        new A2uiRpcError(
          `Malformed rendererFunctionResponse for renderer function '${pending.name}'.`,
          RpcErrorCode.UNKNOWN_ERROR,
          pending.functionCallId,
        ),
      );
      return true;
    }

    const pending = this._pending.get(parsed.functionCallId);
    if (!pending) return false;

    this._settle(pending);

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
    return true;
  }

  /**
   * Throws if the catalogs don't let the agent call `name` in `catalogId`.
   */
  private _checkTarget(catalogId: string, name: string, callId: string): void {
    const catalog = this._catalogs!.get(catalogId);
    if (catalog === undefined) {
      throw new A2uiRpcError(
        `No catalog has the id '${catalogId}', so the agent can't call '${name}' in it.`,
        RpcErrorCode.UNKNOWN_FUNCTION,
        callId,
      );
    }
    // An agent function runs on the agent, so the renderer can't run it.
    const fn = catalog.rendererFunctions.get(name);
    if (fn === undefined) {
      throw new A2uiRpcError(
        `Catalog '${catalogId}' has no renderer function '${name}'.`,
        RpcErrorCode.UNKNOWN_FUNCTION,
        callId,
      );
    }
    const allowedCallers = fn.allowedCallers ?? 'rendererOnly';
    if (allowedCallers === 'rendererOnly') {
      throw new A2uiRpcError(
        `Function '${name}' in catalog '${catalogId}' is rendererOnly, so the agent may not call it.`,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        callId,
      );
    }
    if (fn.requiresUserActivation === true) {
      throw new A2uiRpcError(
        `Function '${name}' in catalog '${catalogId}' requires user activation, and a call from the agent has no user gesture.`,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        callId,
      );
    }
  }

  /** Removes a pending call and clears its timer. */
  private _settle(pending: PendingEntry): void {
    this._pending.delete(pending.functionCallId);
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
      pending.timer = undefined;
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

/** Whether `value` is a plain object, as JSON parses an object. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Whether `value` is a JSON value: null, a boolean, a string, a finite number,
 * or an array or plain object of these, recursively. A cycle isn't one.
 */
function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  let items: unknown[];
  if (Array.isArray(value)) {
    items = Array.from(value);
  } else if (isJsonObject(value)) {
    items = Object.values(value);
  } else {
    return false;
  }
  ancestors.add(value);
  const ok = items.every(item => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return ok;
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

/** The non-empty `functionCallId` of a response, however malformed the rest. */
function rawFunctionCallId(message: unknown): string | undefined {
  if (!isPlainObject(message)) return undefined;
  const body = message['rendererFunctionResponse'];
  if (!isPlainObject(body)) return undefined;
  const callId = body['functionCallId'];
  return typeof callId === 'string' && callId.length > 0 ? callId : undefined;
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

  // A body has exactly one of `value` and `error`, as the processor's schema
  // requires; `error: null` is a malformed error, not a missing one.
  const hasValueProp = Object.hasOwn(rawBody, 'value') && rawBody['value'] !== undefined;
  const hasErrorProp = Object.hasOwn(rawBody, 'error') && rawBody['error'] !== undefined;

  if (hasErrorProp) {
    if (hasValueProp) {
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
