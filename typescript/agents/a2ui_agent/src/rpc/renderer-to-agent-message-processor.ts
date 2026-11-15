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
  A2uiValidationError,
  type ActionMessage,
  type AgentToRendererMessage,
  bindCatalogValidator,
  type CatalogInterface,
  type ComponentApi,
  type ErrorMessage,
  type FunctionApi,
  type JsonSchema,
  type JsonSchemaValidator,
  messageForIssue,
  pickIssue,
  type ProtocolMessageSpec,
  type RendererFunctionResponseMessage,
  V1_0_MESSAGE_SPEC,
  validateProtocolMessage,
} from '../internal/web-core.js';
import RendererToAgent from '../schemas/v1_0/renderer_to_agent.json' with {type: 'json'};
import {requireValidator} from '../utils/validator.js';
import {AgentFunctionRegistry} from './agent-function-registry.js';

/**
 * The specification's v1.0 `renderer_to_agent.json`, with the common types and envelope
 * catalog web_core validates agent-to-renderer messages with.
 */
const RENDERER_TO_AGENT_SPEC: ProtocolMessageSpec = {
  schema: RendererToAgent as JsonSchema,
  defs: V1_0_MESSAGE_SPEC.defs,
};

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
   * The JSON Schema validator the messages are checked with, such as `createAjvValidator()`
   * from `@a2ui/validator-ajv`: the `action`, `error` and `rendererFunctionResponse` messages,
   * and the arguments of `callAgentFunction`. As with web_core's `MessageProcessor`, it is
   * bound to each catalog, so it wins over a validator a catalog borrows from its entries;
   * a validator a catalog was given (`CatalogOptions.validator`, `Catalog.fromJson`) is kept.
   */
  readonly validator: JsonSchemaValidator;
  /**
   * How long an agent function may run, in milliseconds, before its call is
   * answered with an `EXECUTION_ERROR`. No timeout when omitted.
   */
  readonly agentFunctionTimeoutMs?: number;
  /**
   * Receives each `action` message, validated against the v1.0 schema.
   * See {@link RendererMessageCallback} for declining one.
   */
  readonly onAction?: RendererMessageCallback<ActionMessage>;
  /**
   * Receives each `error` message, validated against the v1.0 schema.
   * See {@link RendererMessageCallback} for declining one.
   */
  readonly onError?: RendererMessageCallback<ErrorMessage>;
  /**
   * Receives each `rendererFunctionResponse` message, validated against the
   * v1.0 schema. See {@link RendererMessageCallback} for declining one.
   */
  readonly onRendererFunctionResponse?: RendererMessageCallback<RendererFunctionResponseMessage>;
}

/**
 * A callback for one kind of renderer message. It handles the message by
 * returning nothing or `true`, or declines it by returning `false` (directly
 * or through a `Promise`), so the message comes back with `handled: false`,
 * as if the callback weren't set: for example, to let a conversational action
 * reach the model while handling the others locally.
 */
export type RendererMessageCallback<T> = (message: T) => boolean | void | Promise<boolean | void>;

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
 *   when it is set, which may decline the message. Without one the message is
 *   not handled, and nothing is validated beyond its `version`.
 *
 * The processor keeps no state across messages, so build one per agent, or
 * per request from the active catalogs. It processes one message at a time:
 * the caller decides whether to process several concurrently, and how to
 * handle one that fails.
 */
export class RendererToAgentMessageProcessor {
  private readonly _registry: AgentFunctionRegistry;
  private readonly _validator: JsonSchemaValidator;
  private readonly _onAction?: RendererMessageCallback<ActionMessage>;
  private readonly _onError?: RendererMessageCallback<ErrorMessage>;
  private readonly _onRendererFunctionResponse?: RendererMessageCallback<RendererFunctionResponseMessage>;

  /**
   * Initializes a new `RendererToAgentMessageProcessor`.
   *
   * @param options The catalogs, the validator, the agent function timeout and the callbacks.
   * @throws {A2uiConfigurationError} If no validator is given.
   * @throws {RangeError} If `agentFunctionTimeoutMs` is not a finite number
   *   greater than 0.
   * @throws {A2uiCatalogError} If two catalogs have the same id.
   */
  constructor(options: RendererToAgentMessageProcessorOptions) {
    requireValidator(options.validator, 'RendererToAgentMessageProcessorOptions.validator');
    this._validator = options.validator;
    const catalogs = [...options.catalogs];
    // The catalogs' plain JSON Schemas compile with this validator unless the catalog was
    // given one, as for a catalog registered with web_core's MessageProcessor.
    for (const catalog of catalogs) bindCatalogValidator(catalog, options.validator, true);
    this._registry = new AgentFunctionRegistry(catalogs, {
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
   * @throws {A2uiValidationError} If `message` is not an object, its
   *   `version` isn't `'1.0'`, it has no known message key or more than one,
   *   it is a `callAgentFunction` without a `functionCallId`, or it is a
   *   malformed message whose callback is set. An error a callback throws
   *   propagates.
   */
  async processMessage(message: unknown): Promise<ProcessResult> {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      throw new A2uiValidationError(
        `A renderer message must be a JSON object, got ${message === null ? 'null' : Array.isArray(message) ? 'an array' : typeof message}.`,
      );
    }
    const version = (message as {version?: unknown}).version;
    if (version !== '1.0') {
      throw new A2uiValidationError(
        version === undefined
          ? "A renderer message needs version '1.0'."
          : `A renderer message needs version '1.0', not ${JSON.stringify(version)}.`,
      );
    }
    const keys = Object.keys(message).filter(key => key !== 'version');
    if (keys.length === 0) {
      throw new A2uiValidationError(
        `A renderer message needs one of ${MESSAGE_KEYS.join(', ')}; found none.`,
      );
    }
    if (keys.length > 1) {
      throw new A2uiValidationError(
        `A renderer message carries one message, but this one has ${keys.join(', ')}.`,
      );
    }
    const kind = keys[0];
    if (!(MESSAGE_KEYS as readonly string[]).includes(kind)) {
      throw new A2uiValidationError(
        `A renderer message needs one of ${MESSAGE_KEYS.join(', ')}; found ${kind}.`,
      );
    }

    switch (kind as (typeof MESSAGE_KEYS)[number]) {
      case 'callAgentFunction':
        return {handled: true, replies: [await this._registry.handle(message)]};
      case 'action':
        return await this.dispatch(message, this._onAction);
      case 'error':
        return await this.dispatch(message, this._onError);
      case 'rendererFunctionResponse':
        return await this.dispatch(message, this._onRendererFunctionResponse);
    }
  }

  private async dispatch<T>(
    message: object,
    callback: RendererMessageCallback<T> | undefined,
  ): Promise<ProcessResult> {
    if (callback === undefined) {
      return {handled: false, replies: []};
    }
    const issues = validateProtocolMessage(this._validator, RENDERER_TO_AGENT_SPEC, message);
    if (issues.length > 0) {
      const issue = pickIssue(issues);
      const at = issue.path.length > 0 ? ` at '${issue.path.join('.')}'` : '';
      throw new A2uiValidationError(
        `Invalid ${Object.keys(message)
          .filter(key => key !== 'version')
          .join(', ')} message: ${messageForIssue(issue)}${at}`,
      );
    }
    const handled = (await callback(message as T)) !== false;
    return {handled, replies: []};
  }
}
