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

import {Catalog, ComponentApi} from '../../catalog/types.js';
import {DataContext} from '../../rendering/data-context.js';
import {isSignal, getValue} from '../../reactivity/signals.js';
import {
  CallRendererFunctionMessage,
  AgentFunctionResponseMessage,
} from '../schema/agent-to-renderer.js';
import {
  RendererFunctionResponseMessage,
  CallAgentFunctionMessage,
} from '../schema/renderer-to-agent.js';

/**
 * A callback function to emit outbound client messages to the agent.
 */
export type OutboundMessageListener = (
  message: RendererFunctionResponseMessage | CallAgentFunctionMessage,
) => void;

/**
 * A pending agent function callback record.
 */
interface PendingAgentCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Manages bidirectional RPC function execution between renderer and server agent.
 *
 * @template T The concrete type of the ComponentApi.
 */
export class RpcHandler<T extends ComponentApi> {
  private readonly pendingAgentCalls = new Map<string, PendingAgentCall>();

  /**
   * Creates a new RpcHandler instance.
   *
   * @param catalogs The available catalogs for function lookup.
   * @param outboundListener The listener receiving outbound renderer messages.
   */
  constructor(
    private readonly catalogs: Catalog<T>[],
    private readonly outboundListener?: OutboundMessageListener,
  ) {}

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
    if (!message.callRendererFunction?.callFunction) {
      return this.createResponseError(
        message.callRendererFunction?.functionCallId ?? 'unknown',
        'INVALID_FUNCTION_CALL',
        'Malformed message: missing callRendererFunction or callFunction.',
      );
    }
    const {functionCallId, callFunction} = message.callRendererFunction;
    const {call, catalogId, args} = callFunction;

    // 1. Resolve catalog (fallback to surface default catalog if catalogId is omitted)
    const targetCatalogId = catalogId || context.surface.catalog.id;
    const catalog = this.catalogs.find(c => c.id === targetCatalogId);
    if (!catalog) {
      return this.createResponseError(
        functionCallId,
        'INVALID_FUNCTION_CALL',
        `Catalog '${targetCatalogId}' not found.`,
      );
    }

    // 2. Resolve function implementation
    const funcImpl = catalog.functions?.get(call);
    if (!funcImpl) {
      return this.createResponseError(
        functionCallId,
        'INVALID_FUNCTION_CALL',
        `Function '${call}' not found in catalog '${targetCatalogId}'.`,
      );
    }

    // 3. Validate boundary execution constraint (callableFrom)
    const boundary = funcImpl.callableFrom ?? 'rendererOnly';
    if (boundary !== 'rendererOrAgent' && boundary !== 'agentOnly') {
      return this.createResponseError(
        functionCallId,
        'INVALID_FUNCTION_CALL',
        `Function '${call}' cannot be called by agent (callableFrom is ${boundary}).`,
      );
    }

    // 4. Validate user activation constraint
    if (funcImpl.requiresUserActivation && !isUserActivated) {
      return this.createResponseError(
        functionCallId,
        'INVALID_FUNCTION_CALL',
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
        'INVALID_FUNCTION_CALL',
        `Invalid function arguments for '${call}': ${errMsg}`,
      );
    }

    // 6. Execute function safely
    let responseMsg: RendererFunctionResponseMessage;
    try {
      const rawResult = await Promise.resolve(funcImpl.execute(safeArgs, context));
      const result = isSignal(rawResult) ? getValue(rawResult) : rawResult;
      responseMsg = {
        version: 'v1.0',
        rendererFunctionResponse: {
          functionCallId,
          value: result !== undefined ? result : null,
        },
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      responseMsg = {
        version: 'v1.0',
        rendererFunctionResponse: {
          functionCallId,
          error: {
            code: 'EXECUTION_ERROR',
            message: errMsg || 'An error occurred during function execution.',
          },
        },
      };
    }

    if (this.outboundListener) {
      this.outboundListener(responseMsg);
    }
    return responseMsg;
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
      pending.reject(new Error(`[${error.code}] ${error.message}`));
    } else {
      pending.resolve(value);
    }
  }

  /**
   * Invokes a remote function on the server agent from the renderer.
   *
   * @param surfaceId The ID of the surface requesting execution.
   * @param functionCallId The unique identifier for this RPC call.
   * @param call The function call details.
   * @param timeoutMs Optional timeout duration in milliseconds.
   * @returns A promise resolving to the agent function return value.
   */
  callAgentFunction(
    surfaceId: string,
    functionCallId: string,
    call: {call: string; catalogId?: string; args?: Record<string, unknown>},
    timeoutMs?: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.pendingAgentCalls.has(functionCallId)) {
        reject(
          new Error(
            `[DUPLICATE] A call with functionCallId '${functionCallId}' is already pending.`,
          ),
        );
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.pendingAgentCalls.has(functionCallId)) {
            this.pendingAgentCalls.delete(functionCallId);
            reject(
              new Error(
                `[TIMEOUT] Agent function call '${call.call}' timed out after ${timeoutMs}ms.`,
              ),
            );
          }
        }, timeoutMs);
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

      if (this.outboundListener) {
        try {
          this.outboundListener(outboundMsg);
        } catch (err) {
          if (timer) clearTimeout(timer);
          this.pendingAgentCalls.delete(functionCallId);
          reject(err);
        }
      }
    });
  }

  /**
   * Disposes the RpcHandler and rejects all pending agent function calls.
   */
  dispose(): void {
    for (const [id, pending] of this.pendingAgentCalls.entries()) {
      pending.reject(new Error(`[CANCELLED] RpcHandler disposed while call '${id}' was pending.`));
    }
    this.pendingAgentCalls.clear();
  }

  private createResponseError(
    functionCallId: string,
    code: string,
    message: string,
  ): RendererFunctionResponseMessage {
    const responseMsg: RendererFunctionResponseMessage = {
      version: 'v1.0',
      rendererFunctionResponse: {
        functionCallId,
        error: {code, message},
      },
    };

    if (this.outboundListener) {
      this.outboundListener(responseMsg);
    }
    return responseMsg;
  }
}
