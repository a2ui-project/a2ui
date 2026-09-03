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
import {
  type ChildRefKind,
  type RefSchemaOptions,
  markChildRef,
  childRefKindOf,
} from './child-ref-helpers.js';
import {ChildListSchema, ComponentIdSchema} from './common-types.js';

export {type ChildRefKind, type RefSchemaOptions, markChildRef, childRefKindOf};

/**
 * Creates or customizes a ComponentId schema without losing its reference pointer metadata.
 *
 * @param options Configuration options including custom description.
 * @returns The configured ComponentId schema.
 */
export function componentId(options: RefSchemaOptions = {}): typeof ComponentIdSchema {
  if (options.description === undefined) {
    return ComponentIdSchema;
  }
  return ComponentIdSchema.describe(
    `REF:common_types.json#/$defs/ComponentId|\${options.description}`,
  );
}

/**
 * Creates or customizes a ChildList schema without losing its reference pointer metadata.
 *
 * @param options Configuration options including custom description.
 * @returns The configured ChildList schema.
 */
export function childList(options: RefSchemaOptions = {}): typeof ChildListSchema {
  if (options.description === undefined) {
    return ChildListSchema;
  }
  return ChildListSchema.describe(`REF:common_types.json#/$defs/ChildList|\${options.description}`);
}

/**
 * Generic component definition payload schema.
 */
export const AnyComponentSchema = z
  .object({
    'component': z.string().describe('The type name of the component.'),
    'id': z.lazy(() => ComponentIdSchema).optional(),
    'weight': z.number().optional(),
  })
  .passthrough()
  .describe('A generic A2UI component definition.');

/** Generic component definition payload. */
export type AnyComponent = z.infer<typeof AnyComponentSchema>;
