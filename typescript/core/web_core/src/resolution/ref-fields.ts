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

import * as z from 'zod/v4';

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

const DEFAULT_OPTIONS_CACHE_KEY = {};
const refFieldsCache = new WeakMap<object, WeakMap<z.ZodTypeAny, RefFields>>();

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

/** Loose view of a zod 4 schema def (`schema._zod.def`); empty when `schema` is not a zod schema. */
export interface ZodDefView {
  type?: string;
  innerType: z.ZodTypeAny;
  in: z.ZodTypeAny;
  out: z.ZodTypeAny;
  left: z.ZodTypeAny;
  right: z.ZodTypeAny;
  element: z.ZodTypeAny;
  valueType?: z.ZodTypeAny;
  catchall?: z.ZodTypeAny;
  getter: () => z.ZodTypeAny;
  options?: z.ZodTypeAny[];
}

export function defOf(schema: z.ZodTypeAny | undefined): ZodDefView {
  return ((schema as {_zod?: {def?: unknown}} | undefined)?._zod?.def ?? {}) as ZodDefView;
}

function isTransformSchema(schema: z.ZodTypeAny | undefined): boolean {
  return defOf(schema).type === 'transform';
}

/**
 * Unwraps optional/nullable/default/readonly/catch/lazy wrappers and transform pipes
 * (`.transform()` / `z.preprocess()`, flagged via `hasTransform`),
 * collecting descriptions, `REF:` definition names, and child-ref markers along
 * the chain while stopping at combinators (`ZodPipe`, `ZodIntersection`,
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

  while (current && typeof current === 'object' && current._zod) {
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
    const ref = childRefKindOf(current);
    if (ref) {
      refs.add(ref);
    }

    const typeName = defOf(current).type;
    if (
      typeName === 'optional' ||
      typeName === 'nullable' ||
      typeName === 'default' ||
      typeName === 'prefault' ||
      typeName === 'readonly' ||
      typeName === 'catch'
    ) {
      current = defOf(current).innerType;
    } else if (typeName === 'pipe' && isTransformSchema(defOf(current).out)) {
      hasTransform = true;
      current = defOf(current).in;
    } else if (typeName === 'pipe' && isTransformSchema(defOf(current).in)) {
      hasTransform = true;
      current = defOf(current).out;
    } else if (typeName === 'lazy') {
      const getter = defOf(current).getter;
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
  const typeName = defOf(schema).type;
  if (typeName !== 'union') {
    return undefined;
  }
  return defOf(schema).options;
}

/**
 * Returns whether an unwrapped `ZodObject` matches a dynamic child-list template
 * shape (`{ componentId, path | @path | dataBinding }` or v0.8 `explicitList`/`template`).
 */
export function isTemplateRefObject(schema: z.ZodTypeAny): boolean {
  if (defOf(schema).type !== 'object') {
    return false;
  }
  const shape = (schema as z.ZodObject).shape as Record<string, z.ZodTypeAny>;
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
 * Returns whether property `key` with `schema` classifies as a single-child component reference.
 */
export function isSingleChildPropertySchema(
  key: string,
  schema: z.ZodTypeAny,
  options?: ChildRefAnalysisOptions,
): boolean {
  return classifyProperty(key, schema, new Set(), options)?.kind === 'single';
}

/**
 * Returns whether `schema` can accept an object or array value on the wire.
 */
export function canSchemaHoldObjectOrArray(schema: z.ZodTypeAny): boolean {
  const field = unwrapZodField(schema);
  return (
    canHoldObjectElement(field, new Set()) ||
    canHoldNestedRef(field, new Set()) ||
    defOf(field.schema).type === 'array'
  );
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
  const cacheKey = options ?? DEFAULT_OPTIONS_CACHE_KEY;
  let schemaCache = refFieldsCache.get(cacheKey);
  if (schemaCache) {
    const cached = schemaCache.get(schema);
    if (cached) {
      return cached;
    }
  } else {
    schemaCache = new WeakMap();
    refFieldsCache.set(cacheKey, schemaCache);
  }

  const analysis = analyzeSchema(schema, new Set(), options);
  const fields = analysis.fields;

  if (
    (analysis.isEmptyObject && !analysis.declaredKeys.has('child')) ||
    analysis.openChildFallback
  ) {
    mergeRefKind(fields, 'child', {kind: 'single'});
  }
  if (
    (analysis.isEmptyObject && !analysis.declaredKeys.has('children')) ||
    analysis.openChildrenFallback
  ) {
    mergeRefKind(fields, 'children', {kind: 'list'});
  }

  const result = fields.size === 0 ? EMPTY_REF_FIELDS : fields;
  schemaCache.set(schema, result);
  return result;
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
  openChildFallback: boolean;
  openChildrenFallback: boolean;
}

function emptyAnalysis(): SchemaRefAnalysis {
  return {
    fields: new Map(),
    declaredKeys: new Set(),
    compatibleSingleKeys: new Set(),
    compatibleListKeys: new Set(),
    compatibleNestedKeys: new Set(),
    nestedElementAnalyses: new Map(),
    constrainsUnknownKeys: true,
    isEmptyObject: false,
    openSingle: false,
    openList: false,
    openChildFallback: false,
    openChildrenFallback: false,
  };
}

function canPipelineStagePassKey(key: string, kind: RefKind, stage: SchemaRefAnalysis): boolean {
  if (stage.declaredKeys.has(key)) {
    return true;
  }
  return kind.kind === 'single' ? stage.openSingle : stage.openList;
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

  const typeName = defOf(unwrapped.schema).type;
  switch (typeName) {
    case 'object': {
      const objSchema = unwrapped.schema as z.ZodObject;
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
        if (canHoldSingleRef(propField, new Set(visited), options, true)) {
          compatibleSingleKeys.add(key);
        }
        if (canHoldListRef(propField, new Set(visited), options, true)) {
          compatibleListKeys.add(key);
        }
        if (canHoldNestedRef(propField, new Set(visited))) {
          compatibleNestedKeys.add(key);
          const elemAnalysis = extractNestedElementAnalysis(propField, new Set(visited), options);
          if (elemAnalysis) {
            nestedElementAnalyses.set(key, elemAnalysis);
          }
        }
      }

      const catchall = defOf(objSchema).catchall;
      const catchallType = defOf(catchall).type;
      let openSingle = false;
      let openList = false;
      let openChildFallback = false;
      let openChildrenFallback = false;
      let constrainsUnknownKeys = false;
      if (catchallType === 'unknown') {
        openSingle = true;
        openList = true;
        openChildFallback = !declaredKeys.has('child');
        openChildrenFallback = !declaredKeys.has('children');
      } else if (catchall && defOf(catchall).type !== 'never') {
        const catchallField = unwrapZodField(catchall);
        openSingle = canHoldSingleRef(catchallField, new Set(visited), options, true);
        openList = canHoldListRef(catchallField, new Set(visited), options, true);
        openChildFallback =
          !declaredKeys.has('child') &&
          canHoldSingleRef(catchallField, new Set(visited), options, false);
        openChildrenFallback =
          !declaredKeys.has('children') &&
          canHoldListRef(catchallField, new Set(visited), options, false);
        constrainsUnknownKeys = true;
      } else if (catchallType === 'never') {
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
        openChildFallback,
        openChildrenFallback,
      };
    }

    case 'record': {
      const valueType = defOf(unwrapped.schema).valueType;
      let openSingle = true;
      let openList = true;
      let openChildFallback = true;
      let openChildrenFallback = true;
      if (valueType) {
        const valueField = unwrapZodField(valueType);
        openSingle = canHoldSingleRef(valueField, new Set(visited), options, true);
        openList = canHoldListRef(valueField, new Set(visited), options, true);
        openChildFallback = canHoldSingleRef(valueField, new Set(visited), options, false);
        openChildrenFallback = canHoldListRef(valueField, new Set(visited), options, false);
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
        openChildFallback,
        openChildrenFallback,
      };
    }

    case 'any':
    case 'unknown':
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
        openChildFallback: true,
        openChildrenFallback: true,
      };

    case 'intersection': {
      const def = defOf(unwrapped.schema);
      const left = analyzeSchema(def.left, new Set(visited), options);
      const right = analyzeSchema(def.right, new Set(visited), options);
      return intersectAnalyses(left, right);
    }

    case 'pipe': {
      const def = defOf(unwrapped.schema);
      const left = analyzeSchema(def.in, new Set(visited), options);
      const right = analyzeSchema(def.out, new Set(visited), options);
      return pipeAnalyses(left, right);
    }

    case 'union': {
      const unionOptions = getUnionOptions(unwrapped.schema) ?? [];
      const subs = unionOptions.map(option => analyzeSchema(option, new Set(visited), options));
      return unionAnalyses(subs);
    }

    default:
      return emptyAnalysis();
  }
}

function unionAnalyses(subs: readonly SchemaRefAnalysis[]): SchemaRefAnalysis {
  const fields = new Map<string, RefKind>();
  const declaredKeys = new Set<string>();
  const compatibleSingleKeys = new Set<string>();
  const compatibleListKeys = new Set<string>();
  const compatibleNestedKeys = new Set<string>();
  let allEmpty = subs.length > 0;
  let allConstrainUnknown = subs.length > 0;
  let openSingle = false;
  let openList = false;
  let openChildFallback = false;
  let openChildrenFallback = false;

  for (const sub of subs) {
    for (const [key, kind] of sub.fields) {
      mergeRefKind(fields, key, kind);
    }
    for (const key of sub.declaredKeys) {
      declaredKeys.add(key);
    }
    allEmpty = allEmpty && sub.isEmptyObject;
    allConstrainUnknown = allConstrainUnknown && sub.constrainsUnknownKeys;
    openSingle = openSingle || sub.openSingle;
    openList = openList || sub.openList;
    openChildFallback = openChildFallback || sub.openChildFallback;
    openChildrenFallback = openChildrenFallback || sub.openChildrenFallback;
  }

  for (const key of declaredKeys) {
    if (subs.some(sub => isRefCompatibleWithSide(key, {kind: 'single'}, sub))) {
      compatibleSingleKeys.add(key);
    }
    if (subs.some(sub => isRefCompatibleWithSide(key, {kind: 'list'}, sub))) {
      compatibleListKeys.add(key);
    }
    if (subs.some(sub => isRefCompatibleWithSide(key, {kind: 'nested', keys: new Set()}, sub))) {
      compatibleNestedKeys.add(key);
    }
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
    openChildFallback,
    openChildrenFallback,
  };
}

function pipeAnalyses(left: SchemaRefAnalysis, right: SchemaRefAnalysis): SchemaRefAnalysis {
  const piped = intersectAnalyses(left, right, true);
  for (const [key, kind] of [...piped.fields]) {
    if (!canPipelineStagePassKey(key, kind, left) || !canPipelineStagePassKey(key, kind, right)) {
      piped.fields.delete(key);
    }
  }
  for (const key of [...piped.compatibleSingleKeys]) {
    if (
      !canPipelineStagePassKey(key, {kind: 'single'}, left) ||
      !canPipelineStagePassKey(key, {kind: 'single'}, right)
    ) {
      piped.compatibleSingleKeys.delete(key);
    }
  }
  for (const key of [...piped.compatibleListKeys]) {
    if (
      !canPipelineStagePassKey(key, {kind: 'list'}, left) ||
      !canPipelineStagePassKey(key, {kind: 'list'}, right)
    ) {
      piped.compatibleListKeys.delete(key);
    }
  }
  for (const key of [...piped.compatibleNestedKeys]) {
    const dummyNested: RefKind = {kind: 'nested', keys: new Set()};
    if (
      !canPipelineStagePassKey(key, dummyNested, left) ||
      !canPipelineStagePassKey(key, dummyNested, right)
    ) {
      piped.compatibleNestedKeys.delete(key);
      piped.nestedElementAnalyses.delete(key);
    }
  }
  piped.openSingle = !piped.isEmptyObject && left.openSingle && right.openSingle;
  piped.openList = !piped.isEmptyObject && left.openList && right.openList;
  piped.openChildFallback =
    !piped.isEmptyObject && left.openChildFallback && right.openChildFallback;
  piped.openChildrenFallback =
    !piped.isEmptyObject && left.openChildrenFallback && right.openChildrenFallback;
  return piped;
}

function intersectAnalyses(
  left: SchemaRefAnalysis,
  right: SchemaRefAnalysis,
  isPipeline = false,
): SchemaRefAnalysis {
  const fields = new Map<string, RefKind>();
  for (const [key, kind] of left.fields) {
    mergeCompatibleField(fields, key, kind, left, right, isPipeline);
  }
  for (const [key, kind] of right.fields) {
    mergeCompatibleField(fields, key, kind, right, left, isPipeline);
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
        nestedElementAnalyses.set(
          key,
          isPipeline ? pipeAnalyses(leftElem, rightElem) : intersectAnalyses(leftElem, rightElem),
        );
      } else if (leftElem || rightElem) {
        nestedElementAnalyses.set(key, (leftElem ?? rightElem)!);
      }
    }
  }

  const constrainsUnknownKeys = left.constrainsUnknownKeys || right.constrainsUnknownKeys;
  const isEmptyObject = !constrainsUnknownKeys && left.isEmptyObject && right.isEmptyObject;
  const openSingle =
    !isEmptyObject &&
    (left.openSingle || right.openSingle) &&
    (left.openSingle || !left.constrainsUnknownKeys) &&
    (right.openSingle || !right.constrainsUnknownKeys);
  const openList =
    !isEmptyObject &&
    (left.openList || right.openList) &&
    (left.openList || !left.constrainsUnknownKeys) &&
    (right.openList || !right.constrainsUnknownKeys);
  const openChildFallback =
    !isEmptyObject &&
    !declaredKeys.has('child') &&
    (left.openChildFallback || right.openChildFallback) &&
    (left.openChildFallback || !left.constrainsUnknownKeys) &&
    (right.openChildFallback || !right.constrainsUnknownKeys);
  const openChildrenFallback =
    !isEmptyObject &&
    !declaredKeys.has('children') &&
    (left.openChildrenFallback || right.openChildrenFallback) &&
    (left.openChildrenFallback || !left.constrainsUnknownKeys) &&
    (right.openChildrenFallback || !right.constrainsUnknownKeys);

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
    openChildFallback,
    openChildrenFallback,
  };
}

function filterNestedSubKeys(
  keys: ReadonlySet<string>,
  ownElem: SchemaRefAnalysis | undefined,
  otherElem: SchemaRefAnalysis | undefined,
  isPipeline = false,
): Set<string> {
  const filteredKeys = new Set<string>();
  for (const subKey of keys) {
    const singleOk =
      (!ownElem ||
        (isRefCompatibleWithSide(subKey, {kind: 'single'}, ownElem) &&
          (!isPipeline || canPipelineStagePassKey(subKey, {kind: 'single'}, ownElem)))) &&
      (!otherElem ||
        (isRefCompatibleWithSide(subKey, {kind: 'single'}, otherElem) &&
          (!isPipeline || canPipelineStagePassKey(subKey, {kind: 'single'}, otherElem))));
    const listOk =
      (!ownElem ||
        (isRefCompatibleWithSide(subKey, {kind: 'list'}, ownElem) &&
          (!isPipeline || canPipelineStagePassKey(subKey, {kind: 'list'}, ownElem)))) &&
      (!otherElem ||
        (isRefCompatibleWithSide(subKey, {kind: 'list'}, otherElem) &&
          (!isPipeline || canPipelineStagePassKey(subKey, {kind: 'list'}, otherElem))));
    if (singleOk || listOk) {
      filteredKeys.add(subKey);
    }
  }
  return filteredKeys;
}

function mergeCompatibleField(
  target: Map<string, RefKind>,
  key: string,
  kind: RefKind,
  source: SchemaRefAnalysis,
  other: SchemaRefAnalysis,
  isPipeline = false,
): void {
  if (kind.kind === 'nested') {
    if (!isRefCompatibleWithSide(key, kind, other)) {
      if (
        source.compatibleListKeys.has(key) &&
        isRefCompatibleWithSide(key, {kind: 'list'}, other)
      ) {
        mergeRefKind(target, key, {kind: 'list'});
      } else if (
        source.compatibleSingleKeys.has(key) &&
        isRefCompatibleWithSide(key, {kind: 'single'}, other)
      ) {
        mergeRefKind(target, key, {kind: 'single'});
      }
      return;
    }
    const otherElem = other.nestedElementAnalyses.get(key);
    if (!otherElem && !isPipeline) {
      mergeRefKind(target, key, kind);
      return;
    }
    const filteredKeys = filterNestedSubKeys(
      kind.keys,
      source.nestedElementAnalyses.get(key),
      otherElem,
      isPipeline,
    );
    if (filteredKeys.size > 0) {
      mergeRefKind(target, key, {kind: 'nested', keys: filteredKeys});
    } else if (
      source.compatibleListKeys.has(key) &&
      isRefCompatibleWithSide(key, {kind: 'list'}, other)
    ) {
      mergeRefKind(target, key, {kind: 'list'});
    } else if (
      source.compatibleSingleKeys.has(key) &&
      isRefCompatibleWithSide(key, {kind: 'single'}, other)
    ) {
      mergeRefKind(target, key, {kind: 'single'});
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
  if (
    (existing.kind === 'single' && (incoming.kind === 'list' || incoming.kind === 'nested')) ||
    (existing.kind === 'list' && incoming.kind === 'nested')
  ) {
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

  const typeName = defOf(field.schema).type;

  // Verify ref compatibility against both sides of an intersection.
  if (typeName === 'intersection') {
    const def = defOf(field.schema);
    return classifyIntersectedProperty(def.left, def.right, nextVisited, options, field, false);
  }

  // Zod's `.or()` copies the first operand's `description` onto the `ZodUnion`,
  // so inspect all union branches and merge with any outer marker so `[list, nested]`
  // and `[single, nested]` unions remain order-independent.
  const unionOptions = getUnionOptions(field.schema);
  if (unionOptions) {
    const merged = new Map<string, RefKind>();
    const unionKind = classifyExplicitUnionOptions(unionOptions, nextVisited, options);
    if (unionKind) {
      mergeRefKind(merged, 'prop', unionKind);
    }
    if (marksChildList(field, options) || isChildListUnion(field.schema)) {
      mergeRefKind(merged, 'prop', {kind: 'list'});
    } else if (marksComponentId(field, options)) {
      mergeRefKind(merged, 'prop', {kind: 'single'});
    }
    return merged.get('prop');
  }

  if (marksChildList(field, options) || isTemplateRefObject(field.schema)) {
    return {kind: 'list'};
  }

  if (marksComponentId(field, options)) {
    return {kind: 'single'};
  }

  if (typeName === 'array') {
    const rawElement = defOf(field.schema).element;
    const elementAnalysis = analyzeSchema(rawElement, new Set(nextVisited), options);
    const subKeys = new Set<string>();
    for (const [subKey, subKind] of elementAnalysis.fields) {
      if (subKind.kind === 'single' || subKind.kind === 'list') {
        subKeys.add(subKey);
      }
    }
    if (subKeys.size > 0) {
      return {kind: 'nested', keys: subKeys};
    }
    // A plain array of component ids or child lists: classify the element
    // recursively so pipelines (`ComponentIdSchema.pipe(z.string())`) and
    // incompatible intersections (`ComponentIdSchema.and(z.number())`) are
    // handled consistently.
    const elementKind = classifyExplicitProperty(rawElement, nextVisited, options);
    if (elementKind?.kind === 'single' || elementKind?.kind === 'list') {
      return {kind: 'list'};
    }
    return undefined;
  }

  if (typeName === 'pipe') {
    const def = defOf(field.schema);
    const pipeIn = def.in;
    const pipeOut = def.out;
    const inField = unwrapZodField(pipeIn);
    if (inField.hasTransform) {
      const inKind = classifyExplicitProperty(pipeIn, new Set(nextVisited), options);
      if (inKind) {
        if (inKind.kind === 'nested') {
          const outField = unwrapZodField(pipeOut);
          if (canHoldNestedRef(outField, new Set(nextVisited))) {
            const ownElem = extractNestedElementAnalysis(inField, new Set(nextVisited), options);
            const outElem = extractNestedElementAnalysis(outField, new Set(nextVisited), options);
            const filteredKeys = filterNestedSubKeys(inKind.keys, ownElem, outElem, true);
            return filteredKeys.size > 0 ? {kind: 'nested', keys: filteredKeys} : undefined;
          }
        }
        return inKind;
      }
      const outKind = classifyExplicitProperty(pipeOut, new Set(nextVisited), options);
      if (outKind && canHoldRefKind(outKind, inField, new Set(nextVisited), options)) {
        return outKind;
      }
      return undefined;
    }
    return classifyIntersectedProperty(pipeIn, pipeOut, nextVisited, options, field, true);
  }

  return undefined;
}

function extractNestedElementAnalysis(
  field: UnwrappedZodField,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): SchemaRefAnalysis | undefined {
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return undefined;
    }
  }
  const nextVisited = new Set(visited);
  for (const s of field.traversed) {
    nextVisited.add(s);
  }

  const unionOptions = getUnionOptions(field.schema);
  if (unionOptions) {
    const nestedBranches = unionOptions.filter(opt =>
      canHoldNestedRef(unwrapZodField(opt), new Set(nextVisited)),
    );
    if (nestedBranches.length === 0) {
      return emptyAnalysis();
    }
    const branchAnalyses: SchemaRefAnalysis[] = [];
    for (const opt of nestedBranches) {
      const elem = extractNestedElementAnalysis(unwrapZodField(opt), new Set(nextVisited), options);
      if (!elem) {
        return undefined;
      }
      branchAnalyses.push(elem);
    }
    return unionAnalyses(branchAnalyses);
  }

  const typeName = defOf(field.schema).type;
  switch (typeName) {
    case 'any':
    case 'unknown':
      return undefined;
    case 'array':
      return analyzeSchema(defOf(field.schema).element, new Set(nextVisited), options);
    case 'intersection': {
      const def = defOf(field.schema);
      const leftElem = extractNestedElementAnalysis(
        unwrapZodField(def.left),
        new Set(nextVisited),
        options,
      );
      const rightElem = extractNestedElementAnalysis(
        unwrapZodField(def.right),
        new Set(nextVisited),
        options,
      );
      return leftElem && rightElem
        ? intersectAnalyses(leftElem, rightElem)
        : (leftElem ?? rightElem);
    }
    case 'pipe': {
      const def = defOf(field.schema);
      const inElem = extractNestedElementAnalysis(
        unwrapZodField(def.in),
        new Set(nextVisited),
        options,
      );
      const outElem = extractNestedElementAnalysis(
        unwrapZodField(def.out),
        new Set(nextVisited),
        options,
      );
      return inElem && outElem ? pipeAnalyses(inElem, outElem) : (inElem ?? outElem);
    }
    default:
      return emptyAnalysis();
  }
}

function classifyIntersectedProperty(
  leftRaw: z.ZodTypeAny,
  rightRaw: z.ZodTypeAny,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
  outerField?: UnwrappedZodField,
  isPipeline = false,
): RefKind | undefined {
  const leftField = unwrapZodField(leftRaw);
  const rightField = unwrapZodField(rightRaw);
  const leftKind = classifyExplicitProperty(leftRaw, new Set(visited), options);
  const rightKind = classifyExplicitProperty(rightRaw, new Set(visited), options);
  const merged = new Map<string, RefKind>();

  if (outerField) {
    if (
      marksChildList(outerField, options) &&
      canHoldListRef(leftField, new Set(visited), options, true) &&
      canHoldListRef(rightField, new Set(visited), options, true)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'list'});
    } else if (
      marksComponentId(outerField, options) &&
      canHoldSingleRef(leftField, new Set(visited), options, true) &&
      canHoldSingleRef(rightField, new Set(visited), options, true)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'single'});
    }
  }

  const mergeSide = (
    sideKind: RefKind | undefined,
    ownField: UnwrappedZodField,
    otherField: UnwrappedZodField,
  ) => {
    if (!sideKind) return;
    if (canHoldRefKind(sideKind, otherField, new Set(visited), options)) {
      if (sideKind.kind === 'nested') {
        const ownElem = extractNestedElementAnalysis(ownField, new Set(visited), options);
        const otherElem = extractNestedElementAnalysis(otherField, new Set(visited), options);
        const filteredKeys = filterNestedSubKeys(sideKind.keys, ownElem, otherElem, isPipeline);
        if (filteredKeys.size > 0) {
          mergeRefKind(merged, 'prop', {kind: 'nested', keys: filteredKeys});
          return;
        }
      } else {
        mergeRefKind(merged, 'prop', sideKind);
        return;
      }
    }
    if (
      sideKind.kind === 'nested' &&
      canHoldListRef(ownField, new Set(visited), options, true) &&
      canHoldListRef(otherField, new Set(visited), options, true)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'list'});
    } else if (
      (sideKind.kind === 'list' || sideKind.kind === 'nested') &&
      canHoldSingleRef(ownField, new Set(visited), options, true) &&
      canHoldSingleRef(otherField, new Set(visited), options, true)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'single'});
    }
  };

  mergeSide(leftKind, leftField, rightField);
  mergeSide(rightKind, rightField, leftField);

  return merged.get('prop');
}

function canHoldRefKind(
  kind: RefKind,
  field: UnwrappedZodField,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): boolean {
  if (kind.kind === 'single') {
    return canHoldSingleRef(field, visited, options, true);
  }
  if (kind.kind === 'list') {
    return canHoldListRef(field, visited, options, true);
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

function isDynamicBindingObject(schema: z.ZodTypeAny): boolean {
  if (defOf(schema).type !== 'object' || isTemplateRefObject(schema)) {
    return false;
  }
  const shape = (schema as z.ZodObject).shape as Record<string, z.ZodTypeAny>;
  return (
    Object.hasOwn(shape, 'path') ||
    Object.hasOwn(shape, '@path') ||
    Object.hasOwn(shape, 'call') ||
    Object.hasOwn(shape, '@call')
  );
}

function isDynamicValueUnion(
  unionOptions: readonly z.ZodTypeAny[],
  options?: ChildRefAnalysisOptions,
): boolean {
  let hasExplicitChildMarker = false;
  let hasDynamicBranch = false;
  const visited = new Set<z.ZodTypeAny>();

  const visit = (opts: readonly z.ZodTypeAny[]): void => {
    for (const opt of opts) {
      const unwrapped = unwrapZodField(opt);
      let seen = false;
      for (const s of unwrapped.traversed) {
        if (visited.has(s)) {
          seen = true;
          break;
        }
      }
      if (seen) {
        continue;
      }
      for (const s of unwrapped.traversed) {
        visited.add(s);
      }

      if (marksComponentId(unwrapped, options) || marksChildList(unwrapped, options)) {
        hasExplicitChildMarker = true;
        return;
      }
      if (hasNonChildRefMarker(unwrapped, options) || isDynamicBindingObject(unwrapped.schema)) {
        hasDynamicBranch = true;
      }
      const nestedOptions = getUnionOptions(unwrapped.schema);
      if (nestedOptions) {
        visit(nestedOptions);
        if (hasExplicitChildMarker) {
          return;
        }
      } else if (defOf(unwrapped.schema).type === 'pipe') {
        const def = defOf(unwrapped.schema);
        const inField = unwrapZodField(def.in);
        visit([def.in]);
        if (hasExplicitChildMarker) {
          return;
        }
        if (
          !inField.hasTransform &&
          (canHoldObjectElement(inField, new Set()) ||
            canHoldSingleRef(inField, new Set(), options, true) ||
            canHoldListRef(inField, new Set(), options, true))
        ) {
          visit([def.out]);
          if (hasExplicitChildMarker) {
            return;
          }
        }
      }
    }
  };

  visit(unionOptions);
  return hasDynamicBranch && !hasExplicitChildMarker;
}

function canHoldSingleRef(
  field: UnwrappedZodField,
  visited = new Set<z.ZodTypeAny>(),
  options?: ChildRefAnalysisOptions,
  allowDynamicValue = false,
): boolean {
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return false;
    }
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  const typeName = defOf(field.schema).type;
  if (typeName === 'intersection') {
    const def = defOf(field.schema);
    return (
      canHoldSingleRef(unwrapZodField(def.left), new Set(visited), options, allowDynamicValue) &&
      canHoldSingleRef(unwrapZodField(def.right), new Set(visited), options, allowDynamicValue)
    );
  }

  if (marksComponentId(field, options)) {
    return true;
  }
  if (!allowDynamicValue && hasNonChildRefMarker(field, options)) {
    return false;
  }

  const unionOptions = getUnionOptions(field.schema);
  if (unionOptions) {
    if (!allowDynamicValue && isDynamicValueUnion(unionOptions, options)) {
      return false;
    }
    return unionOptions.some(option =>
      canHoldSingleRef(unwrapZodField(option), new Set(visited), options, allowDynamicValue),
    );
  }

  if (marksChildList(field, options)) {
    return false;
  }

  switch (typeName) {
    case 'string':
    case 'any':
    case 'unknown':
      return true;
    case 'pipe': {
      const def = defOf(field.schema);
      const inField = unwrapZodField(def.in);
      if (inField.hasTransform) {
        return canHoldSingleRef(inField, new Set(visited), options, allowDynamicValue);
      }
      return (
        canHoldSingleRef(inField, new Set(visited), options, allowDynamicValue) &&
        canHoldSingleRef(unwrapZodField(def.out), new Set(visited), options, allowDynamicValue)
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
  allowDynamicValue = false,
): boolean {
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return false;
    }
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  const typeName = defOf(field.schema).type;
  if (typeName === 'intersection') {
    const def = defOf(field.schema);
    return (
      canHoldListRef(unwrapZodField(def.left), new Set(visited), options, allowDynamicValue) &&
      canHoldListRef(unwrapZodField(def.right), new Set(visited), options, allowDynamicValue)
    );
  }

  if (marksChildList(field, options) || isChildListUnion(field.schema)) {
    return true;
  }
  if (!allowDynamicValue && hasNonChildRefMarker(field, options)) {
    return false;
  }

  const unionOptions = getUnionOptions(field.schema);
  if (unionOptions) {
    if (!allowDynamicValue && isDynamicValueUnion(unionOptions, options)) {
      return false;
    }
    return unionOptions.some(option =>
      canHoldListRef(unwrapZodField(option), new Set(visited), options, allowDynamicValue),
    );
  }

  if (marksComponentId(field, options)) {
    return false;
  }

  switch (typeName) {
    case 'any':
    case 'unknown':
      return true;
    case 'array': {
      const element = unwrapZodField(defOf(field.schema).element);
      return (
        canHoldSingleRef(element, new Set(visited), options, allowDynamicValue) ||
        isTemplateRefObject(element.schema)
      );
    }
    case 'object':
      return isTemplateRefObject(field.schema);
    case 'pipe': {
      const def = defOf(field.schema);
      const inField = unwrapZodField(def.in);
      if (inField.hasTransform) {
        return canHoldListRef(inField, new Set(visited), options, allowDynamicValue);
      }
      return (
        canHoldListRef(inField, new Set(visited), options, allowDynamicValue) &&
        canHoldListRef(unwrapZodField(def.out), new Set(visited), options, allowDynamicValue)
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

  const typeName = defOf(field.schema).type;
  switch (typeName) {
    case 'any':
    case 'unknown':
      return true;
    case 'array':
      return canHoldObjectElement(unwrapZodField(defOf(field.schema).element), new Set(visited));
    case 'intersection': {
      const def = defOf(field.schema);
      return (
        canHoldNestedRef(unwrapZodField(def.left), new Set(visited)) &&
        canHoldNestedRef(unwrapZodField(def.right), new Set(visited))
      );
    }
    case 'pipe': {
      const def = defOf(field.schema);
      const inField = unwrapZodField(def.in);
      if (inField.hasTransform) {
        return canHoldNestedRef(inField, new Set(visited));
      }
      return (
        canHoldNestedRef(inField, new Set(visited)) &&
        canHoldNestedRef(unwrapZodField(def.out), new Set(visited))
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

  const typeName = defOf(field.schema).type;
  switch (typeName) {
    case 'object':
    case 'record':
    case 'any':
    case 'unknown':
      return true;
    case 'intersection': {
      const def = defOf(field.schema);
      return (
        canHoldObjectElement(unwrapZodField(def.left), new Set(visited)) &&
        canHoldObjectElement(unwrapZodField(def.right), new Set(visited))
      );
    }
    case 'pipe': {
      const def = defOf(field.schema);
      const inField = unwrapZodField(def.in);
      if (inField.hasTransform) {
        return canHoldObjectElement(inField, new Set(visited));
      }
      return (
        canHoldObjectElement(inField, new Set(visited)) &&
        canHoldObjectElement(unwrapZodField(def.out), new Set(visited))
      );
    }
    default:
      return false;
  }
}

/** Matches the binder's STRUCTURAL detection for `ChildList`-shaped unions. */
function isChildListUnion(schema: z.ZodTypeAny, visited = new Set<z.ZodTypeAny>()): boolean {
  const options = getUnionOptions(schema);
  if (!options) {
    return false;
  }
  for (const o of options) {
    const unwrapped = unwrapZodField(o);
    let seen = false;
    for (const s of unwrapped.traversed) {
      if (visited.has(s)) {
        seen = true;
        break;
      }
    }
    if (seen) {
      continue;
    }
    const nextVisited = new Set(visited);
    for (const s of unwrapped.traversed) {
      nextVisited.add(s);
    }
    if (isTemplateRefObject(unwrapped.schema)) {
      return true;
    }
    if (isChildListUnion(unwrapped.schema, nextVisited)) {
      return true;
    }
    if (defOf(unwrapped.schema).type === 'pipe') {
      const def = defOf(unwrapped.schema);
      const inField = unwrapZodField(def.in);
      if (
        !inField.hasTransform &&
        canHoldListRef(inField, new Set(nextVisited)) &&
        (isTemplateRefObject(unwrapZodField(def.out).schema) ||
          isChildListUnion(unwrapZodField(def.out).schema, nextVisited))
      ) {
        return true;
      }
    }
  }
  return false;
}
