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

import {type A2uiClientAction, type MessageProcessor} from '@a2ui/web_core/v0_9';
import {MockMcpServer} from './mock-mcp-server.js';

/** Shared client-side mock MCP server instance with simulated network latency. */
export const mockMcpServer = new MockMcpServer();

/**
 * Routes MCP tool actions dispatched by an embedded `<a2ui-mcp-app>` to the client-side
 * `MockMcpServer` (with simulated network latency) and writes the result into the surface
 * DataModel so `McpAppBridge` delivers `ui/notifications/tool-result`.
 */
export async function handleMcpToolAction(
  action: A2uiClientAction,
  processor: MessageProcessor<any>,
  server: MockMcpServer = mockMcpServer,
): Promise<boolean> {
  if (!server.hasTool(action.name)) {
    return false;
  }
  const execution = await server.executeTool(
    action.name,
    (action.context as Record<string, unknown> | undefined) ?? {},
  );
  const surface = processor.model.getSurface(action.surfaceId);
  surface?.dataModel.set(execution.targetDataPath, execution.dataModelValue);
  return true;
}
