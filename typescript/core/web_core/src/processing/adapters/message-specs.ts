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

import type {
  A2uiIssue,
  CompiledValidator,
  JsonSchema,
  JsonSchemaValidator,
} from '../../schema-engine/types.js';
import {
  checkV08ComponentIds,
  checkV08ExactlyOneKey,
  type IntegrityCheck,
} from '../integrity/index.js';

import V08ServerToClient from '../../v0_8/schemas/server_to_client.json' with {type: 'json'};
import V091ServerToClient from '../../v0_9_1/schemas/server_to_client.json' with {type: 'json'};
import V091CommonTypes from '../../v0_9_1/schemas/common_types.json' with {type: 'json'};
import V09EnvelopeCatalog from '../../v0_9/envelope_catalog.json' with {type: 'json'};
import V10AgentToRenderer from '../../v1_0/schemas/agent_to_renderer.json' with {type: 'json'};
import V10CommonTypes from '../../v1_0/schemas/common_types.json' with {type: 'json'};
import V10EnvelopeCatalog from '../../v1_0/envelope_catalog.json' with {type: 'json'};

/**
 * The specification documents an agent-to-renderer message of one protocol
 * version is validated against.
 */
export interface ProtocolMessageSpec {
  /** The spec's message schema. */
  readonly schema: JsonSchema;
  /** Documents the schema references, keyed by relative URI. */
  readonly defs?: Readonly<Record<string, JsonSchema>>;
  /** Checks the schema cannot express, run once the schema check passes. */
  readonly integrity?: readonly IntegrityCheck[];
}

/** v0.8: `server_to_client.json`, which references no other document. */
export const V0_8_MESSAGE_SPEC: ProtocolMessageSpec = {
  schema: V08ServerToClient as JsonSchema,
  integrity: [checkV08ExactlyOneKey, checkV08ComponentIds],
};

/**
 * v0.9 and v0.9.1: the v0.9.1 `server_to_client.json`, which accepts both
 * version strings and otherwise matches v0.9's.
 *
 * `catalog.json` is the envelope catalog (`v0_9/envelope_catalog.json`), so
 * envelopes are checked independently of the surface's catalog.
 */
export const V0_9_MESSAGE_SPEC: ProtocolMessageSpec = {
  schema: V091ServerToClient as JsonSchema,
  defs: {
    'common_types.json': V091CommonTypes as JsonSchema,
    'catalog.json': V09EnvelopeCatalog as JsonSchema,
  },
};

/**
 * v1.0: `agent_to_renderer.json`. `catalog.json` is the envelope catalog
 * (`v1_0/envelope_catalog.json`), so envelopes are checked independently of
 * the surface's catalog.
 */
export const V1_0_MESSAGE_SPEC: ProtocolMessageSpec = {
  schema: V10AgentToRenderer as JsonSchema,
  defs: {
    'common_types.json': V10CommonTypes as JsonSchema,
    'catalog.json': V10EnvelopeCatalog as JsonSchema,
  },
};

const compiledSpecs = new WeakMap<
  JsonSchemaValidator,
  WeakMap<ProtocolMessageSpec, CompiledValidator>
>();

/**
 * Compiles a message spec's schema with `validator`, once per validator and spec.
 *
 * @param validator The application's JSON Schema validator.
 * @param spec The message spec to compile.
 * @returns The compiled schema check.
 */
export function compileMessageSpec(
  validator: JsonSchemaValidator,
  spec: ProtocolMessageSpec,
): CompiledValidator {
  let byspec = compiledSpecs.get(validator);
  if (!byspec) {
    byspec = new WeakMap();
    compiledSpecs.set(validator, byspec);
  }
  let compiled = byspec.get(spec);
  if (!compiled) {
    compiled = validator.compile(spec.schema, {defs: spec.defs ? {...spec.defs} : undefined});
    byspec.set(spec, compiled);
  }
  return compiled;
}

/**
 * Validates a message against a spec's schema and then, if that passes, its
 * integrity checks.
 *
 * @param validator The application's JSON Schema validator.
 * @param spec The message spec to validate against.
 * @param message The message to validate.
 * @returns The issues found; empty when the message is valid.
 */
export function validateProtocolMessage(
  validator: JsonSchemaValidator,
  spec: ProtocolMessageSpec,
  message: unknown,
): A2uiIssue[] {
  const result = compileMessageSpec(validator, spec)(message);
  if (!result.success) {
    return result.issues.length > 0 ? result.issues : [{path: [], message: 'Invalid message'}];
  }
  for (const check of spec.integrity ?? []) {
    const issues = check(message);
    if (issues.length > 0) return issues;
  }
  return [];
}
