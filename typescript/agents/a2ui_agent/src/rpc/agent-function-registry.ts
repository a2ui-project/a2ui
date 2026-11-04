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
  A2uiValidationError,
  AgentFunction,
  type AgentFunctionContext,
  type AgentFunctionResponseMessage,
  type CatalogInterface,
  type ComponentApi,
  type FunctionApi,
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
 * Options for an {@link AgentFunctionRegistry}.
 */
export interface AgentFunctionRegistryOptions {
  /**
   * How long a handler may run, in milliseconds, before the call is answered
   * with an `EXECUTION_ERROR`. Must be greater than 0. No timeout when
   * omitted.
   */
  readonly timeoutMs?: number;
}

interface ParsedCallEnvelope {
  readonly surfaceId: string;
  readonly functionCallId: string;
  readonly name: string;
  readonly catalogId?: string;
  readonly args?: Record<string, unknown>;
}

/**
 * Indexes the agent functions of catalogs and answers `callAgentFunction`
 * messages with them. Internal to `RendererToAgentMessageProcessor`.
 *
 * A call that fails after its `functionCallId` is known produces an
 * `agentFunctionResponse` with `error` rather than throwing, so the renderer's
 * pending `callAgentFunction` promise settles cleanly instead of hanging until
 * its timeout. A message without a usable `functionCallId` cannot be answered
 * and throws {@link A2uiValidationError}.
 */
export class AgentFunctionRegistry {
  private readonly _catalogs = new Map<string, CatalogInterface<ComponentApi, FunctionApi>>();
  private readonly _functions = new Map<string, Map<string, AgentFunction>>();
  private readonly _timeoutMs?: number;

  /**
   * Indexes the `agentFunctions` of each catalog by `(catalog.id, name)`.
   *
   * @param catalogs Catalogs whose `agentFunctions` should be registered.
   * @param options Optional handler timeout.
   * @throws {RangeError} If `timeoutMs <= 0`.
   * @throws {A2uiCatalogError} If two catalogs have the same id.
   */
  constructor(
    catalogs: Iterable<CatalogInterface<ComponentApi, FunctionApi>>,
    options?: AgentFunctionRegistryOptions,
  ) {
    if (options?.timeoutMs !== undefined) {
      if (
        typeof options.timeoutMs !== 'number' ||
        !Number.isFinite(options.timeoutMs) ||
        options.timeoutMs <= 0
      ) {
        throw new RangeError('The agent function timeout must be greater than 0.');
      }
      this._timeoutMs = options.timeoutMs;
    }

    for (const catalog of catalogs) {
      if (this._catalogs.has(catalog.id)) {
        throw new A2uiCatalogError(`Two catalogs have the id '${catalog.id}'.`);
      }
      this._catalogs.set(catalog.id, catalog);
      if (catalog.agentFunctions.size > 0) {
        const byName = new Map<string, AgentFunction>();
        for (const [name, fn] of catalog.agentFunctions.entries()) {
          byName.set(name, fn);
        }
        this._functions.set(catalog.id, byName);
      }
    }
  }

  /**
   * Validates, routes, and executes a `callAgentFunction` message, returning
   * its `agentFunctionResponse` envelope.
   *
   * @param message Inbound `callAgentFunction` message.
   * @returns The outbound `agentFunctionResponse` message.
   * @throws {A2uiValidationError} If the message lacks a usable `functionCallId`.
   */
  async handle(message: unknown): Promise<AgentFunctionResponseMessage> {
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

    // An AgentFunction can't be agentOnly; this guards against one that was
    // built around its constructor.
    if ((agentFn as {allowedCallers?: string}).allowedCallers === 'agentOnly') {
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

    const context: AgentFunctionContext = {
      catalogId: resolvedCatalogId,
      surfaceId,
      functionCallId,
    };

    return await this._execute(agentFn, validatedArgs, context);
  }

  private async _execute(
    agentFn: AgentFunction,
    args: Record<string, unknown>,
    context: AgentFunctionContext,
  ): Promise<AgentFunctionResponseMessage> {
    const {functionCallId} = context;
    const run = async (): Promise<AgentFunctionResponseMessage> => {
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

    const timeoutMs = this._timeoutMs;
    if (timeoutMs === undefined) {
      return await run();
    }
    // A JavaScript handler can't be stopped, so when the timeout fires the
    // call is answered and the handler's eventual result is ignored.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<AgentFunctionResponseMessage>(resolve => {
      timer = setTimeout(() => {
        resolve(
          createErrorResponse(
            functionCallId,
            RpcErrorCode.EXECUTION_ERROR,
            `Function '${agentFn.name}' timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);
    });
    try {
      return await Promise.race([run(), timedOut]);
    } finally {
      clearTimeout(timer);
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
