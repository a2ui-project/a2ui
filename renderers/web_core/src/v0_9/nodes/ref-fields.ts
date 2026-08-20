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
 * The `REF:` description pointers from common-types that mark a property as
 * referencing child components. The same convention the capabilities
 * generator resolves into wire `$ref`s, reused here as the machine-readable
 * classification source. Catalogs declare single-child properties with
 * `ComponentIdSchema` (or `componentId`, which keeps the
 * pointer when adding prose).
 */
const COMPONENT_ID_REF = 'REF:common_types.json#/$defs/ComponentId';
const CHILD_LIST_REF = 'REF:common_types.json#/$defs/ChildList';

/** How one property of a component's schema references child components. */
export type RefKind =
  | {
      /** The property holds a single child component id. */
      readonly kind: 'single';
    }
  | {
      /** The property holds a `ChildList` (static id array or template). */
      readonly kind: 'list';
    }
  | {
      /**
       * The property holds an array of plain objects in which `keys` are
       * single child references (e.g. a tab strip's `items[].child`).
       */
      readonly kind: 'nested';
      readonly keys: ReadonlySet<string>;
    };

/** Child-referencing properties of a component schema, keyed by property name. */
export type RefFields = ReadonlyMap<string, RefKind>;

const EMPTY_REF_FIELDS: RefFields = new Map();

const refFieldsCache = new WeakMap<z.ZodTypeAny, RefFields>();

/**
 * Derives the {@link RefFields} of a component schema.
 *
 * Detection is by the `REF:` pointers above, plus the same structural test
 * the binder uses for `ChildList` unions (an option object with both
 * `componentId` and `path`), so catalogs that build their own child-list
 * union need no pointer for list properties. Results are memoized per schema
 * object.
 */
export function extractRefFields(schema: z.ZodTypeAny): RefFields {
  const cached = refFieldsCache.get(schema);
  if (cached) {
    return cached;
  }

  const unwrapped = unwrap(schema);
  if (unwrapped.schema._def.typeName !== 'ZodObject') {
    refFieldsCache.set(schema, EMPTY_REF_FIELDS);
    return EMPTY_REF_FIELDS;
  }

  const fields = new Map<string, RefKind>();

  const shape = (unwrapped.schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
  for (const [key, value] of Object.entries(shape)) {
    const field = unwrap(value);
    if (hasPointer(field.descriptions, CHILD_LIST_REF) || isChildListUnion(field.schema)) {
      fields.set(key, {kind: 'list'});
      continue;
    }
    if (hasPointer(field.descriptions, COMPONENT_ID_REF)) {
      fields.set(key, {kind: 'single'});
      continue;
    }
    if (field.schema._def.typeName === 'ZodArray') {
      const element = unwrap(field.schema._def.type as z.ZodTypeAny);
      if (element.schema._def.typeName === 'ZodObject') {
        const subKeys = new Set<string>();
        const elementShape = (element.schema as z.AnyZodObject).shape as Record<
          string,
          z.ZodTypeAny
        >;
        for (const [subKey, subValue] of Object.entries(elementShape)) {
          if (hasPointer(unwrap(subValue).descriptions, COMPONENT_ID_REF)) {
            subKeys.add(subKey);
          }
        }
        if (subKeys.size > 0) {
          fields.set(key, {kind: 'nested', keys: subKeys});
        }
      }
    }
  }

  const result: RefFields = fields;
  refFieldsCache.set(schema, result);
  return result;
}

/**
 * Unwraps optional/nullable/default/effects wrappers, collecting every
 * description seen along the way (a pointer may sit on the wrapper or on the
 * inner type).
 */
function unwrap(schema: z.ZodTypeAny): {schema: z.ZodTypeAny; descriptions: string[]} {
  const descriptions: string[] = [];
  let current = schema;
  for (;;) {
    if (current.description) {
      descriptions.push(current.description);
    }
    const typeName = current._def.typeName;
    if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
      current = current._def.innerType;
    } else if (typeName === 'ZodEffects') {
      current = current._def.schema;
    } else {
      return {schema: current, descriptions};
    }
  }
}

function hasPointer(descriptions: string[], pointer: string): boolean {
  return descriptions.some(d => d.startsWith(pointer));
}

/** Matches the binder's STRUCTURAL detection for `ChildList`-shaped unions. */
function isChildListUnion(schema: z.ZodTypeAny): boolean {
  if (schema._def.typeName !== 'ZodUnion') {
    return false;
  }
  const options = schema._def.options as z.ZodTypeAny[];
  return options.some(o => {
    if (o._def.typeName !== 'ZodObject') {
      return false;
    }
    const shape = (o as z.AnyZodObject).shape;
    return shape.componentId && shape.path;
  });
}
