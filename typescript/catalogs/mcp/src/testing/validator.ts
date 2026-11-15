/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {createAjvValidator} from '@a2ui/validator-ajv';
import type {CatalogSchema} from '@a2ui/web_core/schema-engine';

/** The JSON Schema validator the tests build their catalogs and processors with. */
export const validator = createAjvValidator();

/**
 * Validates `value` with `schema`, as `schema.parse` did for a zod schema.
 *
 * @returns The validated value.
 * @throws {Error} Listing the issues, when `value` does not match.
 */
export function parseWith<T>(schema: CatalogSchema<T>, value: unknown): T {
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) {
    throw new Error('Expected a synchronous schema.');
  }
  if (result.issues) {
    throw new Error(result.issues.map(issue => issue.message).join('; '));
  }
  return result.value;
}

/** Whether `value` matches `schema`. */
export function matches(schema: CatalogSchema, value: unknown): boolean {
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) {
    throw new Error('Expected a synchronous schema.');
  }
  return result.issues === undefined;
}
