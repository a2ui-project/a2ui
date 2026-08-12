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

import {z} from 'zod';
import * as V09 from '../v0_9/schema/index.js';
import * as V10 from '../v1_0/schema/index.js';

export {V09, V10};

/** Enumeration of supported A2UI protocol versions. */
export enum A2uiProtocolVersion {
  V0_8 = 'v0.8',
  V0_9 = 'v0.9',
  V0_9_1 = 'v0.9.1',
  V1_0 = 'v1.0',
}

/** Type alias for v0.9 Server-to-Client message payload. */
export type ServerToClientMessage = V09.A2uiMessage;

/** Type alias for v0.9 Client-to-Server message payload. */
export type ClientToServerMessage = V09.A2uiClientMessage;

/** Union type of all Agent-to-Renderer messages across v0.9 and v1.0 specifications. */
export type AgentToRendererMessage = ServerToClientMessage | V10.AgentToRendererMessage;

/** Zod schema matching any Agent-to-Renderer message across v0.9 and v1.0 specifications. */
export const AgentToRendererMessageSchema = z.union([
  V09.A2uiMessageSchema,
  V10.AgentToRendererMessageSchema,
]);

/** Union type of all Renderer-to-Agent messages across v0.9 and v1.0 specifications. */
export type RendererToAgentMessage = ClientToServerMessage | V10.RendererToAgentMessage;

/** Zod schema matching any Renderer-to-Agent message across v0.9 and v1.0 specifications. */
export const RendererToAgentMessageSchema = z.union([
  V09.A2uiClientMessageSchema,
  V10.RendererToAgentMessageSchema,
]);
