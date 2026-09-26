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
  V09CreateSurfaceMessageSchema,
  V09UpdateComponentsMessageSchema,
  V09UpdateDataModelMessageSchema,
  V09DeleteSurfaceMessageSchema,
  V10CreateSurfaceMessageSchema,
  V10UpdateComponentsMessageSchema,
  V10UpdateDataModelMessageSchema,
  V10DeleteSurfaceMessageSchema,
  V10CallRendererFunctionMessageSchema,
  V10AgentFunctionResponseMessageSchema,
} from '../internal/web_core.js';
import {
  MSG_TYPE_CREATE_SURFACE,
  MSG_TYPE_UPDATE_COMPONENTS,
  MSG_TYPE_UPDATE_DATA_MODEL,
  MSG_TYPE_DELETE_SURFACE,
} from '../parser/constants.js';

const MSG_TYPE_CALL_RENDERER_FUNCTION = 'callRendererFunction';
const MSG_TYPE_AGENT_FUNCTION_RESPONSE = 'agentFunctionResponse';

const V09_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [MSG_TYPE_CREATE_SURFACE]: V09CreateSurfaceMessageSchema,
  [MSG_TYPE_UPDATE_COMPONENTS]: V09UpdateComponentsMessageSchema,
  [MSG_TYPE_UPDATE_DATA_MODEL]: V09UpdateDataModelMessageSchema,
  [MSG_TYPE_DELETE_SURFACE]: V09DeleteSurfaceMessageSchema,
};

const V10_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [MSG_TYPE_CREATE_SURFACE]: V10CreateSurfaceMessageSchema,
  [MSG_TYPE_UPDATE_COMPONENTS]: V10UpdateComponentsMessageSchema,
  [MSG_TYPE_UPDATE_DATA_MODEL]: V10UpdateDataModelMessageSchema,
  [MSG_TYPE_DELETE_SURFACE]: V10DeleteSurfaceMessageSchema,
  [MSG_TYPE_CALL_RENDERER_FUNCTION]: V10CallRendererFunctionMessageSchema,
  [MSG_TYPE_AGENT_FUNCTION_RESPONSE]: V10AgentFunctionResponseMessageSchema,
};

/**
 * Formats a Zod error into an A2uiValidationError message.
 *
 * When an underlying Zod issue represents a missing required property,
 * includes the phrase `'<key>' is a required property` to match the vocabulary
 * used by language-agnostic conformance assertions.
 */
function formatZodValidationErrorMessage(error: z.ZodError): string {
  for (const issue of error.issues) {
    if (issue.code === 'invalid_type' && issue.received === 'undefined') {
      const key = issue.path[issue.path.length - 1];
      if (typeof key === 'string') {
        return `Validation failed: '${key}' is a required property (${issue.message})`;
      }
    }
  }

  const primaryIssue = error.issues[0];
  const pathStr = primaryIssue.path.length > 0 ? ` at '${primaryIssue.path.join('.')}'` : '';
  return `Validation failed: ${primaryIssue.message}${pathStr}`;
}

/**
 * Validates an inbound server-to-client message envelope against the protocol schema.
 *
 * @param obj The parsed JSON object representing the message.
 * @param protocolVersion Wire protocol version string (e.g. 'v0.9', 'v1.0').
 * @throws {A2uiValidationError} If validation fails or if the envelope key is unknown.
 */
export function validateEnvelope(obj: Record<string, unknown>, protocolVersion: string): void {
  const schemas = protocolVersion.startsWith('v0.9') ? V09_SCHEMAS : V10_SCHEMAS;

  const knownKeys = Object.keys(schemas);
  const matchingKey = knownKeys.find(key => key in obj);

  if (!matchingKey) {
    const presentKeys = Object.keys(obj).join(', ');
    throw new A2uiValidationError(
      `Validation failed: unknown message type in envelope. Present keys: [${presentKeys}]`,
    );
  }

  // Validate the envelope exactly as received. The schema requires `version`, and Python
  // does not fill one in before validating (streaming_v09.py, _handle_complete_object), so
  // supplying a default here would accept envelopes Python rejects.
  const result = schemas[matchingKey].safeParse(obj);
  if (!result.success) {
    throw new A2uiValidationError(formatZodValidationErrorMessage(result.error));
  }
}
