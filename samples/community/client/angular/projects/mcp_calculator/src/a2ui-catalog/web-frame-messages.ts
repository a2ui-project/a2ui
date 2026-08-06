/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {z} from 'zod';

/**
 * A2UI protocol message types for cross-frame communication.
 * These string literals represent the message types used to sync state,
 * invoke functions, and handle lifecycle events between the host application
 * and the sandboxed web app frames.
 */
export const A2uiMessageType = {
  Action: 'a2ui_action',
  DataModelChange: 'a2ui_data_model_change',
  DataModelUpdate: 'a2ui_data_model_update',
  FunctionCall: 'a2ui_function_call',
  FunctionResult: 'a2ui_function_result',
  SandboxProxyReady: 'a2ui_sandbox_proxy_ready',
  SandboxResourceReady: 'a2ui_sandbox_resource_ready',
  AppFrameReady: 'a2ui_app_frame_ready',
  AppFrameInit: 'a2ui_app_frame_init',
  SizeChanged: 'a2ui_size_changed',
  HostContextUpdate: 'a2ui_host_context_update',
} as const;

/**
 * Zod schema defining the expected structure of incoming messages from the sandboxed
 * web frame. It uses a discriminated union on the `type` field to strongly type
 * the payload for each specific message type (e.g., actions, data changes, function calls).
 */
export const IncomingWebFrameMessageSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal(A2uiMessageType.SandboxProxyReady)}),
  z.object({type: z.literal(A2uiMessageType.AppFrameReady)}),
  z.object({
    type: z.literal(A2uiMessageType.Action),
    action: z.string(),
    data: z.any().optional(),
  }),
  z.object({
    type: z.literal(A2uiMessageType.DataModelChange),
    key: z.string(),
    subpath: z.string().optional(),
    value: z.any(),
  }),
  z.object({
    type: z.literal(A2uiMessageType.FunctionCall),
    call: z.string(),
    callId: z.union([z.string(), z.number()]),
    args: z.any().optional(),
  }),
  z.object({
    type: z.literal(A2uiMessageType.SizeChanged),
    width: z.number().optional(),
    height: z.number().optional(),
  }),
]);

export type IncomingWebFrameMessage = z.infer<typeof IncomingWebFrameMessageSchema>;

/**
 * Shared base Zod schema for A2UI WebAppFrame components.
 * Contains common optional properties shared across URL-based and HTML-based frames.
 */
export const WebAppFrameBasePropsSchema = z.object({
  config: z.record(z.unknown()).optional(),
  data: z.any().optional(),
  allowedEvents: z.record(z.unknown()).optional(),
  allowedFunctions: z.record(z.unknown()).optional(),
  mutableData: z.record(z.unknown()).optional(),
  disableSchemaValidation: z.boolean().optional(),
});
