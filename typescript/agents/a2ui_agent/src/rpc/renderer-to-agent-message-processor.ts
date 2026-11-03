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

import type {z} from 'zod';

import {
  A2uiValidationError,
  type ActionMessage,
  type AgentToRendererMessage,
  type CatalogInterface,
  type ComponentApi,
  type ErrorMessage,
  type FunctionApi,
  type RendererFunctionResponseMessage,
  V10ActionMessageSchema,
  V10ErrorMessageSchema,
  V10RendererFunctionResponseMessageSchema,
} from '../internal/web-core.js';
import {AgentFunctionRegistry} from './agent-function-registry.js';

const MESSAGE_KEYS = ['action', 'callAgentFunction', 'error', 'rendererFunctionResponse'] as const;

/**
 * What {@link RendererToAgentMessageProcessor.processMessage} did with a
 * message.
 */
export interface ProcessResult {
  /**
   * Whether the processor handled the message: always for `callAgentFunction`,
   * and for `action`, `error` and `rendererFunctionResponse` when their
   * callback is set. An unhandled message is left for the caller, such as a
   * framework that passes it on to the model's turn.
   */
  readonly handled: boolean;
  /**
   * The messages to send back to the renderer: exactly one
   * `agentFunctionResponse` for a `callAgentFunction`, otherwise none.
   */
  readonly replies: AgentToRendererMessage[];
}

/**
 * Options for a {@link RendererToAgentMessageProcessor}.
 */
export interface RendererToAgentMessageProcessorOptions {
  /** The catalogs whose `agentFunctions` answer `callAgentFunction` messages. */
  readonly catalogs: Iterable<CatalogInterface<ComponentApi, FunctionApi>>;
  /**
   * How long an agent function may run, in milliseconds, before its call is
   * answered with an `EXECUTION_ERROR`. No timeout when omitted.
   */
  readonly agentFunctionTimeoutMs?: number;
  /** Receives each `action` message, validated against the v1.0 schema. */
  readonly onAction?: (message: ActionMessage) => void | Promise<void>;
  /** Receives each `error` message, validated against the v1.0 schema. */
  readonly onError?: (message: ErrorMessage) => void | Promise<void>;
  /**
   * Receives each `rendererFunctionResponse` message, validated against the
   * v1.0 schema.
   */
  readonly onRendererFunctionResponse?: (
    message: RendererFunctionResponseMessage,
  ) => void | Promise<void>;
}

/**
 * Processes the messages a renderer sends an agent (`RendererToAgentMessage`),
 * the agent-side counterpart of web_core's `MessageProcessor`.
 *
 * - `callAgentFunction` runs the agent function of the catalogs and replies
 *   with its `agentFunctionResponse`. A call that fails after its
 *   `functionCallId` is known (an empty `surfaceId`, an unknown function, bad
 *   arguments, a handler error, the timeout) is answered with an `error`
 *   rather than thrown, so the renderer's pending call settles.
 * - `action`, `error` and `rendererFunctionResponse` go to their callback,
 *   when it is set. Without one the message is not handled, and nothing is
 *   validated.
 *
 * The processor keeps no state across messages, so build one per agent, or
 * per request from the active catalogs.
 */
export class RendererToAgentMessageProcessor {
  private readonly _registry: AgentFunctionRegistry;
  private readonly _onAction?: (message: ActionMessage) => void | Promise<void>;
  private readonly _onError?: (message: ErrorMessage) => void | Promise<void>;
  private readonly _onRendererFunctionResponse?: (
    message: RendererFunctionResponseMessage,
  ) => void | Promise<void>;

  /**
   * Initializes a new `RendererToAgentMessageProcessor`.
   *
   * @param options The catalogs, the agent function timeout and the callbacks.
   * @throws {RangeError} If `agentFunctionTimeoutMs` is not greater than 0.
   */
  constructor(options: RendererToAgentMessageProcessorOptions) {
    this._registry = new AgentFunctionRegistry(options.catalogs, {
      timeoutMs: options.agentFunctionTimeoutMs,
    });
    this._onAction = options.onAction;
    this._onError = options.onError;
    this._onRendererFunctionResponse = options.onRendererFunctionResponse;
  }

  /**
   * Processes one message from the renderer.
   *
   * @param message The parsed JSON message.
   * @returns Whether the message was handled, and the replies to send.
   * @throws {A2uiValidationError} If `message` is not an object, has no known
   *   message key or more than one, is a `callAgentFunction` without a
   *   `functionCallId`, or is a malformed message whose callback is set.
   *   An error a callback throws propagates.
   */
  async processMessage(message: unknown): Promise<ProcessResult> {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      throw new A2uiValidationError(
        `A renderer message must be a JSON object, got ${message === null ? 'null' : Array.isArray(message) ? 'an array' : typeof message}.`,
      );
    }
    const keys = MESSAGE_KEYS.filter(key => Object.hasOwn(message, key));
    if (keys.length === 0) {
      const found = Object.keys(message).filter(key => key !== 'version');
      throw new A2uiValidationError(
        `A renderer message needs one of ${MESSAGE_KEYS.join(', ')}; found ${found.length === 0 ? 'none' : found.join(', ')}.`,
      );
    }
    if (keys.length > 1) {
      throw new A2uiValidationError(
        `A renderer message carries one message, but this one has ${keys.join(', ')}.`,
      );
    }

    switch (keys[0]) {
      case 'callAgentFunction':
        return {handled: true, replies: [await this._registry.handle(message)]};
      case 'action':
        return await dispatch(message, V10ActionMessageSchema, this._onAction);
      case 'error':
        return await dispatch(message, V10ErrorMessageSchema, this._onError);
      case 'rendererFunctionResponse':
        return await dispatch(
          message,
          V10RendererFunctionResponseMessageSchema,
          this._onRendererFunctionResponse,
        );
    }
  }

  /**
   * Processes several messages from the renderer concurrently.
   *
   * @param messages The parsed JSON messages.
   * @returns The result of each message, in the order of `messages`.
   * @throws {A2uiValidationError} As {@link processMessage} does, for the
   *   first message that fails.
   */
  async processMessages(messages: Iterable<unknown>): Promise<ProcessResult[]> {
    return await Promise.all([...messages].map(message => this.processMessage(message)));
  }
}

async function dispatch<T>(
  message: object,
  schema: z.ZodType<T>,
  callback: ((message: T) => void | Promise<void>) | undefined,
): Promise<ProcessResult> {
  if (callback === undefined) {
    return {handled: false, replies: []};
  }
  const parsed = schema.safeParse(message);
  if (!parsed.success) {
    throw new A2uiValidationError(
      `Invalid ${Object.keys(message)
        .filter(key => key !== 'version')
        .join(', ')} message: ${parsed.error.message}`,
    );
  }
  await callback(parsed.data);
  return {handled: true, replies: []};
}
