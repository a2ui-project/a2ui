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

import {z} from 'zod';

/**
 * Matches the `REF:` description a `DynamicBoolean` schema carries, whether
 * it was defined in code (`REF:#/$defs/DynamicBoolean|...`) or loaded from a
 * catalog document (`REF:common_types.json#/$defs/DynamicBoolean|...`).
 */
const DYNAMIC_BOOLEAN_REF = /^REF:[^|#]*#\/\$defs\/DynamicBoolean(?:\||$)/;

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

/** The schema inside a wrapper such as `optional()`, or `undefined`. */
function innerSchema(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
  const def = schema._def as {
    typeName?: string;
    innerType?: z.ZodTypeAny;
    schema?: z.ZodTypeAny;
    type?: z.ZodTypeAny;
    getter?: () => z.ZodTypeAny;
  };
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodBranded':
    case 'ZodReadonly':
      return def.innerType;
    case 'ZodEffects':
      return def.schema;
    case 'ZodLazy':
      return def.getter?.();
    default:
      return undefined;
  }
}

/**
 * Whether `schema` is the common `DynamicBoolean` type, possibly wrapped.
 *
 * The type is recognized by the `REF:` description every copy of it carries,
 * so a schema defined in code and one loaded from a catalog document are
 * treated alike.
 */
export function isDynamicBooleanSchema(schema: z.ZodTypeAny): boolean {
  let current: z.ZodTypeAny | undefined = schema;
  while (current) {
    if (typeof current.description === 'string' && DYNAMIC_BOOLEAN_REF.test(current.description)) {
      return true;
    }
    current = innerSchema(current);
  }
  return false;
}

/** The schema under every wrapper, such as `optional()` or `default()`. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (let inner = innerSchema(current); inner; inner = innerSchema(current)) {
    current = inner;
  }
  return current;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerces the `ValidationResult` objects in `value` that `schema` types as
 * `DynamicBoolean` to their `valid` boolean.
 *
 * From v1.0 the validation functions return a `ValidationResult` rather than
 * a boolean, and the specification defines `DynamicBoolean` as a boolean, a
 * binding, or a call returning a boolean or a validation result object,
 * coerced to its `valid` boolean. A resolved argument that is such an object
 * is therefore read by its validity wherever the schema asks for a
 * `DynamicBoolean`, and left alone everywhere else: an object is always
 * truthy in JavaScript, so an uncoerced `{valid: false}` would read as true.
 *
 * Follows the schema through object properties, array items and wrappers
 * such as `optional()`. Returns `value` itself when nothing is coerced.
 *
 * @param schema The schema of `value`, such as a function's argument schema.
 * @param value The resolved value to coerce.
 * @returns `value`, with every `ValidationResult` in a `DynamicBoolean`
 *   position replaced by its validity.
 */
export function coerceValidationResults(schema: z.ZodTypeAny, value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (isDynamicBooleanSchema(schema)) {
    return validityOf(value) ?? value;
  }
  const core = unwrap(schema);
  const def = core._def as {typeName?: string; type?: z.ZodTypeAny};
  if (def.typeName === 'ZodArray' && Array.isArray(value) && def.type) {
    const itemSchema = def.type;
    let changed = false;
    const items = value.map(item => {
      const coerced = coerceValidationResults(itemSchema, item);
      changed ||= coerced !== item;
      return coerced;
    });
    return changed ? items : value;
  }
  if (def.typeName === 'ZodObject' && isPlainObject(value)) {
    const shape = (core as z.ZodObject<z.ZodRawShape>).shape;
    let changed = false;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const propertySchema = shape[key];
      const coerced = propertySchema ? coerceValidationResults(propertySchema, item) : item;
      changed ||= coerced !== item;
      result[key] = coerced;
    }
    return changed ? result : value;
  }
  return value;
}
