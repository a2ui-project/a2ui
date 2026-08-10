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

/**
 * Security constants for cross-frame message payload validation.
 */
export const MAX_PAYLOAD_NESTING_DEPTH = 10;
export const MAX_PAYLOAD_SIZE_BYTES = 64 * 1024; // 64 KB
export const FORBIDDEN_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface PayloadSecurityResult {
  valid: boolean;
  reason?: string;
}

/**
 * Recursively scans a value or payload object for prototype pollution keys
 * (`__proto__`, `constructor`, `prototype`) and verifies that the nesting depth
 * does not exceed the maximum allowed depth (default 10 levels).
 *
 * @param value The value to inspect.
 * @param maxDepth The maximum permitted nesting depth (defaults to 10).
 * @param currentDepth Current recursion depth level.
 * @returns An object indicating whether the payload is safe, with an error reason if not.
 */
function validatePayloadSecurity(
  value: unknown,
  maxDepth = MAX_PAYLOAD_NESTING_DEPTH,
  currentDepth = 0,
): PayloadSecurityResult {
  if (currentDepth > maxDepth) {
    return {
      valid: false,
      reason: `Exceeded maximum allowed nesting depth of ${maxDepth} levels`,
    };
  }

  if (value === null || typeof value !== 'object') {
    return {valid: true};
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const result = validatePayloadSecurity(value[i], maxDepth, currentDepth + 1);
      if (!result.valid) {
        return result;
      }
    }
    return {valid: true};
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.getOwnPropertyNames(obj);
  for (const key of keys) {
    if (FORBIDDEN_PROTOTYPE_KEYS.has(key)) {
      return {
        valid: false,
        reason: `Detected forbidden prototype pollution property key: "${key}"`,
      };
    }
    const propVal = obj[key];
    const result = validatePayloadSecurity(propVal, maxDepth, currentDepth + 1);
    if (!result.valid) {
      return result;
    }
  }

  return {valid: true};
}

/**
 * Validates the overall security of an incoming message from a sandboxed frame,
 * checking that its serialized byte length does not exceed 64 KB, that it does
 * not contain prototype pollution keys, and that its nesting depth does not exceed 10 levels.
 *
 * @param rawMessage The incoming raw message data.
 * @returns An object indicating whether the message is safe to process.
 */
export function validateMessageSecurity(rawMessage: unknown): PayloadSecurityResult {
  if (rawMessage === null || rawMessage === undefined) {
    return {valid: true};
  }

  const securityCheck = validatePayloadSecurity(rawMessage);
  if (!securityCheck.valid) {
    return securityCheck;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(rawMessage);
  } catch {
    return {
      valid: false,
      reason: 'Failed to serialize message payload for size inspection',
    };
  }

  if (serialized && serialized.length > MAX_PAYLOAD_SIZE_BYTES) {
    return {
      valid: false,
      reason: `Message payload exceeds maximum allowed size of ${MAX_PAYLOAD_SIZE_BYTES} bytes (${serialized.length} bytes)`,
    };
  }

  return {valid: true};
}
