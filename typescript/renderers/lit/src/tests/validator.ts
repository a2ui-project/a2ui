/*
 * Copyright 2026 Google LLC
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

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {A2uiIssue, CompiledValidator, JsonSchema} from '@a2ui/web_core';
import {createAjvValidator} from '@a2ui/validator-ajv';

/** The JSON Schema validator the tests build processors and catalogs with. */
export const validator = createAjvValidator();

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../../..');

function readSpec(relPath: string): JsonSchema {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'specification', relPath), 'utf8'));
}

// Stands in for the `catalog.json` the v1.0 common types reference, as
// web_core's envelope catalog does, so an outbound message is checked against
// the protocol independently of any particular catalog.
const ENVELOPE_CATALOG: JsonSchema = {
  $defs: {
    anyComponent: {
      type: 'object',
      properties: {component: {type: 'string'}},
      required: ['component'],
      additionalProperties: true,
    },
    anyFunction: {
      type: 'object',
      properties: {'@call': {not: {const: '@index'}}},
      additionalProperties: true,
    },
  },
};

let outboundValidators:
  | {v09: CompiledValidator<unknown>; v10: CompiledValidator<unknown>}
  | undefined;

/**
 * Validates a renderer-to-agent message against the specification's JSON
 * Schema of its protocol version: `client_to_server.json` (v0.9.1) for v0.9,
 * else `renderer_to_agent.json` (v1.0).
 *
 * @returns The validation issues; empty when the message is valid.
 */
export function outboundIssues(message: unknown, protocolVersion: string): A2uiIssue[] {
  outboundValidators ??= {
    v09: validator.compile(readSpec('v0_9_1/json/client_to_server.json')),
    v10: validator.compile(readSpec('v1_0/json/renderer_to_agent.json'), {
      defs: {
        'common_types.json': readSpec('v1_0/json/common_types.json'),
        'catalog.json': ENVELOPE_CATALOG,
      },
    }),
  };
  const isV09 = protocolVersion.startsWith('v0.9') || protocolVersion.startsWith('0.9');
  const result = (isV09 ? outboundValidators.v09 : outboundValidators.v10)(message);
  return result.success ? [] : result.issues;
}
