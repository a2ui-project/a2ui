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

import type {StandardJSONSchemaV1, StandardSchemaV1} from '@standard-schema/spec';

/** A JSON Schema document (draft 2020-12); `true`/`false` are boolean schemas. */
export type JsonSchema = boolean | {[k: string]: unknown};

/** An engine-neutral validation issue. */
export interface A2uiIssue {
  /** Path to the offending value, as property names and array indices. */
  path: (string | number)[];
  /** Human-readable message. */
  message: string;
  /** The JSON Schema keyword that failed, if known. */
  keyword?: string;
  /** Engine-provided keyword parameters, if any. */
  params?: Record<string, unknown>;
}

/** Outcome of running a compiled validator. */
export type ValidationResult<T = unknown> =
  | {success: true; data: T}
  | {success: false; issues: A2uiIssue[]};

/** A synchronous validation function produced by a {@link JsonSchemaValidator}. */
export type CompiledValidator<T = unknown> = (value: unknown) => ValidationResult<T>;

/** Options for {@link JsonSchemaValidator.compile}. */
export interface CompileOptions {
  /** Referenced schemas, keyed by `$id` or relative URI (e.g. `'common_types.json'`). */
  defs?: Record<string, JsonSchema>;
}

/** The JSON Schema validator engine supplied by the application. */
export interface JsonSchemaValidator {
  /** Compiles a schema into a synchronous validator. */
  compile<T = unknown>(schema: JsonSchema, opts?: CompileOptions): CompiledValidator<T>;
}

/** A schema that is both validatable and convertible to JSON Schema. */
export type CatalogSchema<T = unknown> = StandardSchemaV1<unknown, T> &
  StandardJSONSchemaV1<unknown, T>;
