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
 * Unwrapped Zod schema and metadata collected across single-inner-type wrappers
 * (`optional`, `nullable`, `default`, `readonly`, `catch`, `effects`, `brand`, `lazy`).
 */
export interface UnwrappedZodField {
  readonly schema: z.ZodTypeAny;
  readonly descriptions: string[];
  readonly firstRefDefName: string;
  readonly refDefNames: Set<string>;
  readonly bareDefNames: Set<string>;
  readonly refs: Set<ChildRefKind>;
  readonly traversed: Set<z.ZodTypeAny>;
  readonly hasTransform: boolean;
}

/**
 * Unwraps optional/nullable/default/readonly/catch/effects/branded/lazy wrappers,
 * collecting descriptions, `REF:` definition names, and child-ref markers along
 * the chain while stopping at combinators (`ZodPipeline`, `ZodIntersection`,
 * `ZodUnion`, `ZodDiscriminatedUnion`) and structural types.
 */
export function unwrapZodField(schema: z.ZodTypeAny): UnwrappedZodField {
  const descriptions: string[] = [];
  const refDefNames = new Set<string>();
  const bareDefNames = new Set<string>();
  const refs = new Set<ChildRefKind>();
  const traversed = new Set<z.ZodTypeAny>();
  const visitedGetters = new Set<() => z.ZodTypeAny>();
  let firstRefDefName = '';
  let hasTransform = false;
  let current = schema;

  while (current && typeof current === 'object' && current._def) {
    if (traversed.has(current)) {
      break;
    }
    traversed.add(current);

    if (current.description) {
      descriptions.push(current.description);
      const parsedRef = collectRefDefName(current.description, refDefNames, bareDefNames);
      if (!firstRefDefName && parsedRef) {
        firstRefDefName = parsedRef;
      }
    }
    const defDescription = (current._def as {description?: string}).description;
    if (defDescription && defDescription !== current.description) {
      descriptions.push(defDescription);
      const parsedRef = collectRefDefName(defDescription, refDefNames, bareDefNames);
      if (!firstRefDefName && parsedRef) {
        firstRefDefName = parsedRef;
      }
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
      const effectDef = (current._def as {effect?: {type?: string}}).effect;
      if (effectDef?.type === 'transform' || effectDef?.type === 'preprocess') {
        hasTransform = true;
      }
      current = current._def.schema as z.ZodTypeAny;
    } else if (typeName === 'ZodBranded') {
      current = current._def.type as z.ZodTypeAny;
    } else if (typeName === 'ZodLazy') {
      const getter = current._def.getter as () => z.ZodTypeAny;
      if (visitedGetters.has(getter)) {
        break;
      }
      visitedGetters.add(getter);
      current = getter();
    } else {
      break;
    }
  }

  return {
    schema: current,
    descriptions,
    firstRefDefName,
    refDefNames,
    bareDefNames,
    refs,
    traversed,
    hasTransform,
  };
}

/**
 * Returns the option schemas of a `ZodUnion` or `ZodDiscriminatedUnion`, or
 * `undefined` if `schema` is neither.
 */
export function getUnionOptions(schema: z.ZodTypeAny): z.ZodTypeAny[] | undefined {
  const typeName = schema?._def?.typeName as string | undefined;
  if (typeName !== 'ZodUnion' && typeName !== 'ZodDiscriminatedUnion') {
    return undefined;
  }
  const rawOptions = (schema._def as {options?: z.ZodTypeAny[] | Map<unknown, z.ZodTypeAny>})
    .options;
  if (!rawOptions) {
    return undefined;
  }
  return Array.isArray(rawOptions) ? rawOptions : Array.from(rawOptions.values());
}

/**
 * Returns whether an unwrapped `ZodObject` matches a dynamic child-list template
 * shape (`{ componentId, path | @path | dataBinding }` or v0.8 `explicitList`/`template`).
 */
export function isTemplateRefObject(schema: z.ZodTypeAny): boolean {
  if (schema?._def?.typeName !== 'ZodObject') {
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

/**
 * Returns whether `schema` can accept a single component ID string on the wire.
 */
export function canSchemaHoldSingleRef(
  schema: z.ZodTypeAny,
  options?: ChildRefAnalysisOptions,
): boolean {
  return canHoldSingleRef(unwrapZodField(schema), new Set(), options);
}

/**
 * Returns whether `schema` can accept a child list or template on the wire.
 */
export function canSchemaHoldListRef(
  schema: z.ZodTypeAny,
  options?: ChildRefAnalysisOptions,
): boolean {
  return canHoldListRef(unwrapZodField(schema), new Set(), options);
}

/**
 * Extracts the child-referencing properties and their kinds from a component Zod schema.
 *
 * Recognizes explicit child-reference metadata (`ComponentIdSchema`, `ChildSchema`,
 * `ChildListSchema`, and `REF:` description pointers), unannotated `child` and
 * `children` properties whose types can hold component references, and open or
 * unannotated empty-shape stub schemas (`z.object({})`, `.passthrough()`,
 * `.catchall(...)`, `z.record(...)`, `z.any()`, `z.unknown()`).
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

  const result = extractRefFieldsInternal(schema, options, true);
  if (!options) {
    refFieldsCache.set(schema, result);
  }
  return result;
}

/**
 * Extracts child-referencing properties for static catalog introspection
 * (`Catalog.componentRefMap` / `buildComponentRefMap`).
 *
 * Unlike runtime {@link extractRefFields}, zero-property leaf schemas (`z.object({})`)
 * do not synthesize implicit `child`/`children` entries unless the schema is
 * explicitly open (`.passthrough()`, compatible `.catchall(...)`, `z.record(...)`,
 * `z.any()`, or `z.unknown()`).
 */
export function extractCatalogRefFields(
  schema: z.ZodTypeAny,
  options?: ChildRefAnalysisOptions,
): RefFields {
  return extractRefFieldsInternal(schema, options, false);
}

function extractRefFieldsInternal(
  schema: z.ZodTypeAny,
  options: ChildRefAnalysisOptions | undefined,
  includeEmptyObjectFallback: boolean,
): RefFields {
  const analysis = analyzeSchema(schema, new Set(), options);
  const fields = analysis.fields;
  const allowEmpty = includeEmptyObjectFallback && analysis.isEmptyObject;

  if (allowEmpty || analysis.openSingle) {
    if (!analysis.declaredKeys.has('child') && !fields.has('child')) {
      fields.set('child', {kind: 'single'});
    }
  }
  if (allowEmpty || analysis.openList) {
    if (!analysis.declaredKeys.has('children') && !fields.has('children')) {
      fields.set('children', {kind: 'list'});
    }
  }

  return fields.size === 0 ? EMPTY_REF_FIELDS : fields;
}

interface SchemaRefAnalysis {
  fields: Map<string, RefKind>;
  declaredKeys: Set<string>;
  compatibleSingleKeys: Set<string>;
  compatibleListKeys: Set<string>;
  compatibleNestedKeys: Set<string>;
  nestedElementAnalyses: Map<string, SchemaRefAnalysis>;
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
    nestedElementAnalyses: new Map(),
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
  const unwrapped = unwrapZodField(schema);
  for (const s of unwrapped.traversed) {
    if (visited.has(s)) {
      return emptyAnalysis();
    }
  }
  for (const s of unwrapped.traversed) {
    visited.add(s);
  }

  const typeName = unwrapped.schema?._def?.typeName as string | undefined;
  switch (typeName) {
    case 'ZodObject': {
      const objSchema = unwrapped.schema as z.AnyZodObject;
      const shape = objSchema.shape as Record<string, z.ZodTypeAny>;
      const fields = new Map<string, RefKind>();
      const declaredKeys = new Set<string>(Object.keys(shape));
      const compatibleSingleKeys = new Set<string>();
      const compatibleListKeys = new Set<string>();
      const compatibleNestedKeys = new Set<string>();
      const nestedElementAnalyses = new Map<string, SchemaRefAnalysis>();

      for (const [key, value] of Object.entries(shape)) {
        const kind = classifyProperty(key, value, visited, options);
        if (kind) {
          fields.set(key, kind);
        }
        const propField = unwrapZodField(value);
        if (canHoldSingleRef(propField, new Set(visited), options)) {
          compatibleSingleKeys.add(key);
        }
        if (canHoldListRef(propField, new Set(visited), options)) {
          compatibleListKeys.add(key);
        }
        if (canHoldNestedRef(propField, new Set(visited))) {
          compatibleNestedKeys.add(key);
          if (propField.schema?._def?.typeName === 'ZodArray') {
            const arrayVisited = new Set(visited);
            for (const s of propField.traversed) {
              arrayVisited.add(s);
            }
            nestedElementAnalyses.set(
              key,
              analyzeSchema(propField.schema._def.type as z.ZodTypeAny, arrayVisited, options),
            );
          }
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
        const catchallField = unwrapZodField(catchall);
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
        nestedElementAnalyses,
        constrainsUnknownKeys,
        isEmptyObject:
          declaredKeys.size === 0 && !constrainsUnknownKeys && !openSingle && !openList,
        openSingle,
        openList,
      };
    }

    case 'ZodRecord': {
      const valueType = (unwrapped.schema._def as {valueType?: z.ZodTypeAny})['valueType'];
      let openSingle = true;
      let openList = true;
      if (valueType) {
        const valueField = unwrapZodField(valueType);
        openSingle = canHoldSingleRef(valueField, new Set(visited), options);
        openList = canHoldListRef(valueField, new Set(visited), options);
      }
      return {
        fields: new Map(),
        declaredKeys: new Set(),
        compatibleSingleKeys: new Set(),
        compatibleListKeys: new Set(),
        compatibleNestedKeys: new Set(),
        nestedElementAnalyses: new Map(),
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
        nestedElementAnalyses: new Map(),
        constrainsUnknownKeys: false,
        isEmptyObject: false,
        openSingle: true,
        openList: true,
      };

    case 'ZodIntersection': {
      const def = unwrapped.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      const left = analyzeSchema(def.left, new Set(visited), options);
      const right = analyzeSchema(def.right, new Set(visited), options);
      return intersectAnalyses(left, right);
    }

    case 'ZodPipeline': {
      const def = unwrapped.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
      const pipeIn = def['in'];
      const pipeOut = def['out'];
      const inField = unwrapZodField(pipeIn);
      if (inField.hasTransform) {
        const inAnalysis = analyzeSchema(pipeIn, new Set(visited), options);
        const outAnalysis = analyzeSchema(pipeOut, new Set(visited), options);
        for (const [key, kind] of outAnalysis.fields) {
          mergeCompatibleField(inAnalysis.fields, key, kind, outAnalysis, inAnalysis);
        }
        return inAnalysis;
      }
      const left = analyzeSchema(pipeIn, new Set(visited), options);
      const right = analyzeSchema(pipeOut, new Set(visited), options);
      return intersectAnalyses(left, right);
    }

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const unionOptions = getUnionOptions(unwrapped.schema) ?? [];
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
        nestedElementAnalyses: new Map(),
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

function intersectAnalyses(left: SchemaRefAnalysis, right: SchemaRefAnalysis): SchemaRefAnalysis {
  const fields = new Map<string, RefKind>();
  for (const [key, kind] of left.fields) {
    mergeCompatibleField(fields, key, kind, left, right);
  }
  for (const [key, kind] of right.fields) {
    mergeCompatibleField(fields, key, kind, right, left);
  }

  const declaredKeys = new Set([...left.declaredKeys, ...right.declaredKeys]);
  const compatibleSingleKeys = new Set<string>();
  const compatibleListKeys = new Set<string>();
  const compatibleNestedKeys = new Set<string>();
  const nestedElementAnalyses = new Map<string, SchemaRefAnalysis>();
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
      const leftElem = left.nestedElementAnalyses.get(key);
      const rightElem = right.nestedElementAnalyses.get(key);
      if (leftElem && rightElem) {
        nestedElementAnalyses.set(key, intersectAnalyses(leftElem, rightElem));
      } else if (leftElem || rightElem) {
        nestedElementAnalyses.set(key, (leftElem ?? rightElem)!);
      }
    }
  }

  const constrainsUnknownKeys = left.constrainsUnknownKeys || right.constrainsUnknownKeys;
  const isEmptyObject = !constrainsUnknownKeys && left.isEmptyObject && right.isEmptyObject;
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
    nestedElementAnalyses,
    constrainsUnknownKeys,
    isEmptyObject,
    openSingle,
    openList,
  };
}

function mergeCompatibleField(
  target: Map<string, RefKind>,
  key: string,
  kind: RefKind,
  source: SchemaRefAnalysis,
  other: SchemaRefAnalysis,
): void {
  if (kind.kind === 'nested') {
    if (!isRefCompatibleWithSide(key, kind, other)) {
      return;
    }
    const otherElem = other.nestedElementAnalyses.get(key);
    if (!otherElem) {
      mergeRefKind(target, key, kind);
      return;
    }
    const filteredKeys = new Set<string>();
    for (const subKey of kind.keys) {
      if (
        isRefCompatibleWithSide(subKey, {kind: 'single'}, otherElem) ||
        isRefCompatibleWithSide(subKey, {kind: 'list'}, otherElem)
      ) {
        filteredKeys.add(subKey);
      }
    }
    if (filteredKeys.size > 0) {
      mergeRefKind(target, key, {kind: 'nested', keys: filteredKeys});
    }
    return;
  }

  if (isRefCompatibleWithSide(key, kind, other)) {
    mergeRefKind(target, key, kind);
    return;
  }

  // Narrowing a `single | list` union (classified as `list`) with a single-only constraint
  // (e.g. `z.string()`) preserves the single-child reference capability.
  if (
    kind.kind === 'list' &&
    source.compatibleSingleKeys.has(key) &&
    isRefCompatibleWithSide(key, {kind: 'single'}, other)
  ) {
    mergeRefKind(target, key, {kind: 'single'});
  }
}

function isRefCompatibleWithSide(key: string, kind: RefKind, other: SchemaRefAnalysis): boolean {
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
  const explicitKind = classifyExplicitProperty(value, visited, options);
  if (explicitKind) {
    return explicitKind;
  }

  // Fallback for unannotated `child` / `children` (and version-specific child property names)
  // whose types can hold component references.
  const field = unwrapZodField(value);
  const isSingleChildKey = key === 'child' || Boolean(options?.childPropertyNames?.has(key));
  if (isSingleChildKey && canHoldSingleRef(field, new Set(visited), options)) {
    return {kind: 'single'};
  }
  if (key === 'children' && canHoldListRef(field, new Set(visited), options)) {
    return {kind: 'list'};
  }
  return undefined;
}

function classifyExplicitProperty(
  value: z.ZodTypeAny,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): RefKind | undefined {
  const field = unwrapZodField(value);
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return undefined;
    }
  }
  const nextVisited = new Set(visited);
  for (const s of field.traversed) {
    nextVisited.add(s);
  }

  const typeName = field.schema?._def?.typeName as string | undefined;

  // Zod's `.and()` copies the left operand's `description` onto the `ZodIntersection`,
  // so always verify ref compatibility against both sides of an intersection.
  if (typeName === 'ZodIntersection') {
    const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
    return classifyIntersectedProperty(def.left, def.right, nextVisited, options, field);
  }

  if (marksChildList(field, options) || isChildListUnion(field.schema)) {
    return {kind: 'list'};
  }

  // Zod's `.or()` copies the first operand's `description` onto the `ZodUnion`,
  // so inspect all union branches before settling on `'single'` (e.g. `ComponentId.or(ChildList)`).
  const unionOptions = getUnionOptions(field.schema);
  if (unionOptions) {
    const unionKind = classifyExplicitUnionOptions(unionOptions, nextVisited, options);
    if (unionKind?.kind === 'list') {
      return unionKind;
    }
    if (marksComponentId(field, options)) {
      return {kind: 'single'};
    }
    return unionKind;
  }

  if (marksComponentId(field, options)) {
    return {kind: 'single'};
  }

  if (typeName === 'ZodArray') {
    const rawElement = field.schema._def.type as z.ZodTypeAny;
    const element = unwrapZodField(rawElement);
    // A plain array of component ids: the marker sits on the element
    // rather than the property (z.array(ComponentIdSchema)).
    if (marksComponentId(element, options) || marksChildList(element, options)) {
      return {kind: 'list'};
    }
    const elementAnalysis = analyzeSchema(rawElement, nextVisited, options);
    const subKeys = new Set<string>();
    for (const [subKey, subKind] of elementAnalysis.fields) {
      if (subKind.kind === 'single' || subKind.kind === 'list') {
        subKeys.add(subKey);
      }
    }
    if (subKeys.size > 0) {
      return {kind: 'nested', keys: subKeys};
    }
    return undefined;
  }

  if (typeName === 'ZodPipeline') {
    const def = field.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
    const pipeIn = def['in'];
    const pipeOut = def['out'];
    const inField = unwrapZodField(pipeIn);
    if (inField.hasTransform) {
      const inKind = classifyExplicitProperty(pipeIn, new Set(nextVisited), options);
      if (inKind) {
        return inKind;
      }
      const outKind = classifyExplicitProperty(pipeOut, new Set(nextVisited), options);
      if (outKind && canHoldRefKind(outKind, inField, new Set(nextVisited), options)) {
        return outKind;
      }
      return undefined;
    }
    return classifyIntersectedProperty(pipeIn, pipeOut, nextVisited, options, field);
  }

  return undefined;
}

function classifyIntersectedProperty(
  leftRaw: z.ZodTypeAny,
  rightRaw: z.ZodTypeAny,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
  outerField?: UnwrappedZodField,
): RefKind | undefined {
  const leftField = unwrapZodField(leftRaw);
  const rightField = unwrapZodField(rightRaw);
  const leftKind = classifyExplicitProperty(leftRaw, new Set(visited), options);
  const rightKind = classifyExplicitProperty(rightRaw, new Set(visited), options);
  const merged = new Map<string, RefKind>();

  if (outerField) {
    if (
      marksChildList(outerField, options) &&
      canHoldListRef(leftField, new Set(visited), options) &&
      canHoldListRef(rightField, new Set(visited), options)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'list'});
    } else if (
      marksComponentId(outerField, options) &&
      canHoldSingleRef(leftField, new Set(visited), options) &&
      canHoldSingleRef(rightField, new Set(visited), options)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'single'});
    }
  }

  if (leftKind) {
    if (canHoldRefKind(leftKind, rightField, new Set(visited), options)) {
      mergeRefKind(merged, 'prop', leftKind);
    } else if (
      leftKind.kind === 'list' &&
      canHoldSingleRef(leftField, new Set(visited), options) &&
      canHoldSingleRef(rightField, new Set(visited), options)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'single'});
    }
  }

  if (rightKind) {
    if (canHoldRefKind(rightKind, leftField, new Set(visited), options)) {
      mergeRefKind(merged, 'prop', rightKind);
    } else if (
      rightKind.kind === 'list' &&
      canHoldSingleRef(rightField, new Set(visited), options) &&
      canHoldSingleRef(leftField, new Set(visited), options)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'single'});
    }
  }

  return merged.get('prop');
}

function canHoldRefKind(
  kind: RefKind,
  field: UnwrappedZodField,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): boolean {
  if (kind.kind === 'single') {
    return canHoldSingleRef(field, visited, options);
  }
  if (kind.kind === 'list') {
    return canHoldListRef(field, visited, options);
  }
  return canHoldNestedRef(field, visited);
}

function classifyExplicitUnionOptions(
  unionOptions: readonly z.ZodTypeAny[],
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): RefKind | undefined {
  const merged = new Map<string, RefKind>();
  for (const option of unionOptions) {
    const optKind = classifyExplicitProperty(option, new Set(visited), options);
    if (optKind) {
      mergeRefKind(merged, 'prop', optKind);
    }
  }
  return merged.get('prop');
}

function collectRefDefName(
  description: string | undefined,
  refDefNames: Set<string>,
  bareDefNames: Set<string>,
): string {
  if (!description) {
    return '';
  }
  if (description.startsWith('REF:')) {
    const defName = extractRefDefName(description.slice(4).split('|')[0]);
    if (defName) {
      refDefNames.add(defName);
    }
    return defName;
  }
  const refTarget = extractRefDefName(description.split('|')[0]);
  if (refTarget) {
    bareDefNames.add(refTarget);
  }
  const trimmed = description.trim();
  if (trimmed) {
    bareDefNames.add(trimmed);
  }
  return '';
}

function marksComponentId(field: UnwrappedZodField, options?: ChildRefAnalysisOptions): boolean {
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

function marksChildList(field: UnwrappedZodField, options?: ChildRefAnalysisOptions): boolean {
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

function hasNonChildRefMarker(
  field: UnwrappedZodField,
  options?: ChildRefAnalysisOptions,
): boolean {
  if (field.refDefNames.size === 0) {
    return false;
  }
  return !marksComponentId(field, options) && !marksChildList(field, options);
}

function canHoldSingleRef(
  field: UnwrappedZodField,
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

  const typeName = field.schema?._def?.typeName as string | undefined;
  if (typeName === 'ZodIntersection') {
    const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
    return (
      canHoldSingleRef(unwrapZodField(def.left), new Set(visited), options) &&
      canHoldSingleRef(unwrapZodField(def.right), new Set(visited), options)
    );
  }

  if (marksComponentId(field, options)) {
    return true;
  }
  if (hasNonChildRefMarker(field, options)) {
    return false;
  }

  const unionOptions = getUnionOptions(field.schema);
  if (unionOptions) {
    return unionOptions.some(option =>
      canHoldSingleRef(unwrapZodField(option), new Set(visited), options),
    );
  }

  if (marksChildList(field, options)) {
    return false;
  }

  switch (typeName) {
    case 'ZodString':
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    case 'ZodPipeline': {
      const def = field.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
      const inField = unwrapZodField(def['in']);
      if (inField.hasTransform) {
        return canHoldSingleRef(inField, new Set(visited), options);
      }
      return (
        canHoldSingleRef(inField, new Set(visited), options) &&
        canHoldSingleRef(unwrapZodField(def['out']), new Set(visited), options)
      );
    }
    default:
      return false;
  }
}

function canHoldListRef(
  field: UnwrappedZodField,
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

  const typeName = field.schema?._def?.typeName as string | undefined;
  if (typeName === 'ZodIntersection') {
    const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
    return (
      canHoldListRef(unwrapZodField(def.left), new Set(visited), options) &&
      canHoldListRef(unwrapZodField(def.right), new Set(visited), options)
    );
  }

  if (marksChildList(field, options) || isChildListUnion(field.schema)) {
    return true;
  }
  if (hasNonChildRefMarker(field, options)) {
    return false;
  }

  const unionOptions = getUnionOptions(field.schema);
  if (unionOptions) {
    return unionOptions.some(option =>
      canHoldListRef(unwrapZodField(option), new Set(visited), options),
    );
  }

  if (marksComponentId(field, options)) {
    return false;
  }

  switch (typeName) {
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    case 'ZodArray': {
      const element = unwrapZodField(field.schema._def.type as z.ZodTypeAny);
      return (
        canHoldSingleRef(element, new Set(visited), options) || isTemplateRefObject(element.schema)
      );
    }
    case 'ZodObject':
      return isTemplateRefObject(field.schema);
    case 'ZodPipeline': {
      const def = field.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
      const inField = unwrapZodField(def['in']);
      if (inField.hasTransform) {
        return canHoldListRef(inField, new Set(visited), options);
      }
      return (
        canHoldListRef(inField, new Set(visited), options) &&
        canHoldListRef(unwrapZodField(def['out']), new Set(visited), options)
      );
    }
    default:
      return false;
  }
}

function canHoldNestedRef(field: UnwrappedZodField, visited = new Set<z.ZodTypeAny>()): boolean {
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return false;
    }
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  const unionOptions = getUnionOptions(field.schema);
  if (unionOptions) {
    return unionOptions.some(option => canHoldNestedRef(unwrapZodField(option), new Set(visited)));
  }

  const typeName = field.schema?._def?.typeName as string | undefined;
  switch (typeName) {
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    case 'ZodArray':
      return canHoldObjectElement(
        unwrapZodField(field.schema._def.type as z.ZodTypeAny),
        new Set(visited),
      );
    case 'ZodIntersection': {
      const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      return (
        canHoldNestedRef(unwrapZodField(def.left), new Set(visited)) &&
        canHoldNestedRef(unwrapZodField(def.right), new Set(visited))
      );
    }
    case 'ZodPipeline': {
      const def = field.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
      const inField = unwrapZodField(def['in']);
      if (inField.hasTransform) {
        return canHoldNestedRef(inField, new Set(visited));
      }
      return (
        canHoldNestedRef(inField, new Set(visited)) &&
        canHoldNestedRef(unwrapZodField(def['out']), new Set(visited))
      );
    }
    default:
      return false;
  }
}

function canHoldObjectElement(field: UnwrappedZodField, visited: Set<z.ZodTypeAny>): boolean {
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return false;
    }
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  const unionOptions = getUnionOptions(field.schema);
  if (unionOptions) {
    return unionOptions.some(option =>
      canHoldObjectElement(unwrapZodField(option), new Set(visited)),
    );
  }

  const typeName = field.schema?._def?.typeName as string | undefined;
  switch (typeName) {
    case 'ZodObject':
    case 'ZodRecord':
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    case 'ZodIntersection': {
      const def = field.schema._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      return (
        canHoldObjectElement(unwrapZodField(def.left), new Set(visited)) &&
        canHoldObjectElement(unwrapZodField(def.right), new Set(visited))
      );
    }
    case 'ZodPipeline': {
      const def = field.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
      const inField = unwrapZodField(def['in']);
      if (inField.hasTransform) {
        return canHoldObjectElement(inField, new Set(visited));
      }
      return (
        canHoldObjectElement(inField, new Set(visited)) &&
        canHoldObjectElement(unwrapZodField(def['out']), new Set(visited))
      );
    }
    default:
      return false;
  }
}

/** Matches the binder's STRUCTURAL detection for `ChildList`-shaped unions. */
function isChildListUnion(schema: z.ZodTypeAny): boolean {
  const options = getUnionOptions(schema);
  if (!options) {
    return false;
  }
  return options.some(o => isTemplateRefObject(unwrapZodField(o).schema));
}
