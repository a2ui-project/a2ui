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

import type {StandardSchemaV1} from '@standard-schema/spec';

import {entrySchema, type AuthoredSchema} from '../catalog/entry-schema.js';
import type {SchemaCursor} from '../schema-engine/nav.js';

/**
 * The JSON Schema discovery reads for a component schema, as a catalog of
 * `protocolVersion` registers it (v1.0 when omitted).
 */
export function cursorOf(schema: AuthoredSchema, protocolVersion?: string): SchemaCursor {
  return entrySchema({name: 'Test', schema}, 'component', {protocolVersion})!.cursor;
}

/** Validates `value` with a schema's `~standard.validate`, which must be synchronous. */
function standardResult(schema: unknown, value: unknown) {
  const result = (schema as StandardSchemaV1)['~standard'].validate(value);
  if (result instanceof Promise) throw new Error('Expected synchronous validation.');
  return result;
}

/** Whether a schema (a Standard Schema, such as a catalog entry's) accepts `value`. */
export function accepts(schema: unknown, value: unknown): boolean {
  return !standardResult(schema, value).issues;
}

/** The value a schema validates `value` to; throws if it rejects it. */
export function validated(schema: unknown, value: unknown): unknown {
  const result = standardResult(schema, value);
  if (result.issues) {
    throw new Error(`Rejected: ${result.issues.map(issue => issue.message).join('; ')}`);
  }
  return result.value;
}
