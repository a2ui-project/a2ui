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

import {
  A2uiValidationError,
  type ProtocolVersion,
  RendererToAgentMessageSchema,
  type V08ClientToServerMessage,
  type V09ClientToServerMessage,
  V09ClientToServerMessageSchema,
  type V10RendererToAgentMessage,
} from '../internal/web-core.js';

/** Discriminated union of validated inbound renderer-to-agent messages across protocol versions. */
export type InboundMessage =
  | V10RendererToAgentMessage
  | V09ClientToServerMessage
  | V08ClientToServerMessage;

/** Discriminated kind of a validated inbound renderer-to-agent message. */
export type InboundMessageKind =
  | 'action'
  | 'error'
  | 'callAgentFunction'
  | 'rendererFunctionResponse';

const V10_MESSAGE_KEYS = new Set([
  'action',
  'error',
  'callAgentFunction',
  'rendererFunctionResponse',
]);
const V09_MESSAGE_KEYS = new Set(['action', 'error']);
const V08_MESSAGE_KEYS = new Set(['userAction', 'error']);

const V08UserActionSchema = z
  .object({
    name: z.string(),
    surfaceId: z.string(),
    sourceComponentId: z.string(),
    timestamp: z.string(),
    context: z.record(z.string(), z.unknown()),
  })
  .strict();

const V08ClientToServerMessageSchema = z.union([
  z.object({userAction: V08UserActionSchema}).strict(),
  z.object({error: z.record(z.string(), z.unknown())}).strict(),
]);

/**
 * Validates a raw renderer-to-agent message against the versioned wire schema.
 *
 * @param data Raw decoded JSON payload received from the renderer.
 * @param version Target A2UI protocol version. Defaults to `'1.0'`.
 * @returns The validated {@link InboundMessage}.
 * @throws {A2uiValidationError} When `data` is not an object, violates the
 *   envelope structure, mismatches the expected protocol version, or fails
 *   schema validation.
 */
export function parseInboundMessage(
  data: unknown,
  version: ProtocolVersion = '1.0',
): InboundMessage {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new A2uiValidationError('Inbound renderer message must be a JSON object.');
  }

  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);

  if (version === '1.0') {
    const presentKeys = keys.filter(k => V10_MESSAGE_KEYS.has(k));
    if (presentKeys.length !== 1 || keys.length !== 2 || !keys.includes('version')) {
      throw new A2uiValidationError(
        "v1.0 inbound message must contain 'version' and exactly one of 'action', 'error', 'callAgentFunction', or 'rendererFunctionResponse'.",
      );
    }
    if (record['version'] !== '1.0') {
      throw new A2uiValidationError(
        `v1.0 inbound message must declare version '1.0', got ${JSON.stringify(record['version'])}.`,
      );
    }
    const result = RendererToAgentMessageSchema.safeParse(record);
    if (!result.success) {
      throw new A2uiValidationError(
        `Invalid v1.0 inbound renderer message: ${result.error.message}`,
      );
    }
    return result.data;
  }

  if (version === 'v0.9' || version === 'v0.9.1') {
    const presentKeys = keys.filter(k => V09_MESSAGE_KEYS.has(k));
    if (presentKeys.length !== 1 || keys.length !== 2 || !keys.includes('version')) {
      throw new A2uiValidationError(
        "v0.9 inbound message must contain 'version' and exactly one of 'action' or 'error'.",
      );
    }
    if (record['version'] !== 'v0.9' && record['version'] !== 'v0.9.1') {
      throw new A2uiValidationError(
        `v0.9 inbound message must declare version 'v0.9' or 'v0.9.1', got ${JSON.stringify(record['version'])}.`,
      );
    }
    const result = V09ClientToServerMessageSchema.safeParse(record);
    if (!result.success) {
      throw new A2uiValidationError(
        `Invalid v0.9 inbound renderer message: ${result.error.message}`,
      );
    }
    return result.data;
  }

  if (version === 'v0.8') {
    if ('version' in record && record['version'] !== 'v0.8') {
      throw new A2uiValidationError(
        `v0.8 inbound message cannot declare mismatched version ${JSON.stringify(record['version'])}.`,
      );
    }
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (k !== 'version') {
        payload[k] = v;
      }
    }
    const payloadKeys = Object.keys(payload);
    const presentKeys = payloadKeys.filter(k => V08_MESSAGE_KEYS.has(k));
    if (presentKeys.length !== 1 || payloadKeys.length !== 1) {
      throw new A2uiValidationError(
        "v0.8 inbound message must contain exactly one of 'userAction' or 'error'.",
      );
    }
    const result = V08ClientToServerMessageSchema.safeParse(payload);
    if (!result.success) {
      throw new A2uiValidationError(
        `Invalid v0.8 inbound renderer message: ${result.error.message}`,
      );
    }
    return result.data as V08ClientToServerMessage;
  }

  throw new A2uiValidationError(`Unsupported A2UI protocol version: ${String(version)}`);
}

/**
 * Returns the discriminated kind of a validated inbound message.
 */
export function getInboundMessageKind(message: InboundMessage): InboundMessageKind {
  if ('action' in message && message.action !== undefined) {
    return 'action';
  }
  if ('userAction' in message && message.userAction !== undefined) {
    return 'action';
  }
  if ('error' in message && message.error !== undefined) {
    return 'error';
  }
  if ('callAgentFunction' in message && message.callAgentFunction !== undefined) {
    return 'callAgentFunction';
  }
  if ('rendererFunctionResponse' in message && message.rendererFunctionResponse !== undefined) {
    return 'rendererFunctionResponse';
  }
  throw new A2uiValidationError('Unrecognized inbound message variant.');
}

/**
 * Formats an inbound action or error message for LLM context consumption.
 *
 * @param message Validated inbound message returned by {@link parseInboundMessage}.
 * @returns A structured text description of the user action or renderer error
 *   suitable for model input, or `undefined` for RPC messages
 *   (`callAgentFunction` and `rendererFunctionResponse`) handled by the
 *   orchestration layer.
 */
export function formatInboundForModel(message: InboundMessage): string | undefined {
  if ('action' in message && message.action !== undefined) {
    const action = message.action;
    return `User triggered action '${action.name}' on surface '${action.surfaceId}' (component '${action.sourceComponentId}') with context: ${JSON.stringify(action.context)}`;
  }

  if ('userAction' in message && message.userAction !== undefined) {
    const action = message.userAction;
    return `User triggered action '${action.name}' on surface '${action.surfaceId}' (component '${action.sourceComponentId}') with context: ${JSON.stringify(action.context)}`;
  }

  if ('error' in message && message.error !== undefined) {
    const error = message.error as Record<string, unknown>;
    const code = typeof error['code'] === 'string' ? error['code'] : undefined;
    const msg = typeof error['message'] === 'string' ? error['message'] : undefined;
    const path = typeof error['path'] === 'string' ? error['path'] : undefined;
    const surfaceId = typeof error['surfaceId'] === 'string' ? error['surfaceId'] : undefined;
    const functionCallId =
      typeof error['functionCallId'] === 'string' ? error['functionCallId'] : undefined;

    if (code !== undefined && msg !== undefined) {
      if (path !== undefined && surfaceId !== undefined) {
        return `Renderer reported error '${code}' on surface '${surfaceId}' at path '${path}': ${msg}`;
      }
      if (surfaceId !== undefined) {
        return `Renderer reported error '${code}' on surface '${surfaceId}': ${msg}`;
      }
      if (functionCallId !== undefined) {
        return `Renderer reported error '${code}' for function call '${functionCallId}': ${msg}`;
      }
    }
    return `Renderer reported error: ${JSON.stringify(error)}`;
  }

  if (
    ('callAgentFunction' in message && message.callAgentFunction !== undefined) ||
    ('rendererFunctionResponse' in message && message.rendererFunctionResponse !== undefined)
  ) {
    return undefined;
  }

  throw new A2uiValidationError('Unrecognized inbound message variant.');
}
