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
import type {CatalogSchema, CompileOptions, JsonSchema, JsonSchemaValidator} from './types.js';

/** Wraps a JSON Schema and a validator engine into a {@link CatalogSchema}. */
export function fromJsonSchema<T = unknown>(
  schema: JsonSchema,
  validator: JsonSchemaValidator,
  opts?: CompileOptions,
): CatalogSchema<T> {
  const validate = validator.compile<T>(schema, opts);
  const json: Record<string, unknown> =
    typeof schema === 'boolean' ? (schema ? {} : {not: {}}) : schema;
  return {
    '~standard': {
      version: 1,
      vendor: 'a2ui',
      validate: (value: unknown): StandardSchemaV1.Result<T> => {
        const r = validate(value);
        if (r.success) return {value: r.data};
        return {issues: r.issues.map(i => ({message: i.message, path: [...i.path]}))};
      },
      jsonSchema: {input: () => json, output: () => json},
    },
  };
}
