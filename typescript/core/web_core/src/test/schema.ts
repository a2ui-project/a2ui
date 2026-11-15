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

import {commonTypesFor, entrySchema, type AuthoredSchema} from '../catalog/entry-schema.js';
import {isAtLeastVersion} from '../common/semver.js';
import {fromJsonSchema} from '../schema-engine/from-json-schema.js';
import type {SchemaCursor} from '../schema-engine/nav.js';
import type {A2uiIssue, CatalogSchema, JsonSchema} from '../schema-engine/types.js';
import V09EnvelopeCatalog from '../v0_9/envelope_catalog.json' with {type: 'json'};
import V10EnvelopeCatalog from '../v1_0/envelope_catalog.json' with {type: 'json'};
import {testValidator} from './validator.js';

/**
 * A JSON Schema fixture as a `CatalogSchema`, compiled with the shared test
 * validator. `common_types.json` is the protocol version's common types (v1.0
 * when omitted), and `catalog.json` its envelope catalog, so a fixture may
 * reference common types such as `common_types.json#/$defs/DynamicString`.
 */
export function jsonFixture<T = any>(
  schema: JsonSchema,
  protocolVersion = '1.0',
): CatalogSchema<T> {
  const atLeastV10 = isAtLeastVersion(protocolVersion, '1.0');
  return fromJsonSchema<T>(schema, testValidator, {
    defs: {
      'common_types.json': commonTypesFor(protocolVersion),
      'catalog.json': (atLeastV10 ? V10EnvelopeCatalog : V09EnvelopeCatalog) as JsonSchema,
    },
  });
}

/**
 * A hand-rolled `CatalogSchema` whose JSON Schema is `schema` and which
 * accepts any value, for fixtures that are only read (discovery,
 * serialization), such as one referencing a definition no document has.
 */
export function jsonOnlyFixture<T = any>(schema: Record<string, unknown>): CatalogSchema<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: value => ({value: value as T}),
      jsonSchema: {input: () => schema, output: () => schema},
    },
  };
}

/** A spec document compiled for tests, with a `safeParse` that reports success and issues. */
export interface SpecSchema {
  safeParse(value: unknown): {success: boolean; error?: {issues: A2uiIssue[]; message: string}};
}

/**
 * A specification document (such as `renderer_to_agent.json`) compiled with
 * the shared test validator, with the protocol version's common types and
 * envelope catalog as the documents it references.
 */
export function specSchema(schema: JsonSchema, protocolVersion = '1.0'): SpecSchema {
  const atLeastV10 = isAtLeastVersion(protocolVersion, '1.0');
  const validate = testValidator.compile(schema, {
    defs: {
      'common_types.json': commonTypesFor(protocolVersion),
      'catalog.json': (atLeastV10 ? V10EnvelopeCatalog : V09EnvelopeCatalog) as JsonSchema,
    },
  });
  return {
    safeParse(value) {
      const result = validate(value);
      return result.success
        ? {success: true}
        : {
            success: false,
            error: {issues: result.issues, message: JSON.stringify(result.issues)},
          };
    },
  };
}

/** A reference to a definition of the common types, for {@link jsonFixture} schemas. */
export function commonRef(name: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return {$ref: `common_types.json#/$defs/${name}`, ...extra};
}

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
