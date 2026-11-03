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

import {extractRefDefName} from '../catalog/reference-map.js';
import {type ChildRefKind, childRefKindOf} from '../types/child-ref-helpers.js';

/**
 * Definition names in `REF:` schema descriptions that denote single-child
 * component IDs or child lists.
 */
const SINGLE_CHILD_DEF_NAMES = new Set(['ComponentId', 'Child']);
const CHILD_LIST_DEF_NAMES = new Set(['ChildList']);

/**
 * Describes how a component schema property references child components.
 */
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
 * Extracts the child-referencing properties and their kinds from a component Zod schema.
 *
 * Recognizes explicit child-reference metadata (`ComponentIdSchema`, `ChildSchema`,
 * `ChildListSchema`, and `REF:` description pointers), unannotated `child` and
 * `children` properties whose types can hold component references, and open or
 * empty-shape schemas (`z.object({})`, `.passthrough()`, `.catchall(...)`,
 * `z.record(...)`, `z.any()`, `z.unknown()`).
 *
 * @param schema Component Zod schema to inspect.
 * @returns Map of child-referencing property names to their reference kinds.
 */
export function extractRefFields(schema: z.ZodTypeAny): RefFields {
  const cached = refFieldsCache.get(schema);
  if (cached) {
    return cached;
  }

  const analysis = analyzeSchema(schema, new Set());
  const fields = analysis.fields;

  if (analysis.isEmptyObject || analysis.openSingle) {
    if (!analysis.declaredKeys.has('child') && !fields.has('child')) {
      fields.set('child', {kind: 'single'});
    }
  }
  if (analysis.isEmptyObject || analysis.openList) {
    if (!analysis.declaredKeys.has('children') && !fields.has('children')) {
      fields.set('children', {kind: 'list'});
    }
  }

  const result: RefFields = fields.size === 0 ? EMPTY_REF_FIELDS : fields;
  refFieldsCache.set(schema, result);
  return result;
}

interface SchemaRefAnalysis {
  fields: Map<string, RefKind>;
  declaredKeys: Set<string>;
  isEmptyObject: boolean;
  openSingle: boolean;
  openList: boolean;
}

function analyzeSchema(schema: z.ZodTypeAny, visited: Set<z.ZodTypeAny>): SchemaRefAnalysis {
  const unwrapped = unwrap(schema);
  if (visited.has(unwrapped.schema)) {
    return {
      fields: new Map(),
      declaredKeys: new Set(),
      isEmptyObject: false,
      openSingle: false,
      openList: false,
    };
  }
  visited.add(unwrapped.schema);

  const typeName = unwrapped.schema._def.typeName as string;
  switch (typeName) {
    case 'ZodObject': {
      const objSchema = unwrapped.schema as z.AnyZodObject;
      const shape = objSchema.shape as Record<string, z.ZodTypeAny>;
      const fields = new Map<string, RefKind>();
      const declaredKeys = new Set<string>(Object.keys(shape));

      for (const [key, value] of Object.entries(shape)) {
        const kind = classifyProperty(key, value);
        if (kind) {
          fields.set(key, kind);
        }
      }

      const def = objSchema._def as {
        unknownKeys?: string;
        catchall?: z.ZodTypeAny;
      };
      let openSingle = false;
      let openList = false;
      if (def.unknownKeys === 'passthrough') {
        openSingle = true;
        openList = true;
      } else if (def.catchall && def.catchall._def.typeName !== 'ZodNever') {
        const catchallField = unwrap(def.catchall);
        openSingle = canHoldSingleRef(catchallField);
        openList = canHoldListRef(catchallField);
      }

      return {
        fields,
        declaredKeys,
        isEmptyObject: declaredKeys.size === 0 && !openSingle && !openList,
        openSingle,
        openList,
      };
    }

    case 'ZodRecord': {
      const valueType = (unwrapped.schema._def as {valueType?: z.ZodTypeAny}).valueType;
      let openSingle = true;
      let openList = true;
      if (valueType) {
        const valueField = unwrap(valueType);
        openSingle = canHoldSingleRef(valueField);
        openList = canHoldListRef(valueField);
      }
      return {
        fields: new Map(),
        declaredKeys: new Set(),
        isEmptyObject: false,
        openSingle,
        openList,
      };
    }

    case 'ZodAny':
    case 'ZodUnknown':
      return {
        fields: new Map(),
        declaredKeys: new Set(),
        isEmptyObject: false,
        openSingle: true,
        openList: true,
      };

    case 'ZodIntersection': {
      const def = unwrapped.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      const left = analyzeSchema(def.left, new Set(visited));
      const right = analyzeSchema(def.right, new Set(visited));
      const fields = new Map<string, RefKind>();
      for (const [key, kind] of left.fields) {
        if (!right.declaredKeys.has(key) || right.fields.has(key)) {
          mergeRefKind(fields, key, kind);
        }
      }
      for (const [key, kind] of right.fields) {
        if (!left.declaredKeys.has(key) || left.fields.has(key)) {
          mergeRefKind(fields, key, kind);
        }
      }
      return {
        fields,
        declaredKeys: new Set([...left.declaredKeys, ...right.declaredKeys]),
        isEmptyObject: left.isEmptyObject && right.isEmptyObject,
        openSingle: left.openSingle && right.openSingle,
        openList: left.openList && right.openList,
      };
    }

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const rawOptions = (
        unwrapped.schema._def as {options: z.ZodTypeAny[] | Map<unknown, z.ZodTypeAny>}
      ).options;
      const options = Array.isArray(rawOptions) ? rawOptions : Array.from(rawOptions.values());
      const fields = new Map<string, RefKind>();
      const declaredKeys = new Set<string>();
      let allEmpty = options.length > 0;
      let openSingle = false;
      let openList = false;

      for (const option of options) {
        const sub = analyzeSchema(option, new Set(visited));
        for (const [key, kind] of sub.fields) {
          mergeRefKind(fields, key, kind);
        }
        for (const key of sub.declaredKeys) {
          declaredKeys.add(key);
        }
        allEmpty = allEmpty && sub.isEmptyObject;
        openSingle = openSingle || sub.openSingle;
        openList = openList || sub.openList;
      }

      return {
        fields,
        declaredKeys,
        isEmptyObject: allEmpty,
        openSingle,
        openList,
      };
    }

    default:
      return {
        fields: new Map(),
        declaredKeys: new Set(),
        isEmptyObject: false,
        openSingle: false,
        openList: false,
      };
  }
}

function mergeRefKind(target: Map<string, RefKind>, key: string, incoming: RefKind): void {
  const existing = target.get(key);
  if (!existing) {
    target.set(key, incoming);
    return;
  }
  if (existing.kind === 'nested' && incoming.kind === 'nested') {
    target.set(key, {
      kind: 'nested',
      keys: new Set([...existing.keys, ...incoming.keys]),
    });
  }
}

function classifyProperty(key: string, value: z.ZodTypeAny): RefKind | undefined {
  const field = unwrap(value);
  if (marksChildList(field) || isChildListUnion(field.schema)) {
    return {kind: 'list'};
  }
  if (marksComponentId(field)) {
    return {kind: 'single'};
  }
  if (field.schema._def.typeName === 'ZodArray') {
    const element = unwrap(field.schema._def.type as z.ZodTypeAny);
    // A plain array of component ids: the marker sits on the element
    // rather than the property (z.array(ComponentIdSchema)).
    if (marksComponentId(element)) {
      return {kind: 'list'};
    }
    if (element.schema._def.typeName === 'ZodObject') {
      const subKeys = new Set<string>();
      const elementShape = (element.schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
      for (const [subKey, subValue] of Object.entries(elementShape)) {
        const unwrappedSub = unwrap(subValue);
        if (
          marksComponentId(unwrappedSub) ||
          (subKey === 'child' && canHoldSingleRef(unwrappedSub))
        ) {
          subKeys.add(subKey);
        }
      }
      if (subKeys.size > 0) {
        return {kind: 'nested', keys: subKeys};
      }
    }
  }
  if (field.schema._def.typeName === 'ZodUnion') {
    const explicitUnionKind = classifyExplicitUnionOptions(
      field.schema._def.options as z.ZodTypeAny[],
    );
    if (explicitUnionKind) {
      return explicitUnionKind;
    }
  }

  // Fallback for unannotated `child` / `children` properties whose types can
  // hold component references.
  if (key === 'child' && canHoldSingleRef(field)) {
    return {kind: 'single'};
  }
  if (key === 'children' && canHoldListRef(field)) {
    return {kind: 'list'};
  }
  return undefined;
}

function classifyExplicitUnionOptions(options: readonly z.ZodTypeAny[]): RefKind | undefined {
  let hasSingle = false;
  for (const option of options) {
    const unwrappedOption = unwrap(option);
    if (marksChildList(unwrappedOption) || isChildListUnion(unwrappedOption.schema)) {
      return {kind: 'list'};
    }
    if (
      unwrappedOption.schema._def.typeName === 'ZodArray' &&
      marksComponentId(unwrap(unwrappedOption.schema._def.type as z.ZodTypeAny))
    ) {
      return {kind: 'list'};
    }
    if (marksComponentId(unwrappedOption)) {
      hasSingle = true;
    }
  }
  return hasSingle ? {kind: 'single'} : undefined;
}

/**
 * Unwraps optional/nullable/default/readonly/branded/effects/lazy wrappers,
 * collecting every `REF:` definition name and child-ref marker along the way.
 */
interface UnwrappedField {
  schema: z.ZodTypeAny;
  refDefNames: Set<string>;
  refs: Set<ChildRefKind>;
}

function unwrap(schema: z.ZodTypeAny): UnwrappedField {
  const refDefNames = new Set<string>();
  const refs = new Set<ChildRefKind>();
  const visited = new Set<z.ZodTypeAny>();
  let current = schema;

  for (;;) {
    if (visited.has(current)) {
      return {schema: current, refDefNames, refs};
    }
    visited.add(current);

    collectRefDefName(current.description, refDefNames);
    const defDescription = (current._def as {description?: string}).description;
    if (defDescription !== current.description) {
      collectRefDefName(defDescription, refDefNames);
    }

    const ref = childRefKindOf(current);
    if (ref) {
      refs.add(ref);
    }

    const typeName = current._def.typeName as string;
    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault' ||
      typeName === 'ZodReadonly' ||
      typeName === 'ZodCatch'
    ) {
      current = current._def.innerType as z.ZodTypeAny;
    } else if (typeName === 'ZodEffects') {
      current = current._def.schema as z.ZodTypeAny;
    } else if (typeName === 'ZodBranded') {
      current = current._def.type as z.ZodTypeAny;
    } else if (typeName === 'ZodPipeline') {
      current = current._def.out as z.ZodTypeAny;
    } else if (typeName === 'ZodLazy') {
      current = (current._def.getter as () => z.ZodTypeAny)();
    } else {
      return {schema: current, refDefNames, refs};
    }
  }
}

function collectRefDefName(description: string | undefined, refDefNames: Set<string>): void {
  if (!description?.startsWith('REF:')) {
    return;
  }
  const defName = extractRefDefName(description.slice(4).split('|')[0]);
  if (defName) {
    refDefNames.add(defName);
  }
}

function marksComponentId(field: UnwrappedField): boolean {
  if (field.refs.has('component-id')) {
    return true;
  }
  for (const name of SINGLE_CHILD_DEF_NAMES) {
    if (field.refDefNames.has(name)) {
      return true;
    }
  }
  return false;
}

function marksChildList(field: UnwrappedField): boolean {
  if (field.refs.has('child-list')) {
    return true;
  }
  for (const name of CHILD_LIST_DEF_NAMES) {
    if (field.refDefNames.has(name)) {
      return true;
    }
  }
  return false;
}

function hasNonChildRefMarker(field: UnwrappedField): boolean {
  if (field.refDefNames.size === 0) {
    return false;
  }
  return !marksComponentId(field) && !marksChildList(field);
}

function canHoldSingleRef(field: UnwrappedField, visited = new Set<z.ZodTypeAny>()): boolean {
  if (visited.has(field.schema)) {
    return false;
  }
  visited.add(field.schema);

  if (marksComponentId(field)) {
    return true;
  }
  if (marksChildList(field) || hasNonChildRefMarker(field)) {
    return false;
  }

  const typeName = field.schema._def.typeName as string;
  switch (typeName) {
    case 'ZodString':
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    case 'ZodUnion': {
      const options = field.schema._def.options as z.ZodTypeAny[];
      return options.some(option => canHoldSingleRef(unwrap(option), new Set(visited)));
    }
    case 'ZodIntersection': {
      const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      return (
        canHoldSingleRef(unwrap(def.left), new Set(visited)) &&
        canHoldSingleRef(unwrap(def.right), new Set(visited))
      );
    }
    default:
      return false;
  }
}

function canHoldListRef(field: UnwrappedField, visited = new Set<z.ZodTypeAny>()): boolean {
  if (visited.has(field.schema)) {
    return false;
  }
  visited.add(field.schema);

  if (marksChildList(field) || isChildListUnion(field.schema)) {
    return true;
  }
  if (marksComponentId(field) || hasNonChildRefMarker(field)) {
    return false;
  }

  const typeName = field.schema._def.typeName as string;
  switch (typeName) {
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    case 'ZodArray': {
      const element = unwrap(field.schema._def.type as z.ZodTypeAny);
      return canHoldSingleRef(element, new Set(visited)) || isTemplateRefObject(element.schema);
    }
    case 'ZodObject':
      return isTemplateRefObject(field.schema);
    case 'ZodUnion': {
      const options = field.schema._def.options as z.ZodTypeAny[];
      return options.some(option => canHoldListRef(unwrap(option), new Set(visited)));
    }
    case 'ZodIntersection': {
      const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      return (
        canHoldListRef(unwrap(def.left), new Set(visited)) &&
        canHoldListRef(unwrap(def.right), new Set(visited))
      );
    }
    default:
      return false;
  }
}

function isTemplateRefObject(schema: z.ZodTypeAny): boolean {
  if (schema._def.typeName !== 'ZodObject') {
    return false;
  }
  const shape = (schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
  return (
    Object.hasOwn(shape, 'componentId') &&
    (Object.hasOwn(shape, 'path') || Object.hasOwn(shape, '@path'))
  );
}

/** Matches the binder's STRUCTURAL detection for `ChildList`-shaped unions. */
function isChildListUnion(schema: z.ZodTypeAny): boolean {
  if (schema._def.typeName !== 'ZodUnion') {
    return false;
  }
  const options = schema._def.options as z.ZodTypeAny[];
  return options.some(o => isTemplateRefObject(unwrap(o).schema));
}
