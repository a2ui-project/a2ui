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
  type A2uiIssue,
  type JsonSchema,
  type JsonSchemaValidator,
  messageForIssue,
  normalizeVersionString,
  pickIssue,
  type ProtocolMessageSpec,
  V0_9_MESSAGE_SPEC,
  V1_0_MESSAGE_SPEC,
  validateProtocolMessage,
} from '../internal/web-core.js';
import {
  MSG_TYPE_CREATE_SURFACE,
  MSG_TYPE_UPDATE_COMPONENTS,
  MSG_TYPE_UPDATE_DATA_MODEL,
  MSG_TYPE_DELETE_SURFACE,
} from '../parser/constants.js';

const MSG_TYPE_CALL_RENDERER_FUNCTION = 'callRendererFunction';
const MSG_TYPE_AGENT_FUNCTION_RESPONSE = 'agentFunctionResponse';

/**
 * The spec of one message of a protocol version: the version's message document with its
 * root replaced by a `$ref` to the message's definition, so a message is checked against
 * that definition alone and its issues are not mixed with the other messages'.
 */
function messageSpec(spec: ProtocolMessageSpec, definition: string): ProtocolMessageSpec {
  const document = spec.schema as Record<string, unknown>;
  const schema: JsonSchema = {
    $schema: document['$schema'],
    $id: document['$id'],
    $defs: document['$defs'],
    $ref: `#/$defs/${definition}`,
  };
  return {schema, defs: spec.defs};
}

const V09_SPECS: Record<string, ProtocolMessageSpec> = {
  [MSG_TYPE_CREATE_SURFACE]: messageSpec(V0_9_MESSAGE_SPEC, 'CreateSurfaceMessage'),
  [MSG_TYPE_UPDATE_COMPONENTS]: messageSpec(V0_9_MESSAGE_SPEC, 'UpdateComponentsMessage'),
  [MSG_TYPE_UPDATE_DATA_MODEL]: messageSpec(V0_9_MESSAGE_SPEC, 'UpdateDataModelMessage'),
  [MSG_TYPE_DELETE_SURFACE]: messageSpec(V0_9_MESSAGE_SPEC, 'DeleteSurfaceMessage'),
};

const V10_SPECS: Record<string, ProtocolMessageSpec> = {
  [MSG_TYPE_CREATE_SURFACE]: messageSpec(V1_0_MESSAGE_SPEC, 'CreateSurfaceMessage'),
  [MSG_TYPE_UPDATE_COMPONENTS]: messageSpec(V1_0_MESSAGE_SPEC, 'UpdateComponentsMessage'),
  [MSG_TYPE_UPDATE_DATA_MODEL]: messageSpec(V1_0_MESSAGE_SPEC, 'UpdateDataModelMessage'),
  [MSG_TYPE_DELETE_SURFACE]: messageSpec(V1_0_MESSAGE_SPEC, 'DeleteSurfaceMessage'),
  [MSG_TYPE_CALL_RENDERER_FUNCTION]: messageSpec(V1_0_MESSAGE_SPEC, 'CallRendererFunctionMessage'),
  [MSG_TYPE_AGENT_FUNCTION_RESPONSE]: messageSpec(
    V1_0_MESSAGE_SPEC,
    'AgentFunctionResponseMessage',
  ),
};

/**
 * Returns the agent-to-renderer message specs of a protocol version, keyed by the envelope
 * name each message carries (`createSurface`, `updateComponents`, and so on).
 *
 * The specs are the specification's message documents that web_core validates against, so
 * they always match the protocol the renderer validates against.
 *
 * @param protocolVersion Protocol version in any spelling a catalog uses.
 * @throws {A2uiCatalogError} If the SDK has no message schemas for the version.
 */
export function envelopeSpecsFor(protocolVersion: string): Record<string, ProtocolMessageSpec> {
  const normalized = normalizeVersionString(protocolVersion);
  if (normalized === '0.9' || normalized.startsWith('0.9.')) {
    return V09_SPECS;
  }
  if (normalized === '1.0') {
    return V10_SPECS;
  }
  throw new A2uiCatalogError(`No message schemas for protocol version '${protocolVersion}'.`);
}

/**
 * Formats the most specific issue of a failed envelope check into an A2uiValidationError
 * message.
 *
 * A missing required property is reported as `'<key>' is a required property`, the
 * vocabulary of the language-agnostic conformance assertions.
 */
function formatValidationErrorMessage(issues: A2uiIssue[]): string {
  const issue = pickIssue(issues);
  const missing = issue.params?.['missingProperty'];
  let path = issue.path;
  let message = messageForIssue(issue);
  if (issue.keyword === 'required' && typeof missing === 'string') {
    message = `'${missing}' is a required property`;
    // Engines may end the path with the missing property; the message names it already.
    if (path[path.length - 1] === missing) path = path.slice(0, -1);
  }
  const at = path.length > 0 ? ` at '${path.join('.')}'` : '';
  return `Validation failed: ${message}${at}`;
}

/**
 * Validates an inbound server-to-client message envelope against the protocol schema.
 *
 * @param obj The parsed JSON object representing the message.
 * @param protocolVersion Wire protocol version string (e.g. 'v0.9', 'v1.0').
 * @param validator The JSON Schema validator the message schema is compiled with.
 * @throws {A2uiValidationError} If validation fails or if the envelope key is unknown.
 */
export function validateEnvelope(
  obj: Record<string, unknown>,
  protocolVersion: string,
  validator: JsonSchemaValidator,
): void {
  const specs = envelopeSpecsFor(protocolVersion);

  const knownKeys = Object.keys(specs);
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
  const issues = validateProtocolMessage(validator, specs[matchingKey], obj);
  if (issues.length > 0) {
    throw new A2uiValidationError(formatValidationErrorMessage(issues));
  }
}
