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
  type AgentFunctionResponseMessage,
  type ErrorMessage,
  type RendererToAgentMessage,
} from '../internal/web-core.js';
import {AgentFunctionRegistry} from './agent-function-registry.js';
import {RendererFunctionCalls} from './renderer-function-calls.js';

const PAYLOAD_KEYS = ['callAgentFunction', 'rendererFunctionResponse', 'action', 'error'] as const;

/**
 * Options for configuring a {@link RendererMessageRouter}.
 */
export interface RendererMessageRouterOptions {
  /** Handles `callAgentFunction` messages. */
  readonly registry?: AgentFunctionRegistry;
  /** Settles pending calls with `rendererFunctionResponse` messages. */
  readonly rendererCalls?: RendererFunctionCalls;
  /** Callback for `action` messages. */
  readonly onAction?: (
    message: ActionMessage | Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  /** Callback for `error` messages. */
  readonly onError?: (
    message: ErrorMessage | Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  /**
   * Callback for any message with no matching handler or an unknown payload key.
   * When omitted, unhandled messages are ignored (`route` resolves to `null`).
   */
  readonly onUnhandled?: (message: Record<string, unknown>) => unknown | Promise<unknown>;
}

/**
 * Dispatches inbound renderer-to-agent messages (`callAgentFunction`,
 * `rendererFunctionResponse`, `action`, `error`) to their configured handlers.
 */
export class RendererMessageRouter {
  private readonly _registry?: AgentFunctionRegistry;
  private readonly _rendererCalls?: RendererFunctionCalls;
  private readonly _onAction?: (
    message: ActionMessage | Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  private readonly _onError?: (
    message: ErrorMessage | Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  private readonly _onUnhandled?: (message: Record<string, unknown>) => unknown | Promise<unknown>;

  /**
   * Creates a new `RendererMessageRouter`.
   *
   * @param options Optional handlers for each renderer-to-agent message kind.
   */
  constructor(options?: RendererMessageRouterOptions) {
    this._registry = options?.registry;
    this._rendererCalls = options?.rendererCalls;
    this._onAction = options?.onAction;
    this._onError = options?.onError;
    this._onUnhandled = options?.onUnhandled;
  }

  /**
   * Routes one renderer-to-agent message to its configured handler.
   *
   * @param message Parsed JSON message from the renderer.
   * @returns The outbound `agentFunctionResponse` message when routing a
   *   `callAgentFunction` to a configured registry; otherwise `null`.
   * @throws {A2uiValidationError} If `message` is not a plain JSON object or
   *   carries more than one renderer-to-agent payload key.
   */
  async route(
    message: RendererToAgentMessage | Record<string, unknown>,
  ): Promise<AgentFunctionResponseMessage | null> {
    if (!isPlainObject(message)) {
      throw new A2uiValidationError(
        `Renderer message must be a JSON object, got ${Array.isArray(message) ? 'array' : typeof message}.`,
      );
    }

    const present = PAYLOAD_KEYS.filter(key => Object.hasOwn(message, key));
    if (present.length > 1) {
      throw new A2uiValidationError(
        `Renderer message has more than one payload key: ${present.join(', ')}.`,
      );
    }

    if (present.length === 1) {
      const kind = present[0];
      if (kind === 'callAgentFunction') {
        if (this._registry !== undefined) {
          return await this._registry.handle(message);
        }
        return await this._unhandled(message);
      }
      if (kind === 'rendererFunctionResponse') {
        if (this._rendererCalls !== undefined) {
          this._rendererCalls.resolve(message);
          return null;
        }
        return await this._unhandled(message);
      }
      if (kind === 'action') {
        if (this._onAction !== undefined) {
          await this._onAction(message);
          return null;
        }
        return await this._unhandled(message);
      }
      if (kind === 'error') {
        if (this._onError !== undefined) {
          await this._onError(message);
          return null;
        }
        return await this._unhandled(message);
      }
    }

    return await this._unhandled(message);
  }

  private async _unhandled(message: Record<string, unknown>): Promise<null> {
    if (this._onUnhandled !== undefined) {
      await this._onUnhandled(message);
    }
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
