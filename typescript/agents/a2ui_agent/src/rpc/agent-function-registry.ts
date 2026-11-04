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
  A2uiValidationError,
  AgentFunction,
  type AgentFunctionContext,
  type AgentFunctionResponseMessage,
  type CallAgentFunctionMessage,
  type CatalogInterface,
  PayloadValidator,
  RpcErrorCode,
  STRICT_VALIDATION,
} from '../internal/web-core.js';

const ALLOWED_TOP_LEVEL_KEYS = new Set(['version', 'callAgentFunction']);
const ALLOWED_BODY_KEYS = new Set(['surfaceId', 'functionCallId', 'callFunction']);
const ALLOWED_CALL_FUNCTION_KEYS = new Set(['@call', 'catalogId', 'args', 'returnType']);
const ALLOWED_RETURN_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'any',
  'void',
]);

/**
 * Options for configuring an {@link AgentFunctionRegistry}.
 */
export interface AgentFunctionRegistryOptions {
  /**
   * Maximum number of agent function handlers that may run concurrently.
   * Must be an integer >= 1 when provided.
   */
  readonly maxConcurrency?: number;
  /**
   * Default timeout in milliseconds for each handler call.
   * Must be > 0 when provided.
   */
  readonly timeoutMs?: number;
}

/**
 * Per-call options for {@link AgentFunctionRegistry.handle}.
 */
export interface HandleAgentFunctionOptions {
  /**
   * Per-call timeout in milliseconds, overriding the registry default.
   * Pass `null` to disable the registry default timeout for this call.
   * Must be > 0 when a number is provided.
   */
  readonly timeoutMs?: number | null;
  /**
   * Optional `AbortSignal` to cancel this call.
   */
  readonly signal?: AbortSignal;
}

interface ParsedCallEnvelope {
  readonly surfaceId: string;
  readonly functionCallId: string;
  readonly name: string;
  readonly catalogId?: string;
  readonly args?: Record<string, unknown>;
}

/**
 * Indexes agent functions across catalogs and handles inbound `callAgentFunction`
 * RPC messages from the renderer.
 *
 * A call that fails after its `functionCallId` is known produces an
 * `agentFunctionResponse` with `error` rather than throwing, so the renderer's
 * pending `callAgentFunction` promise settles cleanly instead of hanging until
 * its timeout. A message without a usable `functionCallId` cannot be answered
 * and throws {@link A2uiValidationError}.
 */
export class AgentFunctionRegistry {
  private readonly _catalogs = new Map<string, CatalogInterface>();
  private readonly _functions = new Map<string, Map<string, AgentFunction>>();
  private readonly _maxConcurrency?: number;
  private readonly _timeoutMs?: number;
  private _activeCount = 0;
  private readonly _waitQueue: Array<{
    acquire: () => void;
    cancel: () => void;
    reject: (err: A2uiRpcError) => void;
    functionCallId: string;
  }> = [];
  private readonly _inFlightDisposers = new Map<
    symbol,
    {reject: (err: A2uiRpcError) => void; functionCallId: string}
  >();
  private _disposed = false;

  /**
   * Indexes the `agentFunctions` of each catalog by `(catalog.id, name)`.
   *
   * @param catalogs Catalogs whose `agentFunctions` should be registered.
   * @param options Optional concurrency limit and default handler timeout.
   * @throws {RangeError} If `maxConcurrency < 1` or `timeoutMs <= 0`.
   */
  constructor(catalogs: Iterable<CatalogInterface>, options?: AgentFunctionRegistryOptions) {
    if (options?.maxConcurrency !== undefined) {
      if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
        throw new RangeError('maxConcurrency must be at least 1.');
      }
      this._maxConcurrency = options.maxConcurrency;
    }
    if (options?.timeoutMs !== undefined) {
      if (
        typeof options.timeoutMs !== 'number' ||
        !Number.isFinite(options.timeoutMs) ||
        options.timeoutMs <= 0
      ) {
        throw new RangeError('timeoutMs must be greater than 0.');
      }
      this._timeoutMs = options.timeoutMs;
    }

    for (const catalog of catalogs) {
      this._catalogs.set(catalog.id, catalog);
      if (catalog.agentFunctions.size > 0) {
        const byName = new Map(this._functions.get(catalog.id) ?? []);
        for (const [name, fn] of catalog.agentFunctions.entries()) {
          byName.set(name, fn);
        }
        this._functions.set(catalog.id, byName);
      }
    }
  }

  /**
   * Whether this registry has been disposed.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Read-only view of all indexed agent functions, grouped by `catalogId` and function `name`.
   */
  get functions(): ReadonlyMap<string, ReadonlyMap<string, AgentFunction>> {
    return this._functions;
  }

  /**
   * Looks up the {@link AgentFunction} registered for `(catalogId, name)`.
   *
   * @param catalogId Identifier of the catalog declaring the function.
   * @param name Name of the agent function.
   * @returns The registered {@link AgentFunction}, or `undefined` if not found.
   */
  get(catalogId: string, name: string): AgentFunction | undefined {
    return this._functions.get(catalogId)?.get(name);
  }

  /**
   * Disposes this registry, rejecting all in-flight and queued `handle` calls
   * with {@link A2uiRpcError} (`code: RpcErrorCode.DISPOSED`).
   *
   * Idempotent: calling `dispose()` on an already-disposed registry is a no-op.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    const queued = this._waitQueue.splice(0);
    for (const waiter of queued) {
      waiter.reject(
        new A2uiRpcError(
          'The agent function registry was disposed while handling the call.',
          RpcErrorCode.DISPOSED,
          waiter.functionCallId,
        ),
      );
    }

    const inFlight = [...this._inFlightDisposers.values()];
    this._inFlightDisposers.clear();
    for (const entry of inFlight) {
      entry.reject(
        new A2uiRpcError(
          'The agent function registry was disposed while handling the call.',
          RpcErrorCode.DISPOSED,
          entry.functionCallId,
        ),
      );
    }
  }

  /**
   * Validates, routes, and executes a `callAgentFunction` message, returning
   * its `agentFunctionResponse` envelope.
   *
   * @param message Inbound `callAgentFunction` message.
   * @param options Optional per-call timeout or `AbortSignal`.
   * @returns The outbound `agentFunctionResponse` message.
   * @throws {RangeError} If `options.timeoutMs <= 0`.
   * @throws {A2uiRpcError} With `code: RpcErrorCode.DISPOSED` if the registry is disposed before or during the call.
   * @throws {A2uiValidationError} If the message lacks a usable `functionCallId`.
   */
  async handle(
    message: CallAgentFunctionMessage | Record<string, unknown>,
    options?: HandleAgentFunctionOptions,
  ): Promise<AgentFunctionResponseMessage> {
    if (options?.timeoutMs !== undefined && options?.timeoutMs !== null) {
      if (
        typeof options.timeoutMs !== 'number' ||
        !Number.isFinite(options.timeoutMs) ||
        options.timeoutMs <= 0
      ) {
        throw new RangeError('timeoutMs must be greater than 0.');
      }
    }

    if (this._disposed) {
      throw new A2uiRpcError(
        'Cannot handle a call on a disposed AgentFunctionRegistry.',
        RpcErrorCode.DISPOSED,
      );
    }

    const parsed = parseCallEnvelope(message);
    if (parsed.errorResponse !== undefined) {
      return parsed.errorResponse;
    }

    const {surfaceId, functionCallId, name, catalogId, args: rawArgs} = parsed.envelope;

    let resolvedCatalogId: string;
    if (catalogId === undefined) {
      const matchingCatalogIds: string[] = [];
      for (const [cid, fnMap] of this._functions.entries()) {
        if (fnMap.has(name)) {
          matchingCatalogIds.push(cid);
        }
      }
      if (matchingCatalogIds.length > 1) {
        return createErrorResponse(
          functionCallId,
          RpcErrorCode.INVALID_FUNCTION_CALL,
          `The call to '${name}' has no catalogId, and several catalogs have an agent function of that name: ${matchingCatalogIds.join(', ')}.`,
        );
      }
      if (matchingCatalogIds.length === 0) {
        return createErrorResponse(
          functionCallId,
          RpcErrorCode.UNKNOWN_FUNCTION,
          `No registered catalog declares agent function '${name}'.`,
        );
      }
      resolvedCatalogId = matchingCatalogIds[0];
    } else {
      resolvedCatalogId = catalogId;
    }

    const catalog = this._catalogs.get(resolvedCatalogId);
    if (!catalog) {
      return createErrorResponse(
        functionCallId,
        RpcErrorCode.UNKNOWN_FUNCTION,
        `Unknown catalog '${resolvedCatalogId}'.`,
      );
    }

    const agentFn = this._functions.get(resolvedCatalogId)?.get(name);
    if (!agentFn) {
      return createErrorResponse(
        functionCallId,
        RpcErrorCode.UNKNOWN_FUNCTION,
        `Unknown agent function '${name}' in catalog '${resolvedCatalogId}'.`,
      );
    }

    if (agentFn.allowedCallers === 'agentOnly') {
      return createErrorResponse(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        `Function '${name}' can't be called by the renderer (allowedCallers is agentOnly).`,
      );
    }

    let validatedArgs: Record<string, unknown>;
    try {
      validatedArgs = new PayloadValidator(catalog, STRICT_VALIDATION).validateFunction(
        name,
        rawArgs,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return createErrorResponse(functionCallId, RpcErrorCode.INVALID_FUNCTION_CALL, msg);
    }

    if (options?.signal?.aborted) {
      return createErrorResponse(
        functionCallId,
        RpcErrorCode.CANCELLED,
        `Function '${name}' was cancelled.`,
      );
    }

    const effectiveTimeoutMs =
      options?.timeoutMs === null ? undefined : (options?.timeoutMs ?? this._timeoutMs);

    const context: AgentFunctionContext = {
      catalogId: resolvedCatalogId,
      surfaceId,
      functionCallId,
    };

    return await this._executeWithLimits(
      agentFn,
      validatedArgs,
      context,
      effectiveTimeoutMs,
      options?.signal,
    );
  }

  private _releaseSlot(): void {
    if (this._waitQueue.length > 0 && !this._disposed) {
      const next = this._waitQueue.shift()!;
      next.acquire();
    } else {
      this._activeCount = Math.max(0, this._activeCount - 1);
    }
  }

  private async _executeWithLimits(
    agentFn: AgentFunction,
    args: Record<string, unknown>,
    context: AgentFunctionContext,
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AgentFunctionResponseMessage> {
    const {functionCallId} = context;
    if (this._disposed) {
      throw new A2uiRpcError(
        'Cannot handle a call on a disposed AgentFunctionRegistry.',
        RpcErrorCode.DISPOSED,
        functionCallId,
      );
    }

    if (signal?.aborted) {
      return createErrorResponse(
        functionCallId,
        RpcErrorCode.CANCELLED,
        `Function '${agentFn.name}' was cancelled.`,
      );
    }

    const token = Symbol('in-flight-call');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let acquiredSlot = false;
    let settled = false;
    let waiter:
      | {
          acquire: () => void;
          cancel: () => void;
          reject: (err: A2uiRpcError) => void;
          functionCallId: string;
        }
      | undefined;

    const cancelWaiter = (): void => {
      if (!waiter) return;
      const current = waiter;
      waiter = undefined;
      const idx = this._waitQueue.indexOf(current);
      if (idx !== -1) {
        this._waitQueue.splice(idx, 1);
      }
      current.cancel();
    };

    try {
      const disposedPromise = new Promise<never>((_resolve, reject) => {
        this._inFlightDisposers.set(token, {reject, functionCallId});
      });

      const runTask = async (): Promise<AgentFunctionResponseMessage> => {
        if (this._maxConcurrency === undefined || this._activeCount < this._maxConcurrency) {
          this._activeCount++;
          acquiredSlot = true;
        } else {
          const granted = await new Promise<boolean>((resolve, reject) => {
            waiter = {
              acquire: () => {
                waiter = undefined;
                acquiredSlot = true;
                resolve(true);
              },
              cancel: () => {
                resolve(false);
              },
              reject,
              functionCallId,
            };
            this._waitQueue.push(waiter);
          });
          if (!granted || settled || this._disposed) {
            return createErrorResponse(
              functionCallId,
              RpcErrorCode.CANCELLED,
              `Function '${agentFn.name}' was cancelled.`,
            );
          }
        }

        if (settled || this._disposed) {
          return createErrorResponse(
            functionCallId,
            RpcErrorCode.CANCELLED,
            `Function '${agentFn.name}' was cancelled.`,
          );
        }

        try {
          const result = await agentFn.handler(args, context);
          return {
            version: '1.0' as const,
            agentFunctionResponse: {
              functionCallId,
              value: result !== undefined ? result : null,
            },
          };
        } catch (err: unknown) {
          if (err instanceof A2uiRpcError) {
            return createErrorResponse(
              functionCallId,
              err.code || RpcErrorCode.EXECUTION_ERROR,
              err.rawMessage ?? err.message,
            );
          }
          return createErrorResponse(
            functionCallId,
            RpcErrorCode.EXECUTION_ERROR,
            err instanceof Error ? err.message : String(err),
          );
        }
      };

      const races: Array<Promise<AgentFunctionResponseMessage>> = [runTask(), disposedPromise];

      if (timeoutMs !== undefined) {
        races.push(
          new Promise<AgentFunctionResponseMessage>(resolve => {
            timer = setTimeout(() => {
              settled = true;
              cancelWaiter();
              resolve(
                createErrorResponse(
                  functionCallId,
                  RpcErrorCode.EXECUTION_ERROR,
                  `Function '${agentFn.name}' timed out after ${timeoutMs}ms.`,
                ),
              );
            }, timeoutMs);
          }),
        );
      }

      if (signal) {
        races.push(
          new Promise<AgentFunctionResponseMessage>(resolve => {
            onAbort = () => {
              settled = true;
              cancelWaiter();
              resolve(
                createErrorResponse(
                  functionCallId,
                  RpcErrorCode.CANCELLED,
                  `Function '${agentFn.name}' was cancelled.`,
                ),
              );
            };
            signal.addEventListener('abort', onAbort, {once: true});
          }),
        );
      }

      return await Promise.race(races);
    } finally {
      settled = true;
      cancelWaiter();
      this._inFlightDisposers.delete(token);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      if (acquiredSlot) {
        this._releaseSlot();
      }
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createErrorResponse(
  functionCallId: string,
  code: string,
  message: string,
): AgentFunctionResponseMessage {
  return {
    version: '1.0',
    agentFunctionResponse: {
      functionCallId,
      error: {
        code,
        message,
      },
    },
  };
}

function failEnvelope(
  callId: string | undefined,
  reason: string,
): {errorResponse: AgentFunctionResponseMessage} {
  if (callId === undefined) {
    throw new A2uiValidationError(reason);
  }
  return {
    errorResponse: createErrorResponse(callId, RpcErrorCode.INVALID_FUNCTION_CALL, reason),
  };
}

function parseCallEnvelope(
  message: unknown,
):
  | {envelope: ParsedCallEnvelope; errorResponse?: undefined}
  | {envelope?: undefined; errorResponse: AgentFunctionResponseMessage} {
  if (!isPlainObject(message)) {
    throw new A2uiValidationError('Invalid callAgentFunction message: expected a JSON object.');
  }

  const rawBody = message['callAgentFunction'];
  const callId =
    isPlainObject(rawBody) &&
    typeof rawBody['functionCallId'] === 'string' &&
    rawBody['functionCallId'].length > 0
      ? rawBody['functionCallId']
      : undefined;

  if (!isPlainObject(rawBody)) {
    return failEnvelope(callId, "Missing or invalid 'callAgentFunction' object.");
  }

  if (callId === undefined) {
    throw new A2uiValidationError('callAgentFunction.functionCallId must be a non-empty string.');
  }

  for (const key of Object.keys(message)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return failEnvelope(callId, `Unexpected property '${key}' on callAgentFunction message.`);
    }
  }

  if (message['version'] !== '1.0') {
    return failEnvelope(
      callId,
      `Invalid protocol version '${String(message['version'])}': callAgentFunction requires version '1.0'.`,
    );
  }

  for (const key of Object.keys(rawBody)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      return failEnvelope(callId, `Unexpected property '${key}' in callAgentFunction payload.`);
    }
  }

  const surfaceId = rawBody['surfaceId'];
  if (typeof surfaceId !== 'string' || surfaceId.length === 0) {
    return failEnvelope(callId, 'callAgentFunction.surfaceId must be a non-empty string.');
  }

  const rawCallFn = rawBody['callFunction'];
  if (!isPlainObject(rawCallFn)) {
    return failEnvelope(callId, 'callAgentFunction.callFunction must be an object.');
  }

  for (const key of Object.keys(rawCallFn)) {
    if (!ALLOWED_CALL_FUNCTION_KEYS.has(key)) {
      return failEnvelope(
        callId,
        `Unexpected property '${key}' in callAgentFunction.callFunction.`,
      );
    }
  }

  const name = rawCallFn['@call'];
  if (typeof name !== 'string' || name.length === 0) {
    return failEnvelope(
      callId,
      "callAgentFunction.callFunction['@call'] must be a non-empty string.",
    );
  }

  const rawCatalogId = rawCallFn['catalogId'];
  if (rawCatalogId !== undefined && typeof rawCatalogId !== 'string') {
    return failEnvelope(callId, 'callAgentFunction.callFunction.catalogId must be a string.');
  }

  const rawArgs = rawCallFn['args'];
  if (rawArgs !== undefined && !isPlainObject(rawArgs)) {
    return failEnvelope(callId, 'callAgentFunction.callFunction.args must be an object.');
  }

  const rawReturnType = rawCallFn['returnType'];
  if (
    rawReturnType !== undefined &&
    (typeof rawReturnType !== 'string' || !ALLOWED_RETURN_TYPES.has(rawReturnType))
  ) {
    return failEnvelope(
      callId,
      `Invalid returnType '${String(rawReturnType)}' in callAgentFunction.callFunction.`,
    );
  }

  return {
    envelope: {
      surfaceId,
      functionCallId: callId,
      name,
      catalogId: rawCatalogId,
      args: rawArgs,
    },
  };
}
