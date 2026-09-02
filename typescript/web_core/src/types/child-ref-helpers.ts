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

import {z} from 'zod';

/**
 * Classification kind for a schema marked as a child reference.
 */
export type ChildRefKind = 'component-id' | 'child-list';

/**
 * Stamps the child-reference kind into the schema's zod metadata. Methods
 * like `.describe()` and `.optional()` rebuild schemas from `_def`, so the
 * flag survives them; the `REF:` description remains the wire-facing pointer
 * the capabilities generator resolves into a `$ref`.
 */
export function markChildRef<T extends z.ZodTypeAny>(schema: T, ref: ChildRefKind): T {
  (schema._def as {a2uiChildRef?: ChildRefKind}).a2uiChildRef = ref;
  return schema;
}

/**
 * Extracts the child reference kind associated with a Zod schema, if present.
 *
 * @param schema Zod schema to inspect.
 * @returns The child reference kind or undefined if not marked.
 */
export function childRefKindOf(schema: z.ZodTypeAny): ChildRefKind | undefined {
  return (schema?._def as {a2uiChildRef?: ChildRefKind} | undefined)?.a2uiChildRef;
}

/**
 * Options for generating child reference schemas with custom descriptions.
 */
export interface RefSchemaOptions {
  /** Prose appended after the `REF:` pointer; shown in generated capabilities. */
  readonly description?: string;
}
