/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {extractA2uiFromToolResult} from './payload-extractor.js';
import {
  McpActionDispatcherOptions,
  McpActionDispatcherSubscription,
  McpClientInterface,
} from './types.js';

/** Minimal interface representing an actionable surface model. */
export interface ActionableSurfaceModel {
  id?: string;
  onAction?: {
    subscribe(listener: (action: unknown) => void | Promise<void>): {
      unsubscribe?: () => void;
      dispose?: () => void;
    };
  };
  dispatchError?(error: {code: string; message: string; [key: string]: unknown}): Promise<void>;
}

/** Action payload dispatched from an A2UI component. */
export interface A2uiActionPayload {
  name: string;
  surfaceId?: string;
  sourceComponentId?: string;
  timestamp?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Creates an MCP Action Dispatcher that automatically translates A2UI surface actions
 * into MCP tools/call requests and processes returned A2UI UI payloads.
 *
 * @param surfaceModel The SurfaceModel or SurfaceGroupModel emitting actions.
 * @param mcpClient The MCP Client instance to invoke tools with.
 * @param options Optional configuration including target message processor and error handlers.
 * @returns A subscription handle that can be unsubscribed when no longer needed.
 */
export function createMcpActionDispatcher(
  surfaceModel: ActionableSurfaceModel,
  mcpClient: McpClientInterface,
  options?: McpActionDispatcherOptions,
): McpActionDispatcherSubscription {
  if (!surfaceModel?.onAction?.subscribe) {
    throw new Error('Provided surface model does not support onAction subscription.');
  }

  const subscription = surfaceModel.onAction.subscribe(async (rawAction: unknown) => {
    const action = rawAction as A2uiActionPayload;
    if (!action || typeof action.name !== 'string') {
      return;
    }

    try {
      const toolArgs = action.context || {};
      const toolResult = await mcpClient.callTool({
        name: action.name,
        arguments: toolArgs,
      });

      const messages = extractA2uiFromToolResult(toolResult);
      if (messages && messages.length > 0 && options?.messageProcessor) {
        if (typeof options.messageProcessor.processMessages === 'function') {
          await options.messageProcessor.processMessages(messages);
        } else if (typeof options.messageProcessor.processMessage === 'function') {
          for (const msg of messages) {
            await options.messageProcessor.processMessage(msg);
          }
        }
      }
    } catch (err) {
      if (options?.onError) {
        options.onError(err);
      }
      if (typeof surfaceModel.dispatchError === 'function') {
        const message = err instanceof Error ? err.message : String(err);
        await surfaceModel.dispatchError({
          code: 'MCP_TOOL_ERROR',
          message: `Failed to execute MCP tool '${action.name}': ${message}`,
        });
      }
    }
  });

  return {
    unsubscribe: () => {
      if (subscription) {
        if (typeof subscription.unsubscribe === 'function') {
          subscription.unsubscribe();
        } else if (typeof (subscription as {dispose?: () => void}).dispose === 'function') {
          (subscription as {dispose: () => void}).dispose();
        }
      }
    },
  };
}
