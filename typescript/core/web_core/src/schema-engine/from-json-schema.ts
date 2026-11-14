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
import {A2uiConfigurationError} from '../errors.js';
import {applyDefaults} from './defaults.js';
import {toStandardIssue} from './issues.js';
import type {SchemaCursor} from './nav.js';
import type {
  CatalogSchema,
  CompileOptions,
  CompiledValidator,
  JsonSchema,
  JsonSchemaValidator,
} from './types.js';

/** The documents each JSON-backed schema validates with, by schema. */
const schemaDocuments = new WeakMap<object, Readonly<Record<string, JsonSchema>>>();

/** Where discovery reads a schema that sits in a document of its own, by schema. */
const schemaCursors = new WeakMap<object, SchemaCursor>();

/**
 * The referenced documents (`CompileOptions.defs`) a schema made by
 * {@link fromJsonSchema} validates with, so discovery can follow its `$ref`s
 * into the same documents; `undefined` for any other schema.
 */
export function jsonSchemaDocuments(
  schema: unknown,
): Readonly<Record<string, JsonSchema>> | undefined {
  return typeof schema === 'object' && schema !== null ? schemaDocuments.get(schema) : undefined;
}

/**
 * Where discovery reads a schema made by {@link namedJsonSchema} with a
 * cursor: the schema as it sits in its document, whose own definitions stay
 * local to it; `undefined` for any other schema, which discovery reads from
 * its JSON Schema.
 */
export function jsonSchemaCursor(schema: unknown): SchemaCursor | undefined {
  return typeof schema === 'object' && schema !== null ? schemaCursors.get(schema) : undefined;
}

/**
 * Whether `schema` was made by {@link fromJsonSchema} or
 * {@link namedJsonSchema}, whose validation is synchronous by construction
 * (a `JsonSchemaValidator` compiles to a synchronous function).
 */
export function isJsonBackedSchema(schema: unknown): boolean {
  return jsonSchemaDocuments(schema) !== undefined;
}

function wrap<T>(
  schema: JsonSchema,
  opts: CompileOptions | undefined,
  compiled: () => CompiledValidator<T>,
): CatalogSchema<T> {
  const json: Record<string, unknown> =
    typeof schema === 'boolean' ? (schema ? {} : {not: {}}) : schema;
  const defs = {...opts?.defs};
  const doc = {root: json, defs};
  const result: CatalogSchema<T> = {
    '~standard': {
      version: 1,
      vendor: 'a2ui',
      validate: (value: unknown): StandardSchemaV1.Result<T> => {
        const r = compiled()(value);
        if (r.success) return {value: applyDefaults(r.data, json, doc) as T};
        return {issues: r.issues.map(toStandardIssue)};
      },
      jsonSchema: {input: () => json, output: () => json},
    },
  };
  schemaDocuments.set(result, defs);
  return result;
}

/**
 * Wraps a JSON Schema and a validator engine into a {@link CatalogSchema}.
 *
 * A value that passes is returned with the schema's `default`s filled in, on
 * a copy (see `applyDefaults`), so a JSON-backed schema behaves like a
 * library schema that applies its own defaults. A failure's issues keep the
 * engine's `keyword` and `params`, which `toA2uiIssues` reads back.
 *
 * `jsonSchema.input` and `jsonSchema.output` return `schema` itself for any
 * `target`: it is already draft 2020-12, the only target web_core asks for.
 */
export function fromJsonSchema<T = unknown>(
  schema: JsonSchema,
  validator: JsonSchemaValidator,
  opts?: CompileOptions,
): CatalogSchema<T> {
  const validate = validator.compile<T>(schema, opts);
  return wrap(schema, opts, () => validate);
}

/**
 * {@link fromJsonSchema} for a schema that names where it comes from: a
 * schema the engine can't compile fails with an error that names it, and
 * discovery can be told where the schema sits in its document.
 *
 * @param what Names the schema in the error a failed compilation raises,
 *   such as `Component 'Text' of catalog 'x'`.
 * @param cursor Where discovery reads the schema (see
 *   {@link jsonSchemaCursor}), when `schema` is a copy of a node of one of
 *   `opts.defs`.
 * @throws {A2uiConfigurationError} If the engine can't compile the schema,
 *   such as for a `$ref` into a document it isn't given.
 * @internal
 */
export function namedJsonSchema<T = unknown>(
  schema: JsonSchema,
  validator: JsonSchemaValidator,
  opts: CompileOptions | undefined,
  what: string,
  cursor?: SchemaCursor,
): CatalogSchema<T> {
  let validate: CompiledValidator<T>;
  try {
    validate = validator.compile<T>(schema, opts);
  } catch (err: unknown) {
    throw new A2uiConfigurationError(
      `${what}: its JSON Schema could not be compiled: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = wrap(schema, opts, () => validate);
  if (cursor) schemaCursors.set(result, cursor);
  return result;
}
