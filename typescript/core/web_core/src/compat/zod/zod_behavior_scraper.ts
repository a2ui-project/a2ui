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

import type {ModelBehaviorNode} from '../../catalog/model/model_semantics.js';
import {isDynamicBooleanSchema} from '../../catalog/validation_result_coercion.js';
import {
  type ChildRefAnalysisOptions,
  type UnwrappedZodField,
  canSchemaHoldListRef,
  canSchemaHoldObjectOrArray,
  extractRefFields,
  getUnionOptions,
  isSingleChildPropertySchema,
  isTemplateRefObject,
  unwrapZodField,
} from '../../resolution/ref-fields.js';
import type {ChildRefKind} from '../../types/child-ref-helpers.js';
import {AccessibilityAttributesSchema} from '../../types/common-types.js';

type ObjectBehaviorNode = Extract<ModelBehaviorNode, {type: 'OBJECT'}>;

const AT_ACCESSIBILITY = '@accessibility';
const AT_CHECKS = '@checks';

const CHILD_REF_STATIC_NODE: ModelBehaviorNode = Object.freeze({type: 'STATIC' as const});

function hasActiveBehavior(node: ModelBehaviorNode): boolean {
  switch (node.type) {
    case 'STATIC':
      return false;
    case 'DYNAMIC':
    case 'ACTION':
    case 'STRUCTURAL':
    case 'CHECKABLE':
      return true;
    case 'ARRAY':
      return Boolean(node.templateFallback) || hasActiveBehavior(node.element);
    case 'OBJECT':
      return (
        (node.catchall !== undefined && hasActiveBehavior(node.catchall)) ||
        Object.values(node.shape).some(hasActiveBehavior)
      );
  }
}

const DEFAULT_OPTIONS_CACHE_KEY = {};
const behaviorCache = new WeakMap<object, WeakMap<z.ZodTypeAny, ModelBehaviorNode>>();
const componentBehaviorCache = new WeakMap<object, WeakMap<z.ZodTypeAny, ModelBehaviorNode>>();

function getOptionsBehaviorCache(
  store: WeakMap<object, WeakMap<z.ZodTypeAny, ModelBehaviorNode>>,
  options?: ChildRefAnalysisOptions,
): WeakMap<z.ZodTypeAny, ModelBehaviorNode> {
  const key = options ?? DEFAULT_OPTIONS_CACHE_KEY;
  let map = store.get(key);
  if (!map) {
    map = new WeakMap<z.ZodTypeAny, ModelBehaviorNode>();
    store.set(key, map);
  }
  return map;
}

function makeObjectBehavior(
  shape: Record<string, ModelBehaviorNode>,
  catchall?: ModelBehaviorNode,
): ObjectBehaviorNode {
  return catchall && catchall.type !== 'STATIC'
    ? {type: 'OBJECT', shape, catchall}
    : {type: 'OBJECT', shape};
}

function augmentRootObjectShape(
  schema: z.ZodTypeAny | undefined,
  baseShape: Record<string, ModelBehaviorNode>,
  options?: ChildRefAnalysisOptions,
): Record<string, ModelBehaviorNode> {
  const nextShape: Record<string, ModelBehaviorNode> = {...baseShape};
  for (const [key, refKind] of extractRefFields(schema, options)) {
    if (refKind.kind === 'single') {
      if (nextShape[key]?.type === 'DYNAMIC') {
        nextShape[key] = CHILD_REF_STATIC_NODE;
      }
    } else if (refKind.kind === 'list' && nextShape[key]?.type !== 'STRUCTURAL') {
      const current = nextShape[key];
      nextShape[key] =
        current?.type === 'ARRAY' && hasActiveBehavior(current.element)
          ? {type: 'ARRAY', element: current.element, templateFallback: true}
          : {type: 'STRUCTURAL'};
    } else if (
      refKind.kind === 'nested' &&
      (!Object.hasOwn(nextShape, key) || nextShape[key]?.type === 'STATIC')
    ) {
      nextShape[key] = {type: 'STRUCTURAL'};
    }
  }
  const accessibility = getFieldBehavior(AccessibilityAttributesSchema, new Set(), options);
  if (!Object.hasOwn(nextShape, 'accessibility')) {
    nextShape['accessibility'] = accessibility;
  }
  if (!Object.hasOwn(nextShape, AT_ACCESSIBILITY)) {
    nextShape[AT_ACCESSIBILITY] = accessibility;
  }
  if (!Object.hasOwn(nextShape, AT_CHECKS)) {
    nextShape[AT_CHECKS] = {type: 'CHECKABLE'};
  }
  return nextShape;
}

/**
 * Legacy Zod AST behavior scraper for arbitrary schemas.
 */
export function scrapeZodSchemaBehavior(
  schema: z.ZodTypeAny | undefined,
  options?: ChildRefAnalysisOptions,
): ModelBehaviorNode {
  if (!schema) {
    return {type: 'STATIC'};
  }
  const cache = getOptionsBehaviorCache(behaviorCache, options);
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  const behavior = getFieldBehavior(schema, new Set(), options);
  const result: ModelBehaviorNode =
    behavior.type === 'OBJECT'
      ? makeObjectBehavior(
          augmentRootObjectShape(schema, behavior.shape, options),
          behavior.catchall,
        )
      : behavior;
  cache.set(schema, result);
  return result;
}

/**
 * Legacy Zod AST behavior scraper for component property schemas.
 */
export function scrapeZodComponentBehavior(
  schema: z.ZodTypeAny | undefined,
  options?: ChildRefAnalysisOptions,
): ModelBehaviorNode {
  if (!schema) {
    return makeObjectBehavior(augmentRootObjectShape(undefined, {}, options));
  }
  const cache = getOptionsBehaviorCache(componentBehaviorCache, options);
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  const scraped = scrapeZodSchemaBehavior(schema, options);
  const result: ModelBehaviorNode =
    scraped.type === 'OBJECT'
      ? scraped
      : makeObjectBehavior(augmentRootObjectShape(schema, {}, options));
  cache.set(schema, result);
  return result;
}

function getRefDefName(type: z.ZodTypeAny, visited = new Set<z.ZodTypeAny>()): string {
  const field = unwrapZodField(type);
  if (field.firstRefDefName) {
    return field.firstRefDefName;
  }
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return '';
    }
  }
  if (field.schema?._def?.typeName === 'ZodPipeline') {
    const nextVisited = new Set(visited);
    for (const s of field.traversed) {
      nextVisited.add(s);
    }
    const def = field.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
    const inRef = getRefDefName(def['in'], nextVisited);
    if (inRef) {
      return inRef;
    }
    if (!unwrapZodField(def['in']).hasTransform) {
      return getRefDefName(def['out'], nextVisited);
    }
  }
  return '';
}

function hasChildRefKind(
  type: z.ZodTypeAny,
  kind: ChildRefKind,
  visited = new Set<z.ZodTypeAny>(),
): boolean {
  const field = unwrapZodField(type);
  if (field.refs.has(kind)) {
    return true;
  }
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return false;
    }
  }
  if (field.schema?._def?.typeName === 'ZodPipeline') {
    const nextVisited = new Set(visited);
    for (const s of field.traversed) {
      nextVisited.add(s);
    }
    const def = field.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
    if (hasChildRefKind(def['in'], kind, nextVisited)) {
      return true;
    }
    if (!unwrapZodField(def['in']).hasTransform) {
      return hasChildRefKind(def['out'], kind, nextVisited);
    }
  }
  return false;
}

function somePipelineLeaf(
  schema: z.ZodTypeAny,
  predicate: (leaf: z.ZodTypeAny) => boolean,
  visited = new Set<z.ZodTypeAny>(),
): boolean {
  const field = unwrapZodField(schema);
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return false;
    }
  }
  if (field.schema?._def?.typeName === 'ZodPipeline') {
    const nextVisited = new Set(visited);
    for (const s of field.traversed) {
      nextVisited.add(s);
    }
    const def = field.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
    if (somePipelineLeaf(def['in'], predicate, nextVisited)) {
      return true;
    }
    const inField = unwrapZodField(def['in']);
    if (!inField.hasTransform || canSchemaHoldObjectOrArray(def['in'])) {
      return somePipelineLeaf(def['out'], predicate, nextVisited);
    }
    return false;
  }
  return predicate(field.schema);
}

function isSingleChildField(prop: z.ZodTypeAny, options?: ChildRefAnalysisOptions): boolean {
  if (hasChildRefKind(prop, 'component-id')) return true;
  const refDef = getRefDefName(prop);
  return (
    refDef === 'ComponentId' ||
    refDef === 'Child' ||
    Boolean(refDef && options?.childRefNames?.has(refDef))
  );
}

function isCheckableField(type: z.ZodTypeAny, unwrapped?: UnwrappedZodField): boolean {
  const defName = unwrapped?.firstRefDefName || getRefDefName(type);
  if (defName === 'Checkable' || defName === 'CheckRule') {
    return true;
  }

  return somePipelineLeaf(type, leaf => {
    if (leaf?._def?.typeName === 'ZodArray') {
      return getRefDefName(leaf._def.type as z.ZodTypeAny) === 'CheckRule';
    }
    return false;
  });
}

function isActionOption(option: z.ZodTypeAny): boolean {
  if (getRefDefName(option) === 'Action') return true;
  return somePipelineLeaf(option, current => {
    if (current?._def?.typeName !== 'ZodObject') return false;
    const shape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    const keys = Object.keys(shape);
    return keys.length === 1 && (keys[0] === 'event' || keys[0] === 'functionCall');
  });
}

function isDynamicOption(option: z.ZodTypeAny, options?: ChildRefAnalysisOptions): boolean {
  const refDef = getRefDefName(option);
  if (refDef === 'DataBinding' || refDef === 'FunctionCall' || refDef.startsWith('Dynamic')) {
    return true;
  }
  return somePipelineLeaf(option, current => {
    if (current?._def?.typeName !== 'ZodObject') return false;
    const shape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    const hasComponentId =
      isTemplateRefObject(current) ||
      Object.values(shape).some(prop => isSingleChildField(prop, options));
    return (
      (Object.hasOwn(shape, '@path') ||
        Object.hasOwn(shape, 'path') ||
        Object.hasOwn(shape, '@call') ||
        Object.hasOwn(shape, 'call')) &&
      !hasComponentId
    );
  });
}

function isChildListOption(option: z.ZodTypeAny, options?: ChildRefAnalysisOptions): boolean {
  const refDef = getRefDefName(option);
  if (
    hasChildRefKind(option, 'child-list') ||
    refDef === 'ChildList' ||
    Boolean(refDef && options?.childListRefNames?.has(refDef))
  ) {
    return true;
  }
  return somePipelineLeaf(option, current => isTemplateRefObject(current));
}

function isArrayOption(option: z.ZodTypeAny): boolean {
  return somePipelineLeaf(option, current => current?._def?.typeName === 'ZodArray');
}

function hasSingleChildObjectField(
  option: z.ZodTypeAny,
  options?: ChildRefAnalysisOptions,
): boolean {
  return somePipelineLeaf(option, current => {
    if (current?._def?.typeName !== 'ZodObject') return false;
    const shape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    return Object.values(shape).some(prop => isSingleChildField(prop, options));
  });
}

function isDynamicDef(defName: string, typeName?: string): boolean {
  if (defName === 'DataBinding' || defName === 'FunctionCall') {
    return true;
  }
  return defName.startsWith('Dynamic') && typeName !== 'ZodObject' && typeName !== 'ZodArray';
}

function isBooleanOrNullishOption(option: z.ZodTypeAny): boolean {
  return somePipelineLeaf(option, leaf => {
    const typeName = leaf?._def?.typeName as string | undefined;
    return typeName === 'ZodBoolean' || typeName === 'ZodNull' || typeName === 'ZodUndefined';
  });
}

function flattenUnionOptions(
  unionOptions: readonly z.ZodTypeAny[],
  visited = new Set<z.ZodTypeAny>(),
): z.ZodTypeAny[] {
  const result: z.ZodTypeAny[] = [];
  for (const opt of unionOptions) {
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
    const nextVisited = new Set(visited);
    for (const s of unwrapped.traversed) {
      nextVisited.add(s);
    }
    if (!unwrapped.firstRefDefName && unwrapped.refs.size === 0) {
      const nested = getUnionOptions(unwrapped.schema);
      if (nested) {
        result.push(...flattenUnionOptions(nested, nextVisited));
        continue;
      }
      if (unwrapped.schema?._def?.typeName === 'ZodPipeline') {
        const def = unwrapped.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
        const inField = unwrapZodField(def['in']);
        const inTypeName = inField.schema?._def?.typeName as string | undefined;
        if (!inField.hasTransform && (inTypeName === 'ZodAny' || inTypeName === 'ZodUnknown')) {
          result.push(...flattenUnionOptions([def['out']], nextVisited));
          continue;
        }
      }
    }
    result.push(opt);
  }
  return result;
}

function hasBooleanLeaf(option: z.ZodTypeAny): boolean {
  return somePipelineLeaf(
    option,
    leaf => (leaf?._def?.typeName as string | undefined) === 'ZodBoolean',
  );
}

function matchUnionBehavior(
  unionOptions: z.ZodTypeAny[],
  options?: ChildRefAnalysisOptions,
): ModelBehaviorNode | undefined {
  const flatOptions = flattenUnionOptions(unionOptions);
  if (flatOptions.some(isActionOption)) return {type: 'ACTION'};
  if (flatOptions.some(opt => isDynamicOption(opt, options))) {
    const dynamicOptions = flatOptions.filter(opt => isDynamicOption(opt, options));
    const literalOptions = flatOptions.filter(opt => !isDynamicOption(opt, options));
    const hasNonBooleanDynamic = dynamicOptions.some(opt => {
      const refDef = getRefDefName(opt);
      return refDef.startsWith('Dynamic') && refDef !== 'DynamicBoolean';
    });
    const hasBooleanSource =
      dynamicOptions.some(
        opt => getRefDefName(opt) === 'DynamicBoolean' || isDynamicBooleanSchema(opt),
      ) || literalOptions.some(hasBooleanLeaf);
    const isBoolean =
      !hasNonBooleanDynamic && hasBooleanSource && literalOptions.every(isBooleanOrNullishOption);
    return isBoolean ? {type: 'DYNAMIC', isBoolean: true} : {type: 'DYNAMIC'};
  }
  if (
    flatOptions.some(opt => isChildListOption(opt, options)) ||
    (flatOptions.some(isArrayOption) &&
      flatOptions.some(opt => hasSingleChildObjectField(opt, options)))
  ) {
    return {type: 'STRUCTURAL'};
  }
  return undefined;
}

function mergePropertyWithCatchall(
  explicitVal: ModelBehaviorNode,
  catchallVal: ModelBehaviorNode,
): ModelBehaviorNode {
  if (explicitVal === CHILD_REF_STATIC_NODE) {
    return CHILD_REF_STATIC_NODE;
  }
  if (explicitVal.type === 'STATIC') {
    return catchallVal;
  }
  if (
    explicitVal.type === 'OBJECT' ||
    explicitVal.type === 'ARRAY' ||
    explicitVal.type === 'DYNAMIC'
  ) {
    return mergeIntersectedBehaviors(explicitVal, catchallVal);
  }
  return explicitVal;
}

const BEHAVIOR_PRECEDENCE: Record<ModelBehaviorNode['type'], number> = {
  ACTION: 5,
  CHECKABLE: 4,
  STRUCTURAL: 3,
  ARRAY: 2,
  OBJECT: 2,
  DYNAMIC: 1,
  STATIC: 0,
};

function mergeIntersectedBehaviors(
  left: ModelBehaviorNode,
  right: ModelBehaviorNode,
): ModelBehaviorNode {
  if (left.type === 'STATIC' && right.type === 'STATIC') {
    return left === CHILD_REF_STATIC_NODE || right === CHILD_REF_STATIC_NODE
      ? CHILD_REF_STATIC_NODE
      : {type: 'STATIC'};
  }
  if (left.type === 'STATIC') return right;
  if (right.type === 'STATIC') return left;
  if (left.type === 'OBJECT' && right.type === 'OBJECT') {
    const allKeys = new Set<string>([...Object.keys(left.shape), ...Object.keys(right.shape)]);
    const shape: Record<string, ModelBehaviorNode> = {};
    for (const key of allKeys) {
      const hasLeft = Object.hasOwn(left.shape, key);
      const hasRight = Object.hasOwn(right.shape, key);
      let merged: ModelBehaviorNode | undefined;
      if (hasLeft && hasRight) {
        merged = mergeIntersectedBehaviors(left.shape[key], right.shape[key]);
      } else if (hasLeft) {
        merged = right.catchall
          ? mergePropertyWithCatchall(left.shape[key], right.catchall)
          : left.shape[key];
      } else if (hasRight) {
        merged = left.catchall
          ? mergePropertyWithCatchall(right.shape[key], left.catchall)
          : right.shape[key];
      }
      if (merged !== undefined) {
        shape[key] = merged;
      }
    }
    const catchall =
      left.catchall && right.catchall
        ? mergeIntersectedBehaviors(left.catchall, right.catchall)
        : (left.catchall ?? right.catchall);
    return makeObjectBehavior(shape, catchall);
  }
  if (left.type === 'ARRAY' && right.type === 'ARRAY') {
    const element = mergeIntersectedBehaviors(left.element, right.element);
    return left.templateFallback && right.templateFallback
      ? {type: 'ARRAY', element, templateFallback: true}
      : {type: 'ARRAY', element};
  }
  if (left.type === 'DYNAMIC' && right.type === 'DYNAMIC') {
    return left.isBoolean || right.isBoolean
      ? {type: 'DYNAMIC', isBoolean: true}
      : {type: 'DYNAMIC'};
  }
  if (!hasActiveBehavior(left) && hasActiveBehavior(right)) {
    return right;
  }
  if (!hasActiveBehavior(right) && hasActiveBehavior(left)) {
    return left;
  }
  return BEHAVIOR_PRECEDENCE[right.type] > BEHAVIOR_PRECEDENCE[left.type] ? right : left;
}

function mergeUnionPropertyBehaviors(
  left: ModelBehaviorNode,
  right: ModelBehaviorNode,
): ModelBehaviorNode {
  if (left.type === right.type) {
    if (left.type === 'OBJECT' && right.type === 'OBJECT') {
      return mergeUnionObjectBehaviors([left, right]);
    }
    if (left.type === 'ARRAY' && right.type === 'ARRAY') {
      const element = mergeUnionPropertyBehaviors(left.element, right.element);
      return left.templateFallback || right.templateFallback
        ? {type: 'ARRAY', element, templateFallback: true}
        : {type: 'ARRAY', element};
    }
    if (left.type === 'DYNAMIC' && right.type === 'DYNAMIC') {
      return left.isBoolean && right.isBoolean
        ? {type: 'DYNAMIC', isBoolean: true}
        : {type: 'DYNAMIC'};
    }
    return left === CHILD_REF_STATIC_NODE || right === CHILD_REF_STATIC_NODE
      ? CHILD_REF_STATIC_NODE
      : left;
  }
  if (left.type === 'STRUCTURAL' && right.type === 'ARRAY') {
    return hasActiveBehavior(right.element)
      ? {type: 'ARRAY', element: right.element, templateFallback: true}
      : {type: 'STRUCTURAL'};
  }
  if (left.type === 'ARRAY' && right.type === 'STRUCTURAL') {
    return hasActiveBehavior(left.element)
      ? {type: 'ARRAY', element: left.element, templateFallback: true}
      : {type: 'STRUCTURAL'};
  }
  if (left.type === 'STATIC') {
    return right.type === 'DYNAMIC' ? {type: 'DYNAMIC'} : right;
  }
  if (right.type === 'STATIC') {
    return left.type === 'DYNAMIC' ? {type: 'DYNAMIC'} : left;
  }
  return {type: 'STATIC'};
}

function mergeUnionObjectBehaviors(objects: ObjectBehaviorNode[]): ObjectBehaviorNode {
  const allKeys = new Set<string>();
  for (const obj of objects) {
    for (const key of Object.keys(obj.shape)) {
      allKeys.add(key);
    }
  }
  const mergedShape: Record<string, ModelBehaviorNode> = {};
  for (const key of allKeys) {
    let acc: ModelBehaviorNode | undefined;
    let hasChildRef = false;
    for (const obj of objects) {
      if (Object.hasOwn(obj.shape, key)) {
        const candidate = obj.shape[key];
        if (candidate === CHILD_REF_STATIC_NODE) {
          hasChildRef = true;
        }
        acc = acc === undefined ? candidate : mergeUnionPropertyBehaviors(acc, candidate);
      }
    }
    if (acc !== undefined) {
      mergedShape[key] = acc.type === 'STATIC' && hasChildRef ? CHILD_REF_STATIC_NODE : acc;
    }
  }
  let mergedCatchall: ModelBehaviorNode | undefined;
  if (objects.some(obj => obj.catchall !== undefined)) {
    for (const obj of objects) {
      const candidate = obj.catchall ?? {type: 'STATIC'};
      mergedCatchall =
        mergedCatchall === undefined
          ? candidate
          : mergeUnionPropertyBehaviors(mergedCatchall, candidate);
    }
  }
  return makeObjectBehavior(mergedShape, mergedCatchall);
}

function canObjectSchemaPassKey(
  schema: z.ZodTypeAny | undefined,
  key: string,
  visited = new Set<z.ZodTypeAny>(),
): boolean {
  if (!schema) {
    return true;
  }
  const unwrapped = unwrapZodField(schema);
  for (const s of unwrapped.traversed) {
    if (visited.has(s)) {
      return true;
    }
  }
  const nextVisited = new Set(visited);
  for (const s of unwrapped.traversed) {
    nextVisited.add(s);
  }
  const current = unwrapped.schema;
  const typeName = current?._def?.typeName as string | undefined;
  switch (typeName) {
    case 'ZodObject': {
      const shape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
      if (Object.hasOwn(shape, key)) {
        return true;
      }
      const def = current._def as {unknownKeys?: string; catchall?: z.ZodTypeAny};
      if (def['unknownKeys'] === 'passthrough') {
        return true;
      }
      return Boolean(def['catchall'] && def['catchall']._def?.typeName !== 'ZodNever');
    }
    case 'ZodIntersection': {
      const def = current._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      return (
        canObjectSchemaPassKey(def.left, key, nextVisited) &&
        canObjectSchemaPassKey(def.right, key, nextVisited)
      );
    }
    case 'ZodPipeline': {
      const def = current._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
      const inField = unwrapZodField(def['in']);
      if (inField.hasTransform) {
        const inIsObject = (inField.schema?._def?.typeName as string | undefined) === 'ZodObject';
        return (
          (!inIsObject || canObjectSchemaPassKey(def['in'], key, nextVisited)) &&
          canObjectSchemaPassKey(def['out'], key, nextVisited)
        );
      }
      return (
        canObjectSchemaPassKey(def['in'], key, nextVisited) &&
        canObjectSchemaPassKey(def['out'], key, nextVisited)
      );
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const opts = getUnionOptions(current) ?? [];
      return opts.some(opt => canObjectSchemaPassKey(opt, key, nextVisited));
    }
    default:
      return true;
  }
}

function allowsUnknownObjectKeys(
  schema: z.ZodTypeAny | undefined,
  visited = new Set<z.ZodTypeAny>(),
): boolean {
  return canObjectSchemaPassKey(schema, '__a2ui_unknown_key_probe__', visited);
}

function getArrayElementSchema(schema: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined {
  if (!schema) {
    return undefined;
  }
  const current = unwrapZodField(schema).schema;
  return (current?._def?.typeName as string | undefined) === 'ZodArray'
    ? (current._def.type as z.ZodTypeAny)
    : undefined;
}

function filterPipedBehavior(
  behavior: ModelBehaviorNode,
  inSchema: z.ZodTypeAny | undefined,
  outSchema: z.ZodTypeAny | undefined,
  visited: Set<z.ZodTypeAny>,
  ignoreInConstraints = false,
): ModelBehaviorNode {
  if (behavior.type === 'OBJECT') {
    const shape: Record<string, ModelBehaviorNode> = {};
    for (const [key, propBehavior] of Object.entries(behavior.shape)) {
      if (
        (ignoreInConstraints || canObjectSchemaPassKey(inSchema, key, visited)) &&
        canObjectSchemaPassKey(outSchema, key, visited)
      ) {
        shape[key] = propBehavior;
      }
    }
    const catchall =
      behavior.catchall &&
      (ignoreInConstraints || allowsUnknownObjectKeys(inSchema, visited)) &&
      allowsUnknownObjectKeys(outSchema, visited)
        ? behavior.catchall
        : undefined;
    return makeObjectBehavior(shape, catchall);
  }
  if (behavior.type === 'ARRAY') {
    const element = filterPipedBehavior(
      behavior.element,
      getArrayElementSchema(inSchema),
      getArrayElementSchema(outSchema),
      visited,
      ignoreInConstraints,
    );
    return behavior.templateFallback
      ? {type: 'ARRAY', element, templateFallback: true}
      : {type: 'ARRAY', element};
  }
  return behavior;
}

function pipeBehaviors(
  inSchema: z.ZodTypeAny,
  outSchema: z.ZodTypeAny,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): ModelBehaviorNode {
  const inField = unwrapZodField(inSchema);
  const inBehavior = getFieldBehavior(inSchema, visited, options);
  const outBehavior = getFieldBehavior(outSchema, visited, options);
  if (inField.hasTransform) {
    if (!canSchemaHoldObjectOrArray(inSchema) && !hasActiveBehavior(inBehavior)) {
      return inBehavior;
    }
    const combined =
      inBehavior.type === 'OBJECT' || inBehavior.type === 'ARRAY' || !hasActiveBehavior(inBehavior)
        ? mergeIntersectedBehaviors(inBehavior, outBehavior)
        : inBehavior;
    return filterPipedBehavior(combined, inSchema, outSchema, visited, true);
  }
  return filterPipedBehavior(
    mergeIntersectedBehaviors(inBehavior, outBehavior),
    inSchema,
    outSchema,
    visited,
  );
}

function matchObjectVariantUnionBehavior(
  unionOptions: z.ZodTypeAny[],
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): ModelBehaviorNode {
  const nonNullish = flattenUnionOptions(unionOptions).filter(opt => {
    const typeName = unwrapZodField(opt).schema?._def?.typeName as string | undefined;
    return typeName !== 'ZodNull' && typeName !== 'ZodUndefined';
  });
  if (nonNullish.length === 0) {
    return {type: 'STATIC'};
  }
  const branchBehaviors = nonNullish.map(opt => getFieldBehavior(opt, visited, options));
  if (branchBehaviors.every((b): b is ObjectBehaviorNode => b.type === 'OBJECT')) {
    return mergeUnionObjectBehaviors(branchBehaviors);
  }
  const arrayBehaviors = branchBehaviors.filter(
    (b): b is Extract<ModelBehaviorNode, {type: 'ARRAY'}> => b.type === 'ARRAY',
  );
  if (
    arrayBehaviors.length > 0 &&
    branchBehaviors.every(b => b.type === 'ARRAY' || b.type === 'STATIC')
  ) {
    const merged = arrayBehaviors
      .slice(1)
      .reduce<ModelBehaviorNode>(
        (acc, cur) => mergeUnionPropertyBehaviors(acc, cur),
        arrayBehaviors[0],
      );
    return hasActiveBehavior(merged) ? merged : {type: 'STATIC'};
  }
  return {type: 'STATIC'};
}

function scrapeObjectShape(
  objShape: Record<string, z.ZodTypeAny>,
  visited: Set<z.ZodTypeAny>,
  options?: ChildRefAnalysisOptions,
): Record<string, ModelBehaviorNode> {
  const shape: Record<string, ModelBehaviorNode> = {};
  for (const [key, value] of Object.entries(objShape)) {
    const behavior = getFieldBehavior(value, visited, options);
    shape[key] =
      behavior.type === 'STATIC' && isSingleChildPropertySchema(key, value, options)
        ? CHILD_REF_STATIC_NODE
        : behavior;
  }
  return shape;
}

function getFieldBehavior(
  type: z.ZodTypeAny | undefined,
  visited = new Set<z.ZodTypeAny>(),
  options?: ChildRefAnalysisOptions,
  inArray = false,
): ModelBehaviorNode {
  if (!type) {
    return {type: 'STATIC'};
  }
  const field = unwrapZodField(type);
  for (const s of field.traversed) {
    if (visited.has(s)) {
      return {type: 'STATIC'};
    }
  }
  const nextVisited = new Set(visited);
  for (const s of field.traversed) {
    nextVisited.add(s);
  }

  const defName = field.firstRefDefName || getRefDefName(type);

  if (isCheckableField(type, field)) {
    return {type: 'CHECKABLE'};
  }

  if (defName === 'Action') {
    return {type: 'ACTION'};
  }

  const current = field.schema;
  if (!current?._def) {
    return {type: 'STATIC'};
  }

  const unionOptions = getUnionOptions(current);
  const marksOuterChildList =
    (field.refs.has('child-list') ||
      hasChildRefKind(type, 'child-list') ||
      defName === 'ChildList' ||
      Boolean(defName && options?.childListRefNames?.has(defName))) &&
    canSchemaHoldListRef(type, options);

  if (!unionOptions && marksOuterChildList) {
    return {type: 'STRUCTURAL'};
  }

  const typeName = current._def.typeName as string;

  if (isDynamicDef(defName, typeName)) {
    return isDynamicBooleanSchema(type) || defName === 'DynamicBoolean'
      ? {type: 'DYNAMIC', isBoolean: true}
      : {type: 'DYNAMIC'};
  }

  if (typeName === 'ZodPipeline') {
    const def = current._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
    const merged = pipeBehaviors(def['in'], def['out'], nextVisited, options);
    return merged.type === 'STRUCTURAL' && !canSchemaHoldListRef(current, options)
      ? {type: 'STATIC'}
      : merged;
  }

  if (typeName === 'ZodIntersection') {
    const def = current._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
    const merged = mergeIntersectedBehaviors(
      getFieldBehavior(def.left, nextVisited, options, inArray),
      getFieldBehavior(def.right, nextVisited, options, inArray),
    );
    return merged.type === 'STRUCTURAL' && !canSchemaHoldListRef(current, options)
      ? {type: 'STATIC'}
      : merged;
  }

  if (unionOptions) {
    const unionBehavior =
      matchUnionBehavior(unionOptions, options) ??
      (marksOuterChildList ? ({type: 'STRUCTURAL'} as const) : undefined);
    if (unionBehavior) {
      if (unionBehavior.type === 'STRUCTURAL') {
        const flatOptions = flattenUnionOptions(unionOptions);
        let mergedElement: ModelBehaviorNode | undefined;
        for (const opt of flatOptions) {
          if (!isChildListOption(opt, options) && isArrayOption(opt)) {
            const branchBehavior = getFieldBehavior(opt, nextVisited, options);
            if (branchBehavior.type === 'ARRAY') {
              mergedElement =
                mergedElement === undefined
                  ? branchBehavior.element
                  : mergeUnionPropertyBehaviors(mergedElement, branchBehavior.element);
            }
          }
        }
        if (mergedElement && hasActiveBehavior(mergedElement)) {
          return {type: 'ARRAY', element: mergedElement, templateFallback: true};
        }
      }
      return unionBehavior;
    }
    return matchObjectVariantUnionBehavior(unionOptions, nextVisited, options);
  }

  if (typeName === 'ZodArray') {
    return {
      type: 'ARRAY',
      element: getFieldBehavior(current._def.type as z.ZodTypeAny, nextVisited, options, true),
    };
  }

  if (typeName === 'ZodRecord') {
    const valueType = (current._def as {valueType?: z.ZodTypeAny})['valueType'];
    return makeObjectBehavior(
      {},
      valueType ? getFieldBehavior(valueType, nextVisited, options) : undefined,
    );
  }

  if (typeName === 'ZodObject') {
    if (!inArray && isTemplateRefObject(current)) {
      return {type: 'STRUCTURAL'};
    }
    const rawShape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    const rawCatchall = (current._def as {catchall?: z.ZodTypeAny})['catchall'];
    const catchall =
      rawCatchall && (rawCatchall._def?.typeName as string | undefined) !== 'ZodNever'
        ? getFieldBehavior(rawCatchall, nextVisited, options)
        : undefined;
    return makeObjectBehavior(scrapeObjectShape(rawShape, nextVisited, options), catchall);
  }

  return {type: 'STATIC'};
}
