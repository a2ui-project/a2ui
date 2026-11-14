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

import {
  arrayItems,
  definitionName,
  objectProperties,
  unwrapField,
  type SchemaDoc,
} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';

/**
 * The validity a v1.0 `ValidationResult` object carries, or `undefined` when
 * `value` is not one: an object whose `valid` member is a boolean.
 */
export function validityOf(value: unknown): boolean | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const valid = (value as {valid?: unknown}).valid;
  return typeof valid === 'boolean' ? valid : undefined;
}

/**
 * Coerces a resolved `DynamicBoolean` value to a boolean.
 *
 * - A boolean is returned unchanged.
 * - A `ValidationResult` object (an object with a boolean `valid` member)
 *   coerces to its `valid` boolean.
 * - A string coerces to `true` only when it equals `"true"`
 *   case-insensitively; `"false"` and all other strings coerce to `false`.
 * - A number coerces to `value !== 0` (`NaN` coerces to `false`).
 * - `null`, `undefined`, any other object, or any array coerces to `false`.
 */
export function coerceDynamicBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const valid = validityOf(value);
  if (valid !== undefined) {
    return valid;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  if (typeof value === 'number') {
    return value !== 0 && !Number.isNaN(value);
  }
  return false;
}

/**
 * Whether a schema is the common `DynamicBoolean` type: a `$ref` to its
 * definition, possibly nullable or through a local alias, or a legacy
 * `REF:` description naming it.
 *
 * @param node The schema.
 * @param doc The document that owns `node`.
 */
export function isDynamicBooleanSchema(node: JsonSchema, doc: SchemaDoc): boolean {
  return definitionName(node, doc) === 'DynamicBoolean';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerces every value in `value` that `node` types as `DynamicBoolean` to a
 * boolean using {@link coerceDynamicBoolean}.
 *
 * Follows the schema through `$ref`s, nullable wrappers, object `properties`
 * (merged across `allOf`) and array `items`. Returns `value` itself when
 * nothing is coerced.
 *
 * @param node The schema of `value`, such as a function's argument schema.
 * @param doc The document that owns `node`.
 * @param value The resolved value to coerce.
 * @returns `value`, with every `DynamicBoolean` position coerced to a boolean.
 */
export function coerceDynamicBooleans(node: JsonSchema, doc: SchemaDoc, value: unknown): unknown {
  if (isDynamicBooleanSchema(node, doc)) {
    return coerceDynamicBoolean(value);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const core = unwrapField(node, doc, true);
  if (Array.isArray(value)) {
    const items = arrayItems(core.node, core.doc);
    if (!items) return value;
    let changed = false;
    const coercedItems = value.map(item => {
      const coerced = coerceDynamicBooleans(items.node, items.doc, item);
      changed ||= coerced !== item;
      return coerced;
    });
    return changed ? coercedItems : value;
  }
  const shape = isPlainObject(value) ? objectProperties(core.node, core.doc) : undefined;
  if (!shape) return value;
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const property = shape.properties[key];
    const coerced = property ? coerceDynamicBooleans(property.node, property.doc, item) : item;
    changed ||= coerced !== item;
    result[key] = coerced;
  }
  return changed ? result : value;
}

/**
 * Coerces every `DynamicBoolean` position in `value` according to `node`.
 *
 * @param node The schema of `value`, such as a function's argument schema.
 * @param doc The document that owns `node`.
 * @param value The resolved value to coerce.
 * @returns `value`, with every `DynamicBoolean` position coerced to a boolean.
 */
export function coerceValidationResults(node: JsonSchema, doc: SchemaDoc, value: unknown): unknown {
  return coerceDynamicBooleans(node, doc, value);
}
