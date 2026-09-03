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

import {Catalog, FunctionImplementation} from '../../catalog/types.js';
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
  readonly catalogs: Catalog<any>[];
  /** Listener receiving outbound renderer messages. Required for callAgentFunction. */
  outboundListener?: OutboundMessageListener;
  /** Default timeout in milliseconds for callAgentFunction requests (default: 30000ms). */
  defaultTimeoutMs?: number;
}

/**
 * Options for configuring an outbound callAgentFunction request.
 */
export interface CallOptions {
  /** Explicit identifier for the function call. */
  functionCallId?: string;
  /** Timeout in milliseconds before rejecting with TIMEOUT. */
  timeoutMs?: number;
}

/**
 * Pending agent function callback record.
 */
interface PendingAgentCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Normalized arguments for outbound agent function invocation.
 */
interface NormalizedAgentCall {
  functionCallId: string;
  call: FunctionCall;
  effectiveTimeoutMs: number;
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
      const options = optionsOrCatalogs ?? {};
      this.catalogs = options.catalogs ?? [];
      this.outboundListener = options.outboundListener;
      this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
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
    const validationError = this.validateInboundMessage(message);
    if (validationError) {
      return validationError;
    }

    const {functionCallId, callFunction} = message.callRendererFunction;
    const {call, catalogId, args} = callFunction;

    const resolved = this.resolveFunctionImplementation(catalogId, call, context);
    if ('error' in resolved) {
      return this.createResponseError(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        resolved.error,
      );
    }

    const accessError = this.checkExecutionPermissions(resolved.funcImpl, call, isUserActivated);
    if (accessError) {
      return this.createResponseError(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        accessError,
      );
    }

    const parsedArgsResult = this.parseArguments(resolved.funcImpl, args, call);
    if ('error' in parsedArgsResult) {
      return this.createResponseError(
        functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL,
        parsedArgsResult.error,
      );
    }

    return this.executeFunctionSafely(
      resolved.funcImpl,
      parsedArgsResult.args,
      context,
      functionCallId,
    );
  }

  /**
   * Resolves a pending outbound callAgentFunction request upon receiving agentFunctionResponse.
   *
   * @param message The inbound agentFunctionResponse message.
   */
  handleAgentFunctionResponse(message: AgentFunctionResponseMessage): void {
    if (!message || !message.agentFunctionResponse) return;
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
   * Invokes a remote function on the server agent using an options bag.
   *
   * @param surfaceId The ID of the surface requesting execution.
   * @param call The function call details.
   * @param options Optional invocation options (custom functionCallId, timeoutMs).
   * @returns A promise resolving to the agent function return value.
   */
  callAgentFunction<T = unknown>(
    surfaceId: string,
    call: FunctionCall,
    options?: CallOptions,
  ): Promise<T>;

  /**
   * Invokes a remote function on the server agent using positional parameters.
   *
   * @deprecated Prefer the options-bag overload: `callAgentFunction(surfaceId, call, options)`.
   * @param surfaceId The ID of the surface requesting execution.
   * @param functionCallId The unique ID for this invocation instance.
   * @param call The function call details.
   * @param timeoutMs Optional timeout duration in milliseconds.
   * @returns A promise resolving to the agent function return value.
   */
  callAgentFunction<T = unknown>(
    surfaceId: string,
    functionCallId: string,
    call: FunctionCall,
    timeoutMs?: number,
  ): Promise<T>;

  callAgentFunction<T = unknown>(
    surfaceId: string,
    functionCallIdOrCall: string | FunctionCall,
    callOrOptions?: FunctionCall | CallOptions,
    timeoutMs?: number,
  ): Promise<T> {
    if (this.isDisposed) {
      return Promise.reject(new RpcError(RpcErrorCode.DISPOSED, 'RpcHandler has been disposed.'));
    }
    if (!this.outboundListener) {
      return Promise.reject(
        new RpcError(
          RpcErrorCode.NO_LISTENER,
          'Cannot call agent function without outboundListener configured.',
        ),
      );
    }

    const normalized = this.normalizeAgentCallArgs(functionCallIdOrCall, callOrOptions, timeoutMs);
    if (!normalized.call || !normalized.call.call) {
      return Promise.reject(
        new RpcError(RpcErrorCode.INVALID_FUNCTION_CALL, 'Missing or invalid function call name.'),
      );
    }

    if (this.pendingAgentCalls.has(normalized.functionCallId)) {
      return Promise.reject(
        new RpcError(
          RpcErrorCode.DUPLICATE,
          `A call with functionCallId '${normalized.functionCallId}' is already pending.`,
          normalized.functionCallId,
        ),
      );
    }

    return this.dispatchAgentCall<T>(surfaceId, normalized);
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

  private validateInboundMessage(
    message: CallRendererFunctionMessage,
  ): RendererFunctionResponseMessage | null {
    if (!message) {
      return this.createResponseError(
        'unknown',
        RpcErrorCode.INVALID_FUNCTION_CALL,
        'Inbound message is null or undefined.',
      );
    }
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
    return null;
  }

  private resolveFunctionImplementation(
    catalogId: string | undefined,
    call: string,
    context?: DataContext,
  ): {funcImpl: FunctionImplementation} | {error: string} {
    let catalog: Catalog<any> | undefined;
    if (catalogId) {
      catalog = this.catalogs.find(c => c.id === catalogId);
      if (!catalog) {
        return {error: `Catalog not found: ${catalogId}`};
      }
    } else if (context?.surface?.catalog) {
      catalog = context.surface.catalog;
    } else if (this.catalogs.length > 0) {
      catalog = this.catalogs[0];
    }

    if (!catalog) {
      return {error: 'No catalog available for function resolution.'};
    }

    const funcImpl = catalog.functions?.get(call);
    if (!funcImpl) {
      return {error: `Function not found: ${call}`};
    }
    return {funcImpl};
  }

  private checkExecutionPermissions(
    funcImpl: FunctionImplementation,
    call: string,
    isUserActivated: boolean,
  ): string | null {
    const boundary = funcImpl.allowedCallers ?? 'rendererOnly';
    const isAllowedCaller = boundary === 'rendererOrAgent' || boundary === 'agentOnly';
    if (!isAllowedCaller) {
      return `Function '${call}' cannot be called by agent (allowedCallers is ${boundary}).`;
    }
    if (funcImpl.requiresUserActivation && !isUserActivated) {
      return `Function '${call}' requires user activation context to execute.`;
    }
    return null;
  }

  private parseArguments(
    funcImpl: FunctionImplementation,
    args: Record<string, unknown> | undefined,
    call: string,
  ): {args: Record<string, unknown>} | {error: string} {
    if (!funcImpl.schema) {
      return {args: args ?? {}};
    }
    try {
      const parsed = funcImpl.schema.parse(args ?? {}) as Record<string, unknown>;
      return {args: parsed};
    } catch (err: unknown) {
      const errMsg = this.extractErrorMessage(err);
      return {error: `Invalid function arguments for '${call}': ${errMsg}`};
    }
  }

  private async executeFunctionSafely(
    funcImpl: FunctionImplementation,
    args: Record<string, unknown>,
    context: DataContext,
    functionCallId: string,
  ): Promise<RendererFunctionResponseMessage> {
    try {
      const rawResult = await Promise.resolve(funcImpl.execute(args, context));
      const unwrapped = isSignal(rawResult) ? getValue(rawResult) : rawResult;
      const value = unwrapped !== undefined ? unwrapped : null;
      return {
        version: 'v1.0',
        rendererFunctionResponse: {
          functionCallId,
          value,
        },
      };
    } catch (err: unknown) {
      const errMsg = this.extractErrorMessage(err);
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

  private normalizeAgentCallArgs(
    functionCallIdOrCall: string | FunctionCall,
    callOrOptions?: FunctionCall | CallOptions,
    timeoutMs?: number,
  ): NormalizedAgentCall {
    if (typeof functionCallIdOrCall === 'string') {
      return {
        functionCallId: functionCallIdOrCall,
        call: callOrOptions as FunctionCall,
        effectiveTimeoutMs: timeoutMs ?? this.defaultTimeoutMs,
      };
    }
    const opts = (callOrOptions as CallOptions) ?? {};
    return {
      functionCallId: opts.functionCallId ?? this.generateFunctionCallId(),
      call: functionCallIdOrCall,
      effectiveTimeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs,
    };
  }

  private generateFunctionCallId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    const randSuffix = Math.random().toString(36).substring(2, 15).padEnd(13, '0');
    return `call-${Date.now()}-${randSuffix}`;
  }

  private dispatchAgentCall<T = unknown>(
    surfaceId: string,
    callInfo: NormalizedAgentCall,
  ): Promise<T> {
    const {functionCallId, call, effectiveTimeoutMs} = callInfo;

    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        this.pendingAgentCalls.delete(functionCallId);
      };

      timer = this.createTimeoutTimer(
        functionCallId,
        call.call,
        effectiveTimeoutMs,
        cleanup,
        reject,
      );

      this.pendingAgentCalls.set(functionCallId, {
        resolve: val => {
          cleanup();
          resolve(val as T);
        },
        reject: err => {
          cleanup();
          reject(err);
        },
      });

      this.sendOutboundMessage(surfaceId, functionCallId, call, cleanup, reject);
    });
  }

  private createTimeoutTimer(
    functionCallId: string,
    callName: string,
    timeoutMs: number,
    cleanup: () => void,
    reject: (err: Error) => void,
  ): ReturnType<typeof setTimeout> | undefined {
    if (timeoutMs <= 0) return undefined;
    return setTimeout(() => {
      if (this.pendingAgentCalls.delete(functionCallId)) {
        cleanup();
        reject(
          new RpcError(
            RpcErrorCode.TIMEOUT,
            `Agent function call '${callName}' timed out after ${timeoutMs}ms.`,
            functionCallId,
          ),
        );
      }
    }, timeoutMs);
  }

  private sendOutboundMessage(
    surfaceId: string,
    functionCallId: string,
    call: FunctionCall,
    cleanup: () => void,
    reject: (reason?: any) => void,
  ): void {
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
          cleanup();
          reject(err);
        });
      }
    } catch (err) {
      cleanup();
      reject(err);
    }
  }

  private extractErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
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
