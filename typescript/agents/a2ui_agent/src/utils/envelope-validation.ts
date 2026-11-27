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

import {A2uiCatalogError} from '../errors.js';
import {
  A2uiValidationError,
  normalizeVersionString,
  validateAgentToRendererEnvelope,
  type ValidationIssue,
} from '../internal/web-core.js';
import {
  MSG_TYPE_CREATE_SURFACE,
  MSG_TYPE_UPDATE_COMPONENTS,
  MSG_TYPE_UPDATE_DATA_MODEL,
  MSG_TYPE_DELETE_SURFACE,
} from '../parser/constants.js';

const MSG_TYPE_CALL_RENDERER_FUNCTION = 'callRendererFunction';
const MSG_TYPE_AGENT_FUNCTION_RESPONSE = 'agentFunctionResponse';

const V09_MESSAGE_KEYS: readonly string[] = [
  MSG_TYPE_CREATE_SURFACE,
  MSG_TYPE_UPDATE_COMPONENTS,
  MSG_TYPE_UPDATE_DATA_MODEL,
  MSG_TYPE_DELETE_SURFACE,
];

const V10_MESSAGE_KEYS: readonly string[] = [
  MSG_TYPE_CREATE_SURFACE,
  MSG_TYPE_UPDATE_COMPONENTS,
  MSG_TYPE_UPDATE_DATA_MODEL,
  MSG_TYPE_DELETE_SURFACE,
  MSG_TYPE_CALL_RENDERER_FUNCTION,
  MSG_TYPE_AGENT_FUNCTION_RESPONSE,
];

function knownEnvelopeKeysFor(protocolVersion: string): readonly string[] {
  const normalized = normalizeVersionString(protocolVersion);
  if (normalized === '0.9' || normalized.startsWith('0.9.')) {
    return V09_MESSAGE_KEYS;
  }
  if (normalized === '1.0') {
    return V10_MESSAGE_KEYS;
  }
  throw new A2uiCatalogError(`No message schemas for protocol version '${protocolVersion}'.`);
}

/**
 * Formats zero-dependency validation issues into an A2uiValidationError message.
 *
 * When an underlying issue represents a missing required property, includes the
 * phrase `'<key>' is a required property` to match the vocabulary used by
 * language-agnostic conformance assertions.
 */
function formatValidationErrorMessage(issues: readonly ValidationIssue[]): string {
  for (const issue of issues) {
    if (issue.code === 'invalid_type' && issue.received === 'undefined') {
      const key = issue.path[issue.path.length - 1];
      if (typeof key === 'string') {
        return `Validation failed: '${key}' is a required property (${issue.message})`;
      }
    }
  }

  const primaryIssue = issues[0];
  if (!primaryIssue) {
    return 'Validation failed';
  }
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
  const knownKeys = knownEnvelopeKeysFor(protocolVersion);
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
  const result = validateAgentToRendererEnvelope(obj, protocolVersion);
  if (!result) {
    throw new A2uiCatalogError(`No message schemas for protocol version '${protocolVersion}'.`);
  }
  if (!result.success) {
    throw new A2uiValidationError(formatValidationErrorMessage(result.issues));
  }
}
