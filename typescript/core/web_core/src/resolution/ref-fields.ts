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

import {type ChildRefKind, childRefKindOf} from '../types/child-ref-helpers.js';

/**
 * Options for configuring child reference analysis.
 */
export interface ChildRefAnalysisOptions {
  /** Set of definition names recognized as single child references. */
  childRefNames: ReadonlySet<string>;
  /** Set of definition names recognized as child list references. */
  childListRefNames: ReadonlySet<string>;
  /** Optional set of string property names recognized as single child references (e.g. in v0.8 schemas without $ref). */
  childPropertyNames?: ReadonlySet<string>;
}

/**
 * Extracts the target definition name from a JSON Schema `$ref` pointer or URI.
 *
 * @param ref The JSON Schema reference string or URI.
 * @returns Target definition name.
 */
export function extractRefDefName(ref: string): string {
  if (!ref) return '';
  const hashIdx = ref.lastIndexOf('#');
  const target = hashIdx !== -1 ? ref.slice(hashIdx + 1) : ref;
  const segments = target.split('/').filter(Boolean);
  return segments.pop() ?? '';
}

/**
 * Default definition names in `REF:` schema descriptions that denote single-child
 * component IDs or child lists.
 */
const DEFAULT_SINGLE_CHILD_DEF_NAMES: ReadonlySet<string> = new Set([
  'ComponentId',
  'Child',
  'ChildComponentId',
]);
const DEFAULT_CHILD_LIST_DEF_NAMES: ReadonlySet<string> = new Set([
  'ChildList',
  'TemplateChildList',
  'ChildrenItem',
  'TemplateItem',
]);

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
 * @param options Optional custom child reference analysis options.
 * @returns Map of child-referencing property names to their reference kinds.
 */
export function extractRefFields(
  schema: z.ZodTypeAny,
  options?: ChildRefAnalysisOptions,
): RefFields {
  if (!options) {
    const cached = refFieldsCache.get(schema);
    if (cached) {
      return cached;
    }
  }

  const analysis = analyzeSchema(schema, new Set(), options);
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
  if (!options) {
    refFieldsCache.set(schema, result);
  }
  return result;
}

interface SchemaRefAnalysis {
  fields: Map<string, RefKind>;
  declaredKeys: Set<string>;
  compatibleSingleKeys: Set<string>;
  compatibleListKeys: Set<string>;
  compatibleNestedKeys: Set<string>;
  constrainsUnknownKeys: boolean;
  isEmptyObject: boolean;
  openSingle: boolean;
  openList: boolean;
}

function emptyAnalysis(): SchemaRefAnalysis {
  return {
    fields: new Map(),
    declaredKeys: new Set(),
    compatibleSingleKeys: new Set(),
    compatibleListKeys: new Set(),
    compatibleNestedKeys: new Set(),
    constrainsUnknownKeys: false,
    isEmptyObject: false,
    openSingle: false,
    openList: false,
  };
}

function analyzeSchema(
  schema: z.ZodTypeAny,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): SchemaRefAnalysis {
  const unwrapped = unwrap(schema);
  for (const s of unwrapped.traversed) {
    if (visited.has(s)) {
      return emptyAnalysis();
    }
  }
  for (const s of unwrapped.traversed) {
    visited.add(s);
  }

  const typeName = unwrapped.schema._def.typeName as string;
  switch (typeName) {
    case 'ZodObject': {
      const objSchema = unwrapped.schema as z.AnyZodObject;
      const shape = objSchema.shape as Record<string, z.ZodTypeAny>;
      const fields = new Map<string, RefKind>();
      const declaredKeys = new Set<string>(Object.keys(shape));
      const compatibleSingleKeys = new Set<string>();
      const compatibleListKeys = new Set<string>();
      const compatibleNestedKeys = new Set<string>();

      for (const [key, value] of Object.entries(shape)) {
        const kind = classifyProperty(key, value, visited, options);
        if (kind) {
          fields.set(key, kind);
        }
        const propField = unwrap(value);
        if (canHoldSingleRef(propField, new Set(visited), options)) {
          compatibleSingleKeys.add(key);
        }
        if (canHoldListRef(propField, new Set(visited), options)) {
          compatibleListKeys.add(key);
        }
        if (canHoldNestedRef(propField, new Set(visited))) {
          compatibleNestedKeys.add(key);
        }
      }

      const def = objSchema._def as {
        unknownKeys?: string;
        catchall?: z.ZodTypeAny;
      };
      const unknownKeys = def['unknownKeys'];
      const catchall = def['catchall'];
      let openSingle = false;
      let openList = false;
      let constrainsUnknownKeys = false;
      if (unknownKeys === 'passthrough') {
        openSingle = true;
        openList = true;
      } else if (catchall && catchall._def.typeName !== 'ZodNever') {
        const catchallField = unwrap(catchall);
        openSingle = canHoldSingleRef(catchallField, new Set(visited), options);
        openList = canHoldListRef(catchallField, new Set(visited), options);
        constrainsUnknownKeys = true;
      } else if (unknownKeys === 'strict') {
        constrainsUnknownKeys = true;
      }

      return {
        fields,
        declaredKeys,
        compatibleSingleKeys,
        compatibleListKeys,
        compatibleNestedKeys,
        constrainsUnknownKeys,
        isEmptyObject: declaredKeys.size === 0 && !openSingle && !openList,
        openSingle,
        openList,
      };
    }

    case 'ZodRecord': {
      const valueType = (unwrapped.schema._def as {valueType?: z.ZodTypeAny})['valueType'];
      let openSingle = true;
      let openList = true;
      if (valueType) {
        const valueField = unwrap(valueType);
        openSingle = canHoldSingleRef(valueField, new Set(visited), options);
        openList = canHoldListRef(valueField, new Set(visited), options);
      }
      return {
        fields: new Map(),
        declaredKeys: new Set(),
        compatibleSingleKeys: new Set(),
        compatibleListKeys: new Set(),
        compatibleNestedKeys: new Set(),
        constrainsUnknownKeys: true,
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
        compatibleSingleKeys: new Set(),
        compatibleListKeys: new Set(),
        compatibleNestedKeys: new Set(),
        constrainsUnknownKeys: false,
        isEmptyObject: false,
        openSingle: true,
        openList: true,
      };

    case 'ZodIntersection': {
      const def = unwrapped.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      const left = analyzeSchema(def.left, new Set(visited), options);
      const right = analyzeSchema(def.right, new Set(visited), options);
      const fields = new Map<string, RefKind>();
      for (const [key, kind] of left.fields) {
        if (isRefCompatibleWithSide(key, kind, right)) {
          mergeRefKind(fields, key, kind);
        }
      }
      for (const [key, kind] of right.fields) {
        if (isRefCompatibleWithSide(key, kind, left)) {
          mergeRefKind(fields, key, kind);
        }
      }

      const declaredKeys = new Set([...left.declaredKeys, ...right.declaredKeys]);
      const compatibleSingleKeys = new Set<string>();
      const compatibleListKeys = new Set<string>();
      const compatibleNestedKeys = new Set<string>();
      for (const key of declaredKeys) {
        if (
          isRefCompatibleWithSide(key, {kind: 'single'}, left) &&
          isRefCompatibleWithSide(key, {kind: 'single'}, right)
        ) {
          compatibleSingleKeys.add(key);
        }
        if (
          isRefCompatibleWithSide(key, {kind: 'list'}, left) &&
          isRefCompatibleWithSide(key, {kind: 'list'}, right)
        ) {
          compatibleListKeys.add(key);
        }
        if (
          isRefCompatibleWithSide(key, {kind: 'nested', keys: new Set()}, left) &&
          isRefCompatibleWithSide(key, {kind: 'nested', keys: new Set()}, right)
        ) {
          compatibleNestedKeys.add(key);
        }
      }

      const isEmptyObject = left.isEmptyObject && right.isEmptyObject;
      const openSingle =
        !isEmptyObject &&
        (left.openSingle || left.isEmptyObject) &&
        (right.openSingle || right.isEmptyObject);
      const openList =
        !isEmptyObject &&
        (left.openList || left.isEmptyObject) &&
        (right.openList || right.isEmptyObject);

      return {
        fields,
        declaredKeys,
        compatibleSingleKeys,
        compatibleListKeys,
        compatibleNestedKeys,
        constrainsUnknownKeys: left.constrainsUnknownKeys || right.constrainsUnknownKeys,
        isEmptyObject,
        openSingle,
        openList,
      };
    }

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const rawOptions = (
        unwrapped.schema._def as {options: z.ZodTypeAny[] | Map<unknown, z.ZodTypeAny>}
      ).options;
      const unionOptions = Array.isArray(rawOptions) ? rawOptions : Array.from(rawOptions.values());
      const fields = new Map<string, RefKind>();
      const declaredKeys = new Set<string>();
      const compatibleSingleKeys = new Set<string>();
      const compatibleListKeys = new Set<string>();
      const compatibleNestedKeys = new Set<string>();
      let allEmpty = unionOptions.length > 0;
      let allConstrainUnknown = unionOptions.length > 0;
      let openSingle = false;
      let openList = false;

      for (const option of unionOptions) {
        const sub = analyzeSchema(option, new Set(visited), options);
        for (const [key, kind] of sub.fields) {
          mergeRefKind(fields, key, kind);
        }
        for (const key of sub.declaredKeys) {
          declaredKeys.add(key);
        }
        for (const key of sub.compatibleSingleKeys) {
          compatibleSingleKeys.add(key);
        }
        for (const key of sub.compatibleListKeys) {
          compatibleListKeys.add(key);
        }
        for (const key of sub.compatibleNestedKeys) {
          compatibleNestedKeys.add(key);
        }
        allEmpty = allEmpty && sub.isEmptyObject;
        allConstrainUnknown = allConstrainUnknown && sub.constrainsUnknownKeys;
        openSingle = openSingle || sub.openSingle;
        openList = openList || sub.openList;
      }

      return {
        fields,
        declaredKeys,
        compatibleSingleKeys,
        compatibleListKeys,
        compatibleNestedKeys,
        constrainsUnknownKeys: allConstrainUnknown,
        isEmptyObject: allEmpty,
        openSingle,
        openList,
      };
    }

    default:
      return emptyAnalysis();
  }
}

function isRefCompatibleWithSide(key: string, kind: RefKind, other: SchemaRefAnalysis): boolean {
  if (other.fields.has(key)) {
    return true;
  }
  if (other.declaredKeys.has(key)) {
    if (kind.kind === 'single') {
      return other.compatibleSingleKeys.has(key);
    }
    if (kind.kind === 'list') {
      return other.compatibleListKeys.has(key);
    }
    return other.compatibleNestedKeys.has(key);
  }
  if (other.constrainsUnknownKeys) {
    if (kind.kind === 'single') {
      return other.openSingle;
    }
    if (kind.kind === 'list') {
      return other.openList;
    }
    return other.openList;
  }
  return true;
}

function mergeRefKind(target: Map<string, RefKind>, key: string, incoming: RefKind): void {
  const existing = target.get(key);
  if (!existing) {
    target.set(key, incoming);
    return;
  }
  if (existing.kind === 'single' && incoming.kind === 'list') {
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

function classifyProperty(
  key: string,
  value: z.ZodTypeAny,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): RefKind | undefined {
  const field = unwrap(value);
  if (marksChildList(field, options) || isChildListUnion(field.schema)) {
    return {kind: 'list'};
  }
  if (marksComponentId(field, options)) {
    return {kind: 'single'};
  }
  if (field.schema._def.typeName === 'ZodArray') {
    const rawElement = field.schema._def.type as z.ZodTypeAny;
    const element = unwrap(rawElement);
    // A plain array of component ids: the marker sits on the element
    // rather than the property (z.array(ComponentIdSchema)).
    if (marksComponentId(element, options) || marksChildList(element, options)) {
      return {kind: 'list'};
    }
    const arrayVisited = new Set(visited);
    for (const s of field.traversed) {
      arrayVisited.add(s);
    }
    const elementAnalysis = analyzeSchema(rawElement, arrayVisited, options);
    const subKeys = new Set<string>();
    for (const [subKey, subKind] of elementAnalysis.fields) {
      if (subKind.kind === 'single' || subKind.kind === 'list') {
        subKeys.add(subKey);
      }
    }
    if (subKeys.size > 0) {
      return {kind: 'nested', keys: subKeys};
    }
  }
  if (field.schema._def.typeName === 'ZodUnion') {
    const explicitUnionKind = classifyExplicitUnionOptions(
      field.schema._def.options as z.ZodTypeAny[],
      options,
    );
    if (explicitUnionKind) {
      return explicitUnionKind;
    }
  }

  // Fallback for unannotated `child` / `children` (and version-specific child property names)
  // whose types can hold component references.
  const isSingleChildKey = key === 'child' || Boolean(options?.childPropertyNames?.has(key));
  if (isSingleChildKey && canHoldSingleRef(field, new Set(visited), options)) {
    return {kind: 'single'};
  }
  if (key === 'children' && canHoldListRef(field, new Set(visited), options)) {
    return {kind: 'list'};
  }
  return undefined;
}

function classifyExplicitUnionOptions(
  unionOptions: readonly z.ZodTypeAny[],
  options?: ChildRefAnalysisOptions,
): RefKind | undefined {
  let hasSingle = false;
  for (const option of unionOptions) {
    const unwrappedOption = unwrap(option);
    if (marksChildList(unwrappedOption, options) || isChildListUnion(unwrappedOption.schema)) {
      return {kind: 'list'};
    }
    if (
      unwrappedOption.schema._def.typeName === 'ZodArray' &&
      marksComponentId(unwrap(unwrappedOption.schema._def.type as z.ZodTypeAny), options)
    ) {
      return {kind: 'list'};
    }
    if (marksComponentId(unwrappedOption, options)) {
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
  bareDefNames: Set<string>;
  refs: Set<ChildRefKind>;
  traversed: Set<z.ZodTypeAny>;
}

function unwrap(schema: z.ZodTypeAny): UnwrappedField {
  const refDefNames = new Set<string>();
  const bareDefNames = new Set<string>();
  const refs = new Set<ChildRefKind>();
  const traversed = new Set<z.ZodTypeAny>();
  let current = schema;

  for (;;) {
    if (traversed.has(current)) {
      return {schema: current, refDefNames, bareDefNames, refs, traversed};
    }
    traversed.add(current);

    collectRefDefName(current.description, refDefNames, bareDefNames);
    const defDescription = (current._def as {description?: string}).description;
    if (defDescription !== current.description) {
      collectRefDefName(defDescription, refDefNames, bareDefNames);
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
      current = (current._def as {out: z.ZodTypeAny})['out'];
    } else if (typeName === 'ZodLazy') {
      current = (current._def.getter as () => z.ZodTypeAny)();
    } else {
      return {schema: current, refDefNames, bareDefNames, refs, traversed};
    }
  }
}

function collectRefDefName(
  description: string | undefined,
  refDefNames: Set<string>,
  bareDefNames: Set<string>,
): void {
  if (!description) {
    return;
  }
  if (description.startsWith('REF:')) {
    const defName = extractRefDefName(description.slice(4).split('|')[0]);
    if (defName) {
      refDefNames.add(defName);
    }
    return;
  }
  const refTarget = extractRefDefName(description.split('|')[0]);
  if (refTarget) {
    bareDefNames.add(refTarget);
  }
  const trimmed = description.trim();
  if (trimmed) {
    bareDefNames.add(trimmed);
  }
}

function marksComponentId(field: UnwrappedField, options?: ChildRefAnalysisOptions): boolean {
  if (field.refs.has('component-id')) {
    return true;
  }
  const singleNames = options?.childRefNames ?? DEFAULT_SINGLE_CHILD_DEF_NAMES;
  for (const name of singleNames) {
    if (field.refDefNames.has(name) || field.bareDefNames.has(name)) {
      return true;
    }
  }
  return false;
}

function marksChildList(field: UnwrappedField, options?: ChildRefAnalysisOptions): boolean {
  if (field.refs.has('child-list')) {
    return true;
  }
  const listNames = options?.childListRefNames ?? DEFAULT_CHILD_LIST_DEF_NAMES;
  for (const name of listNames) {
    if (field.refDefNames.has(name) || field.bareDefNames.has(name)) {
      return true;
    }
  }
  return false;
}

function hasNonChildRefMarker(field: UnwrappedField, options?: ChildRefAnalysisOptions): boolean {
  if (field.refDefNames.size === 0) {
    return false;
  }
  return !marksComponentId(field, options) && !marksChildList(field, options);
}

function canHoldSingleRef(
  field: UnwrappedField,
  visited = new Set<z.ZodTypeAny>(),
  options?: ChildRefAnalysisOptions,
): boolean {
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return false;
    }
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  if (marksComponentId(field, options)) {
    return true;
  }
  if (marksChildList(field, options) || hasNonChildRefMarker(field, options)) {
    return false;
  }

  const typeName = field.schema._def.typeName as string;
  switch (typeName) {
    case 'ZodString':
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    case 'ZodUnion': {
      const unionOptions = field.schema._def.options as z.ZodTypeAny[];
      return unionOptions.some(option =>
        canHoldSingleRef(unwrap(option), new Set(visited), options),
      );
    }
    case 'ZodIntersection': {
      const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      return (
        canHoldSingleRef(unwrap(def.left), new Set(visited), options) &&
        canHoldSingleRef(unwrap(def.right), new Set(visited), options)
      );
    }
    default:
      return false;
  }
}

function canHoldListRef(
  field: UnwrappedField,
  visited = new Set<z.ZodTypeAny>(),
  options?: ChildRefAnalysisOptions,
): boolean {
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return false;
    }
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  if (marksChildList(field, options) || isChildListUnion(field.schema)) {
    return true;
  }
  if (marksComponentId(field, options) || hasNonChildRefMarker(field, options)) {
    return false;
  }

  const typeName = field.schema._def.typeName as string;
  switch (typeName) {
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    case 'ZodArray': {
      const element = unwrap(field.schema._def.type as z.ZodTypeAny);
      return (
        canHoldSingleRef(element, new Set(visited), options) || isTemplateRefObject(element.schema)
      );
    }
    case 'ZodObject':
      return isTemplateRefObject(field.schema);
    case 'ZodUnion': {
      const unionOptions = field.schema._def.options as z.ZodTypeAny[];
      return unionOptions.some(option => canHoldListRef(unwrap(option), new Set(visited), options));
    }
    case 'ZodIntersection': {
      const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      return (
        canHoldListRef(unwrap(def.left), new Set(visited), options) &&
        canHoldListRef(unwrap(def.right), new Set(visited), options)
      );
    }
    default:
      return false;
  }
}

function canHoldNestedRef(field: UnwrappedField, visited = new Set<z.ZodTypeAny>()): boolean {
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return false;
    }
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  const typeName = field.schema._def.typeName as string;
  switch (typeName) {
    case 'ZodAny':
    case 'ZodUnknown':
    case 'ZodArray':
      return true;
    case 'ZodUnion': {
      const unionOptions = field.schema._def.options as z.ZodTypeAny[];
      return unionOptions.some(option => canHoldNestedRef(unwrap(option), new Set(visited)));
    }
    case 'ZodIntersection': {
      const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      return (
        canHoldNestedRef(unwrap(def.left), new Set(visited)) &&
        canHoldNestedRef(unwrap(def.right), new Set(visited))
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
  return Boolean(
    (Object.hasOwn(shape, 'componentId') &&
      (Object.hasOwn(shape, 'path') ||
        Object.hasOwn(shape, '@path') ||
        Object.hasOwn(shape, 'dataBinding'))) ||
    Object.hasOwn(shape, 'explicitList') ||
    Object.hasOwn(shape, 'template'),
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
