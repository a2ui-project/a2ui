/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {z} from 'zod';
import {ChildListSchema, ComponentIdSchema} from '../schema/common-types.js';

/**
 * Marker strings embedded in a schema's description so the node layer can
 * identify component-reference properties at runtime.
 *
 * A bare `z.string()` component id is indistinguishable from any other string
 * (`scrapeSchemaBehavior` deliberately lets it fall back to STATIC), so single
 * child references are invisible to schema inspection unless the catalog
 * declares them with a distinguishable type. These helpers are that type.
 */
const SINGLE_REF_MARKER = 'A2UI_COMPONENT_REF:single';
const LIST_REF_MARKER = 'A2UI_COMPONENT_REF:list';

/**
 * Declares a property holding the id of a single child component.
 * Use in place of a bare string id so the node layer can resolve the child.
 */
export function componentReference(): z.ZodTypeAny {
  return ComponentIdSchema.describe(`${SINGLE_REF_MARKER}|${ComponentIdSchema.description ?? ''}`);
}

/**
 * Declares a property holding a list of children: either a static array of
 * component ids or a `{componentId, path}` template.
 */
export function componentReferenceList(): z.ZodTypeAny {
  return ChildListSchema.describe(`${LIST_REF_MARKER}|${ChildListSchema.description ?? ''}`);
}

/** Which properties of a component's schema reference child components. */
export interface RefFields {
  /** Properties holding a single child component id. */
  readonly single: ReadonlySet<string>;
  /** Properties holding a `ChildList` (static id array or template). */
  readonly list: ReadonlySet<string>;
  /**
   * Properties holding an array of plain objects in which some keys are
   * single child references (e.g. a tab strip's `items[].child`), mapped to
   * those keys.
   */
  readonly nested: ReadonlyMap<string, ReadonlySet<string>>;
}

const EMPTY_REF_FIELDS: RefFields = {
  single: new Set(),
  list: new Set(),
  nested: new Map(),
};

const refFieldsCache = new WeakMap<z.ZodTypeAny, RefFields>();

/**
 * Derives the {@link RefFields} of a component schema.
 *
 * Detection is by the marker types above, plus the same structural test the
 * binder uses for `ChildList` unions (an option object with both `componentId`
 * and `path`), so catalogs that already use `ChildListSchema` need no marker
 * for list properties. Results are memoized per schema object.
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

  const single = new Set<string>();
  const list = new Set<string>();
  const nested = new Map<string, ReadonlySet<string>>();

  const shape = unwrapped.schema._def.shape() as Record<string, z.ZodTypeAny>;
  for (const [key, value] of Object.entries(shape)) {
    const field = unwrap(value);
    if (hasMarker(field.descriptions, SINGLE_REF_MARKER)) {
      single.add(key);
      continue;
    }
    if (hasMarker(field.descriptions, LIST_REF_MARKER) || isChildListUnion(field.schema)) {
      list.add(key);
      continue;
    }
    if (field.schema._def.typeName === 'ZodArray') {
      const element = unwrap(field.schema._def.type as z.ZodTypeAny);
      if (element.schema._def.typeName === 'ZodObject') {
        const subKeys = new Set<string>();
        const elementShape = element.schema._def.shape() as Record<string, z.ZodTypeAny>;
        for (const [subKey, subValue] of Object.entries(elementShape)) {
          if (hasMarker(unwrap(subValue).descriptions, SINGLE_REF_MARKER)) {
            subKeys.add(subKey);
          }
        }
        if (subKeys.size > 0) {
          nested.set(key, subKeys);
        }
      }
    }
  }

  const result: RefFields = {single, list, nested};
  refFieldsCache.set(schema, result);
  return result;
}

/**
 * Unwraps optional/nullable/default wrappers, collecting every description
 * seen along the way (a marker may sit on the wrapper or on the inner type).
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
    } else {
      return {schema: current, descriptions};
    }
  }
}

function hasMarker(descriptions: string[], marker: string): boolean {
  return descriptions.some(d => d.includes(marker));
}

/** Matches the binder's STRUCTURAL detection for `ChildList`-shaped unions. */
function isChildListUnion(schema: z.ZodTypeAny): boolean {
  if (schema._def.typeName !== 'ZodUnion') {
    return false;
  }
  const options = schema._def.options as z.ZodTypeAny[];
  return options.some(
    o => o._def.typeName === 'ZodObject' && o._def.shape().componentId && o._def.shape().path,
  );
}
