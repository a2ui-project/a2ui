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

import {Catalog} from '../../catalog/types.js';
import {DataContext} from '../../rendering/data-context.js';
import {isSignal, getValue} from '../../reactivity/signals.js';
import {FunctionCall} from '../schema/common-types.js';
import {
  CallRendererFunctionMessage,
  AgentFunctionResponseMessage,
} from '../schema/agent-to-renderer.js';
import {
  RendererFunctionResponseMessage,
  CallAgentFunctionMessage,
} from '../schema/renderer-to-agent.js';

/**
 * Standard error codes for A2UI RPC failures.
 */
export enum RpcErrorCode {
  INVALID_FUNCTION_CALL = 'INVALID_FUNCTION_CALL',
  EXECUTION_ERROR = 'EXECUTION_ERROR',
  TIMEOUT = 'TIMEOUT',
  CANCELLED = 'CANCELLED',
  DISPOSED = 'DISPOSED',
  DUPLICATE = 'DUPLICATE',
  NO_LISTENER = 'NO_LISTENER',
}

/**
 * Custom error class for A2UI RPC operation failures.
 */
export class RpcError extends Error {
  constructor(
    public readonly code: RpcErrorCode | string,
    message: string,
    public readonly functionCallId?: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'RpcError';
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}

/**
 * Callback function type receiving outbound renderer messages intended for the agent.
 */
export type OutboundMessageListener = (
  message: RendererFunctionResponseMessage | CallAgentFunctionMessage,
) => void | Promise<void>;

/**
 * Options for configuring an RpcHandler instance.
 */
export interface RpcHandlerOptions {
  /** Catalogs available for function resolution. */
  catalogs: Catalog<any>[];
  /** Listener receiving outbound renderer messages. Required for callAgentFunction. */
  outboundListener?: OutboundMessageListener;
  /** Default timeout in milliseconds for callAgentFunction requests (default: 30000ms). */
  defaultTimeoutMs?: number;
}

/**
 * Pending agent function callback record.
 */
interface PendingAgentCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Manages bidirectional RPC function execution between renderer and server agent.
 */
export class RpcHandler {
  private readonly catalogs: Catalog<any>[];
  private readonly outboundListener?: OutboundMessageListener;
  private readonly defaultTimeoutMs: number;
  private readonly pendingAgentCalls = new Map<string, PendingAgentCall>();
  private isDisposed = false;

  constructor(options: RpcHandlerOptions);
  constructor(catalogs: Catalog<any>[], outboundListener?: OutboundMessageListener);
  constructor(
    optionsOrCatalogs: RpcHandlerOptions | Catalog<any>[],
    outboundListener?: OutboundMessageListener,
  ) {
    if (Array.isArray(optionsOrCatalogs)) {
      this.catalogs = optionsOrCatalogs;
      this.outboundListener = outboundListener;
      this.defaultTimeoutMs = 30000;
    } else {
      this.catalogs = optionsOrCatalogs.catalogs;
      this.outboundListener = optionsOrCatalogs.outboundListener;
      this.defaultTimeoutMs = optionsOrCatalogs.defaultTimeoutMs ?? 30000;
    }
  }

  /**
   * Indicates whether this RpcHandler instance has been disposed.
   */
  get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Executes a remote renderer function requested by the server agent.
   *
   * @param message The inbound callRendererFunction message.
   * @param context The current DataContext for function execution.
   * @param isUserActivated Whether execution occurs in an active user gesture context.
   */
  async handleCallRendererFunction(
    message: CallRendererFunctionMessage,
    context: DataContext,
    isUserActivated: boolean = false,
  ): Promise<RendererFunctionResponseMessage> {
    if (this.isDisposed) {
      return this.createResponseError(
        message.callRendererFunction?.functionCallId ?? 'unknown',
        RpcErrorCode.DISPOSED,
        'RpcHandler has been disposed.',
      );
    }

    if (!message.callRendererFunction?.callFunction) {
      return this.createResponseError(
        message.callRendererFunction?.functionCallId ?? 'unknown',
        RpcErrorCode.INVALID_FUNCTION_CALL,
        'Malformed message: missing callRendererFunction or callFunction.',
      );
    }
    const {functionCallId, callFunction} = message.callRendererFunction;
    const {call, catalogId, args} = callFunction;

    // 1. Resolve catalog (fallback to surface default catalog if catalogId is omitted)
    const targetCatalogId = catalogId || context?.surface?.catalog?.id;
    if (!targetCatalogId) {
      return this.createResponseError(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        'No catalogId provided and surface catalog is unavailable.',
      );
    }
    const catalog = this.catalogs.find(c => c.id === targetCatalogId);
    if (!catalog) {
      return this.createResponseError(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        `Catalog '${targetCatalogId}' not found.`,
      );
    }

    // 2. Resolve function implementation
    const funcImpl = catalog.functions?.get(call);
    if (!funcImpl) {
      return this.createResponseError(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        `Function '${call}' not found in catalog '${targetCatalogId}'.`,
      );
    }

    // 3. Validate boundary execution constraint (callableFrom)
    const boundary = funcImpl.callableFrom ?? 'rendererOnly';
    if (boundary !== 'rendererOrAgent' && boundary !== 'agentOnly') {
      return this.createResponseError(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        `Function '${call}' cannot be called by agent (callableFrom is ${boundary}).`,
      );
    }

    // 4. Validate user activation constraint
    if (funcImpl.requiresUserActivation && !isUserActivated) {
      return this.createResponseError(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        `Function '${call}' requires user activation context to execute.`,
      );
    }

    // 5. Enforce argument schema parsing
    let safeArgs: Record<string, unknown>;
    try {
      safeArgs = funcImpl.schema
        ? (funcImpl.schema.parse(args ?? {}) as Record<string, unknown>)
        : (args ?? {});
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return this.createResponseError(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        `Invalid function arguments for '${call}': ${errMsg}`,
      );
    }

    // 6. Execute function safely
    try {
      const rawResult = await Promise.resolve(funcImpl.execute(safeArgs, context));
      const result = isSignal(rawResult) ? getValue(rawResult) : rawResult;
      return {
        version: 'v1.0',
        rendererFunctionResponse: {
          functionCallId,
          value: result !== undefined ? result : null,
        },
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        version: 'v1.0',
        rendererFunctionResponse: {
          functionCallId,
          error: {
            code: RpcErrorCode.EXECUTION_ERROR,
            message: errMsg || 'An error occurred during function execution.',
          },
        },
      };
    }
  }

  /**
   * Resolves a pending outbound callAgentFunction request upon receiving agentFunctionResponse.
   *
   * @param message The inbound agentFunctionResponse message.
   */
  handleAgentFunctionResponse(message: AgentFunctionResponseMessage): void {
    if (!message.agentFunctionResponse) return;
    const {functionCallId, value, error} = message.agentFunctionResponse;
    const pending = this.pendingAgentCalls.get(functionCallId);
    if (!pending) return;

    this.pendingAgentCalls.delete(functionCallId);
    if (error) {
      pending.reject(new RpcError(error.code, error.message, functionCallId));
    } else {
      pending.resolve(value);
    }
  }

  /**
   * Invokes a remote function on the server agent from the renderer.
   *
   * @param surfaceId The ID of the surface requesting execution.
   * @param functionCallIdOrCall The unique ID or function call details.
   * @param callOrOptions The function call details or invocation options.
   * @param timeoutMs Optional timeout duration in milliseconds (legacy signature).
   * @returns A promise resolving to the agent function return value.
   */
  callAgentFunction(
    surfaceId: string,
    functionCallIdOrCall: string | FunctionCall,
    callOrOptions?: FunctionCall | {functionCallId?: string; timeoutMs?: number},
    timeoutMs?: number,
  ): Promise<unknown> {
    if (this.isDisposed) {
      return Promise.reject(
        new RpcError(RpcErrorCode.DISPOSED, 'RpcHandler has been disposed.'),
      );
    }
    if (!this.outboundListener) {
      return Promise.reject(
        new RpcError(
          RpcErrorCode.NO_LISTENER,
          'Cannot call agent function without outboundListener configured.',
        ),
      );
    }

    let functionCallId: string;
    let call: FunctionCall;
    let effectiveTimeoutMs: number;

    if (typeof functionCallIdOrCall === 'string') {
      functionCallId = functionCallIdOrCall;
      call = callOrOptions as FunctionCall;
      effectiveTimeoutMs = timeoutMs ?? this.defaultTimeoutMs;
    } else {
      call = functionCallIdOrCall;
      const opts = (callOrOptions as {functionCallId?: string; timeoutMs?: number}) ?? {};
      functionCallId =
        opts.functionCallId ??
        (typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `call-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
      effectiveTimeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    }

    return new Promise((resolve, reject) => {
      if (this.pendingAgentCalls.has(functionCallId)) {
        reject(
          new RpcError(
            RpcErrorCode.DUPLICATE,
            `A call with functionCallId '${functionCallId}' is already pending.`,
            functionCallId,
          ),
        );
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (effectiveTimeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.pendingAgentCalls.has(functionCallId)) {
            this.pendingAgentCalls.delete(functionCallId);
            reject(
              new RpcError(
                RpcErrorCode.TIMEOUT,
                `Agent function call '${call.call}' timed out after ${effectiveTimeoutMs}ms.`,
                functionCallId,
              ),
            );
          }
        }, effectiveTimeoutMs);
      }

      this.pendingAgentCalls.set(functionCallId, {
        resolve: val => {
          if (timer) clearTimeout(timer);
          resolve(val);
        },
        reject: err => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      });

      const outboundMsg: CallAgentFunctionMessage = {
        version: 'v1.0',
        callAgentFunction: {
          surfaceId,
          functionCallId,
          callFunction: call,
        },
      };

      try {
        const result = this.outboundListener!(outboundMsg);
        if (result && typeof (result as any).catch === 'function') {
          (result as Promise<void>).catch(err => {
            if (timer) clearTimeout(timer);
            this.pendingAgentCalls.delete(functionCallId);
            reject(err);
          });
        }
      } catch (err) {
        if (timer) clearTimeout(timer);
        this.pendingAgentCalls.delete(functionCallId);
        reject(err);
      }
    });
  }

  /**
   * Disposes the RpcHandler and rejects all pending agent function calls.
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const [id, pending] of this.pendingAgentCalls.entries()) {
      pending.reject(
        new RpcError(
          RpcErrorCode.CANCELLED,
          `RpcHandler disposed while call '${id}' was pending.`,
          id,
        ),
      );
    }
    this.pendingAgentCalls.clear();
  }

  private createResponseError(
    functionCallId: string,
    code: RpcErrorCode | string,
    message: string,
  ): RendererFunctionResponseMessage {
    return {
      version: 'v1.0',
      rendererFunctionResponse: {
        functionCallId,
        error: {code, message},
      },
    };
  }
}
