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

import type {z} from 'zod';

import {componentMixinLayout} from '../catalog/component_envelope.js';
import {coerceDynamicBoolean} from '../catalog/validation_result_coercion.js';
import {ActionDispatchOptions} from '../common/metadata.js';
import {isAtLeastVersion} from '../common/semver.js';
import {findFailedArgument, isThenable, settleDeep} from '../common/settle_deep.js';
import {effect, getValue, peekValue} from '../reactivity/signals.js';
import type {SchemaCursor, SchemaDoc} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';
import {toSchemaDoc} from '../schema-engine/zod-bridge.js';
import {Action, CheckRule, ChildList, DataBinding, FunctionCall} from '../types/common-types.js';
import {V08_CHILD_REF_OPTIONS} from '../v0_8/standard_defs.js';
import {V09_CHILD_REF_OPTIONS} from '../v0_9/standard_defs.js';
import type {Action as V1Action, CheckRule as V1CheckRule} from '../v1_0/schema/common-types.js';
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import {V10_CHILD_REF_OPTIONS} from '../v1_0/standard_defs.js';
import {ComponentContext} from './component-context.js';
import {MAX_DYNAMIC_VALUE_DEPTH} from './data-context.js';
import {resolveSignalKeepingPending} from './data-context-internal.js';
import {
  type ChildRefAnalysisOptions,
  type UnwrappedSchemaField,
  canSchemaHoldListRef,
  extractRefFields,
  isSingleChildPropertySchema,
  schemaDiscovery,
} from './ref-fields.js';

/** The outcome of one check rule. */
interface CheckRuleResult {
  valid: boolean;
  message: string;
  code?: string;
  severity: 'error' | 'warning' | 'info';
}

// --- Schema Scraping ---

/**
 * Represents the intended runtime behavior of a property parsed from its JSON
 * Schema.
 *
 * - DYNAMIC: The property can be bound to the DataModel (e.g. DynamicString).
 *   The Binder will automatically subscribe to data changes and emit primitive
 *   values.
 * - ACTION: The property represents a user interaction (e.g. Action). The
 *   Binder will resolve deep payload bindings and output a ready-to-call () =>
 *   void closure.
 * - STRUCTURAL: The property dictates the rendering of child components (e.g.
 *   ChildList). The Binder outputs lists of objects containing { id, basePath }
 *   for structural layout.
 * - CHECKABLE: Special property for handling validation arrays (e.g. checks).
 *   The Binder will reactively evaluate the rules and inject isValid and
 *   validationErrors booleans into the parent object.
 * - STATIC: A primitive value that requires no reactive subscription or
 *   resolution.
 * - OBJECT / ARRAY: Recursive traversal nodes for complex nested schemas.
 */
export type BehaviorNode =
  | {type: 'DYNAMIC'; isBoolean?: boolean}
  | {type: 'ACTION'}
  | {type: 'STRUCTURAL'}
  | {type: 'CHECKABLE'}
  | {type: 'STATIC'}
  | {type: 'OBJECT'; shape: Record<string, BehaviorNode>; catchall?: BehaviorNode}
  | {type: 'ARRAY'; element: BehaviorNode; templateFallback?: boolean};

type ObjectBehaviorNode = Extract<BehaviorNode, {type: 'OBJECT'}>;

type Field = UnwrappedSchemaField;

const {
  unwrap,
  kindOf,
  unionOptions: fieldUnionOptions,
  intersectionSides,
  arrayElement,
  isTemplateRef,
} = schemaDiscovery;

type Obj = {[k: string]: unknown};

const isObj = (n: unknown): n is Obj => typeof n === 'object' && n !== null && !Array.isArray(n);

/**
 * Sentinel `STATIC` node for single-child component reference slots so composite
 * object merges with a dynamic `catchall` keep child IDs `STATIC` without
 * changing the external `{type: 'STATIC'}` node shape.
 */
const CHILD_REF_STATIC_NODE: BehaviorNode = Object.freeze({type: 'STATIC' as const});

function hasActiveBehavior(node: BehaviorNode): boolean {
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
type BehaviorCache = WeakMap<object, WeakMap<object, WeakMap<object, BehaviorNode>>>;
const behaviorCache: BehaviorCache = new WeakMap();
const componentBehaviorCache: BehaviorCache = new WeakMap();

/** The cache for `node` in `doc` under `options`, or undefined if `node` is a boolean schema. */
function nodeBehaviorCache(
  store: BehaviorCache,
  node: JsonSchema,
  doc: SchemaDoc,
  options?: ChildRefAnalysisOptions,
): WeakMap<object, BehaviorNode> | undefined {
  if (!isObj(node) || !isObj(doc.root)) return undefined;
  const key = options ?? DEFAULT_OPTIONS_CACHE_KEY;
  let byRoot = store.get(key);
  if (!byRoot) {
    byRoot = new WeakMap();
    store.set(key, byRoot);
  }
  let map = byRoot.get(doc.root);
  if (!map) {
    map = new WeakMap();
    byRoot.set(doc.root, map);
  }
  return map;
}

function makeObjectBehavior(
  shape: Record<string, BehaviorNode>,
  catchall?: BehaviorNode,
): ObjectBehaviorNode {
  return catchall && catchall.type !== 'STATIC'
    ? {type: 'OBJECT', shape, catchall}
    : {type: 'OBJECT', shape};
}

function resolveChildRefOptions(
  protocolVersion: string | undefined,
): ChildRefAnalysisOptions | undefined {
  if (!protocolVersion) {
    return undefined;
  }
  if (isAtLeastVersion(protocolVersion, '1.0')) {
    return V10_CHILD_REF_OPTIONS;
  }
  if (isAtLeastVersion(protocolVersion, '0.9')) {
    return V09_CHILD_REF_OPTIONS;
  }
  return V08_CHILD_REF_OPTIONS;
}

/** The common `AccessibilityAttributes` definition every component accepts. */
const ACCESSIBILITY_ATTRIBUTES: SchemaCursor = {
  node: {$ref: 'common_types.json#/$defs/AccessibilityAttributes'},
  doc: {root: {}, defs: {'common_types.json': V10CommonTypes as JsonSchema}},
};

function augmentRootObjectShape(
  {node, doc}: SchemaCursor,
  baseShape: Record<string, BehaviorNode>,
  options?: ChildRefAnalysisOptions,
): Record<string, BehaviorNode> {
  const nextShape: Record<string, BehaviorNode> = {...baseShape};
  for (const [key, refKind] of extractRefFields(node, doc, options)) {
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
  const accessibility = getFieldBehavior(ACCESSIBILITY_ATTRIBUTES, new Set(), options);
  if (!Object.hasOwn(nextShape, 'accessibility')) {
    nextShape.accessibility = accessibility;
  }
  if (!Object.hasOwn(nextShape, AT_ACCESSIBILITY)) {
    nextShape[AT_ACCESSIBILITY] = accessibility;
  }
  if (!Object.hasOwn(nextShape, AT_CHECKS)) {
    nextShape[AT_CHECKS] = {type: 'CHECKABLE'};
  }
  return nextShape;
}

/** Key under which a v1.0 component stores its accessibility attributes. */
const AT_ACCESSIBILITY = '@accessibility';
/** Key under which a v1.0 component stores its check rules. */
const AT_CHECKS = '@checks';

/**
 * Traverses a JSON Schema to build a `BehaviorNode` map.
 *
 * Enables GenericBinder to determine how to handle raw JSON properties
 * without hardcoding logic for specific component types.
 *
 * @param node JSON Schema node to inspect.
 * @param doc The document that owns `node`.
 * @param options Optional child-reference analysis options forwarded to ref extraction.
 * @returns Root BehaviorNode describing schema properties.
 */
export function scrapeSchemaBehavior(
  node: JsonSchema,
  doc: SchemaDoc,
  options?: ChildRefAnalysisOptions,
): BehaviorNode {
  const cache = nodeBehaviorCache(behaviorCache, node, doc, options);
  const cached = cache?.get(node as object);
  if (cached) {
    return cached;
  }
  const behavior = getFieldBehavior({node, doc}, new Set(), options);
  const result: BehaviorNode =
    behavior.type === 'OBJECT'
      ? makeObjectBehavior(
          augmentRootObjectShape({node, doc}, behavior.shape, options),
          behavior.catchall,
        )
      : behavior;
  cache?.set(node as object, result);
  return result;
}

/**
 * Builds the root object `BehaviorNode` for a component's property map,
 * normalizing open non-object component schemas (`{}`, or an object with only
 * `additionalProperties`) into `{ type: 'OBJECT', shape }` with structural
 * child-list and `accessibility` behaviors attached.
 *
 * @param node The component's JSON Schema.
 * @param doc The document that owns `node`.
 * @param options Optional child-reference analysis options.
 */
export function scrapeComponentBehavior(
  node: JsonSchema,
  doc: SchemaDoc,
  options?: ChildRefAnalysisOptions,
): BehaviorNode {
  const cache = nodeBehaviorCache(componentBehaviorCache, node, doc, options);
  const cached = cache?.get(node as object);
  if (cached) {
    return cached;
  }
  const scraped = scrapeSchemaBehavior(node, doc, options);
  const result: BehaviorNode =
    scraped.type === 'OBJECT'
      ? scraped
      : makeObjectBehavior(augmentRootObjectShape({node, doc}, {}, options));
  cache?.set(node as object, result);
  return result;
}

/**
 * The definition name a field names: the first `REF:` pointer or `$ref` into
 * another document, else the first `$ref` within its own document.
 */
function defNameOf(field: Field): string {
  for (const name of field.refDefNames) return name;
  for (const name of field.localDefNames) return name;
  return '';
}

function namesDef(field: Field, name: string): boolean {
  return field.refDefNames.has(name) || field.localDefNames.has(name);
}

/** The single JSON type of a plain (non-`enum`, non-`const`) node, if any. */
function leafType(node: JsonSchema): string | undefined {
  if (!isObj(node) || 'enum' in node || 'const' in node) return undefined;
  const t = node['type'];
  return typeof t === 'string' ? t : undefined;
}

/** The declared properties of an object field, each paired with its owner document. */
function ownProperties(field: Field): Record<string, SchemaCursor> {
  const props = isObj(field.node) ? field.node['properties'] : undefined;
  const result: Record<string, SchemaCursor> = {};
  if (isObj(props)) {
    for (const [key, value] of Object.entries(props)) {
      result[key] = {node: value as JsonSchema, doc: field.doc};
    }
  }
  return result;
}

function alreadyVisited(field: Field, visited: Set<object>): boolean {
  for (const s of field.traversed) {
    if (visited.has(s)) return true;
  }
  return false;
}

function withTraversed(visited: Set<object>, field: Field): Set<object> {
  const next = new Set(visited);
  for (const s of field.traversed) next.add(s);
  return next;
}

/**
 * Whether `field`, or for an `allOf` any of its members, satisfies `predicate`.
 * A value an intersection accepts satisfies each member, so a member's shape
 * (an array, a boolean, an action object) is the value's shape.
 */
function someLeaf(
  field: Field,
  predicate: (leaf: Field) => boolean,
  visited = new Set<object>(),
): boolean {
  if (alreadyVisited(field, visited)) return false;
  if (kindOf(field.node) !== 'intersection') return predicate(field);
  const next = withTraversed(visited, field);
  return intersectionSides(field).some(side => someLeaf(unwrap(side), predicate, next));
}

function isSingleChildField(prop: SchemaCursor, options?: ChildRefAnalysisOptions): boolean {
  const field = unwrap(prop);
  if (field.refs.has('component-id')) return true;
  const refDef = defNameOf(field);
  return (
    refDef === 'ComponentId' ||
    refDef === 'Child' ||
    Boolean(refDef && options?.childRefNames?.has(refDef))
  );
}

/**
 * Checks whether a field represents a checkable validation rule or list of rules.
 */
function isCheckableField(field: Field): boolean {
  const defName = defNameOf(field);
  // An object named `Checkable` is the mixin a component composes with
  // `allOf`: its `@checks` list is checkable, not the whole component.
  if ((defName === 'Checkable' || defName === 'CheckRule') && kindOf(field.node) !== 'object') {
    return true;
  }
  return someLeaf(
    field,
    leaf => kindOf(leaf.node) === 'array' && defNameOf(unwrap(arrayElement(leaf))) === 'CheckRule',
  );
}

function isActionOption(field: Field): boolean {
  if (defNameOf(field) === 'Action') return true;
  return someLeaf(field, leaf => {
    if (kindOf(leaf.node) !== 'object') return false;
    // Like each branch of the spec's `Action`, an inline action object has
    // `event` or `functionCall` as its only key.
    const keys = Object.keys(ownProperties(leaf));
    return keys.length === 1 && (keys[0] === 'event' || keys[0] === 'functionCall');
  });
}

function isDynamicDefName(defName: string): boolean {
  return defName === 'DataBinding' || defName === 'FunctionCall' || defName.startsWith('Dynamic');
}

function isDynamicOption(field: Field, options?: ChildRefAnalysisOptions): boolean {
  if (isDynamicDefName(defNameOf(field))) return true;
  return someLeaf(field, leaf => {
    if (kindOf(leaf.node) !== 'object') return false;
    const shape = ownProperties(leaf);
    const hasComponentId =
      isTemplateRef(leaf) || Object.values(shape).some(prop => isSingleChildField(prop, options));
    return (
      (Object.hasOwn(shape, '@path') ||
        Object.hasOwn(shape, 'path') ||
        Object.hasOwn(shape, '@call') ||
        Object.hasOwn(shape, 'call')) &&
      !hasComponentId
    );
  });
}

function isChildListOption(field: Field, options?: ChildRefAnalysisOptions): boolean {
  const refDef = defNameOf(field);
  return (
    field.refs.has('child-list') ||
    refDef === 'ChildList' ||
    Boolean(refDef && options?.childListRefNames?.has(refDef)) ||
    someLeaf(field, isTemplateRef)
  );
}

function isArrayOption(field: Field): boolean {
  return someLeaf(field, leaf => kindOf(leaf.node) === 'array');
}

function hasSingleChildObjectField(field: Field, options?: ChildRefAnalysisOptions): boolean {
  return someLeaf(
    field,
    leaf =>
      kindOf(leaf.node) === 'object' &&
      Object.values(ownProperties(leaf)).some(prop => isSingleChildField(prop, options)),
  );
}

function isNullishField(field: Field): boolean {
  return leafType(field.node) === 'null' || kindOf(field.node) === 'never';
}

function isBooleanOrNullishOption(field: Field): boolean {
  return someLeaf(field, leaf => leafType(leaf.node) === 'boolean' || isNullishField(leaf));
}

function hasBooleanLeaf(field: Field): boolean {
  return someLeaf(field, leaf => leafType(leaf.node) === 'boolean');
}

/** A union option with its unwrapped field. */
interface UnionOption {
  cursor: SchemaCursor;
  field: Field;
}

/** Flattens nested unions that name no definition into one list of options. */
function flattenUnionOptions(
  unionOptions: readonly SchemaCursor[],
  visited = new Set<object>(),
): UnionOption[] {
  const result: UnionOption[] = [];
  for (const cursor of unionOptions) {
    const field = unwrap(cursor);
    if (alreadyVisited(field, visited)) {
      continue;
    }
    if (!defNameOf(field) && field.refs.size === 0 && kindOf(field.node) === 'union') {
      const nested = fieldUnionOptions(field);
      if (nested) {
        result.push(...flattenUnionOptions(nested, withTraversed(visited, field)));
        continue;
      }
    }
    result.push({cursor, field});
  }
  return result;
}

function matchUnionBehavior(
  unionOptions: SchemaCursor[],
  options?: ChildRefAnalysisOptions,
): BehaviorNode | undefined {
  const flatOptions = flattenUnionOptions(unionOptions).map(opt => opt.field);
  if (flatOptions.some(isActionOption)) return {type: 'ACTION'};
  if (flatOptions.some(opt => isDynamicOption(opt, options))) {
    const dynamicOptions = flatOptions.filter(opt => isDynamicOption(opt, options));
    const literalOptions = flatOptions.filter(opt => !isDynamicOption(opt, options));
    const hasNonBooleanDynamic = dynamicOptions.some(opt => {
      const refDef = defNameOf(opt);
      return refDef.startsWith('Dynamic') && refDef !== 'DynamicBoolean';
    });
    const hasBooleanSource =
      dynamicOptions.some(opt => namesDef(opt, 'DynamicBoolean')) ||
      literalOptions.some(hasBooleanLeaf);
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
  explicitVal: BehaviorNode,
  catchallVal: BehaviorNode,
): BehaviorNode {
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

const BEHAVIOR_PRECEDENCE: Record<BehaviorNode['type'], number> = {
  ACTION: 5,
  CHECKABLE: 4,
  STRUCTURAL: 3,
  ARRAY: 2,
  OBJECT: 2,
  DYNAMIC: 1,
  STATIC: 0,
};

function mergeIntersectedBehaviors(left: BehaviorNode, right: BehaviorNode): BehaviorNode {
  if (left.type === 'STATIC' && right.type === 'STATIC') {
    return left === CHILD_REF_STATIC_NODE || right === CHILD_REF_STATIC_NODE
      ? CHILD_REF_STATIC_NODE
      : {type: 'STATIC'};
  }
  if (left.type === 'STATIC') return right;
  if (right.type === 'STATIC') return left;
  if (left.type === 'OBJECT' && right.type === 'OBJECT') {
    const allKeys = new Set<string>([...Object.keys(left.shape), ...Object.keys(right.shape)]);
    const shape: Record<string, BehaviorNode> = {};
    for (const key of allKeys) {
      const hasLeft = Object.hasOwn(left.shape, key);
      const hasRight = Object.hasOwn(right.shape, key);
      let merged: BehaviorNode | undefined;
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

function mergeUnionPropertyBehaviors(left: BehaviorNode, right: BehaviorNode): BehaviorNode {
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
  const mergedShape: Record<string, BehaviorNode> = {};
  for (const key of allKeys) {
    let acc: BehaviorNode | undefined;
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
  let mergedCatchall: BehaviorNode | undefined;
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

function matchObjectVariantUnionBehavior(
  unionOptions: SchemaCursor[],
  visited: Set<object>,
  options?: ChildRefAnalysisOptions,
): BehaviorNode {
  const nonNullish = flattenUnionOptions(unionOptions).filter(opt => !isNullishField(opt.field));
  if (nonNullish.length === 0) {
    return {type: 'STATIC'};
  }
  const branchBehaviors = nonNullish.map(opt => getFieldBehavior(opt.cursor, visited, options));
  if (branchBehaviors.every((b): b is ObjectBehaviorNode => b.type === 'OBJECT')) {
    return mergeUnionObjectBehaviors(branchBehaviors);
  }
  const arrayBehaviors = branchBehaviors.filter(
    (b): b is Extract<BehaviorNode, {type: 'ARRAY'}> => b.type === 'ARRAY',
  );
  if (
    arrayBehaviors.length > 0 &&
    branchBehaviors.every(b => b.type === 'ARRAY' || b.type === 'STATIC')
  ) {
    const merged = arrayBehaviors
      .slice(1)
      .reduce<BehaviorNode>((acc, cur) => mergeUnionPropertyBehaviors(acc, cur), arrayBehaviors[0]);
    return hasActiveBehavior(merged) ? merged : {type: 'STATIC'};
  }
  return {type: 'STATIC'};
}

function scrapeObjectShape(
  objShape: Record<string, SchemaCursor>,
  visited: Set<object>,
  options?: ChildRefAnalysisOptions,
): Record<string, BehaviorNode> {
  const shape: Record<string, BehaviorNode> = {};
  for (const [key, value] of Object.entries(objShape)) {
    const behavior = getFieldBehavior(value, visited, options);
    shape[key] =
      behavior.type === 'STATIC' && isSingleChildPropertySchema(key, value.node, value.doc, options)
        ? CHILD_REF_STATIC_NODE
        : behavior;
  }
  return shape;
}

/**
 * Recursively maps a JSON Schema node to its corresponding BehaviorNode.
 *
 * `allOf` (and a union with constraining siblings) merges the behaviors of its
 * members as an intersection.
 *
 * @param cursor JSON Schema node to inspect, with its owner document.
 * @param visited Nodes already visited on the current branch, for cycle detection.
 * @param options Optional child-reference analysis options.
 * @returns Behavior node representing runtime handling for the schema.
 */
function getFieldBehavior(
  cursor: SchemaCursor,
  visited = new Set<object>(),
  options?: ChildRefAnalysisOptions,
  inArray = false,
): BehaviorNode {
  if (cursor.node === undefined) {
    return {type: 'STATIC'};
  }
  const field = unwrap(cursor);
  if (alreadyVisited(field, visited)) {
    return {type: 'STATIC'};
  }
  const nextVisited = withTraversed(visited, field);

  const defName = defNameOf(field);

  if (isCheckableField(field)) {
    return {type: 'CHECKABLE'};
  }

  if (defName === 'Action') {
    return {type: 'ACTION'};
  }

  const kind = kindOf(field.node);
  const unionOptions = kind === 'union' ? fieldUnionOptions(field) : undefined;
  const current: SchemaCursor = {node: field.node, doc: field.doc};
  const marksOuterChildList =
    (field.refs.has('child-list') ||
      defName === 'ChildList' ||
      Boolean(defName && options?.childListRefNames?.has(defName))) &&
    canSchemaHoldListRef(cursor.node, cursor.doc, options);

  if (!unionOptions && marksOuterChildList) {
    return {type: 'STRUCTURAL'};
  }

  if (isDynamicDefName(defName) && kind !== 'object' && kind !== 'array') {
    return namesDef(field, 'DynamicBoolean')
      ? {type: 'DYNAMIC', isBoolean: true}
      : {type: 'DYNAMIC'};
  }

  if (kind === 'intersection') {
    const [left, right] = intersectionSides(field);
    const merged = mergeIntersectedBehaviors(
      getFieldBehavior(left, nextVisited, options, inArray),
      getFieldBehavior(right, nextVisited, options, inArray),
    );
    return merged.type === 'STRUCTURAL' && !canSchemaHoldListRef(current.node, current.doc, options)
      ? {type: 'STATIC'}
      : merged;
  }

  if (unionOptions) {
    const unionBehavior =
      matchUnionBehavior(unionOptions, options) ??
      (marksOuterChildList ? ({type: 'STRUCTURAL'} as const) : undefined);
    if (unionBehavior) {
      if (unionBehavior.type === 'STRUCTURAL') {
        let mergedElement: BehaviorNode | undefined;
        for (const opt of flattenUnionOptions(unionOptions)) {
          if (!isChildListOption(opt.field, options) && isArrayOption(opt.field)) {
            const branchBehavior = getFieldBehavior(opt.cursor, nextVisited, options);
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

  if (kind === 'array') {
    return {
      type: 'ARRAY',
      element: getFieldBehavior(arrayElement(field), nextVisited, options, true),
    };
  }

  if (kind === 'object') {
    if (!inArray && isTemplateRef(field)) {
      return {type: 'STRUCTURAL'};
    }
    // `additionalProperties` as a schema types every undeclared key, like a
    // record's values; `true` or absent leaves them untyped.
    const additional = (field.node as Obj)['additionalProperties'];
    const catchall = isObj(additional)
      ? getFieldBehavior({node: additional, doc: field.doc}, nextVisited, options)
      : undefined;
    return makeObjectBehavior(
      scrapeObjectShape(ownProperties(field), nextVisited, options),
      catchall,
    );
  }

  return {type: 'STATIC'};
}

/** Types recognized as dynamic data bindings or expression function calls. */
type DynamicTypes =
  | DataBinding
  | FunctionCall
  | {'@path': string}
  | {path: string}
  | {call: string; catalogId?: string; args?: Record<string, unknown>; returnType?: string}
  | {'@call': string; catalogId?: string; args?: Record<string, unknown>; returnType?: string};

/** Types recognized as user actions or function call events. */
type ActionLike =
  | Action
  // The v1.0 `FunctionCall` schema infers as `any`, so its action variant is
  // `{functionCall?: any}` and needs its own entry.
  | V1Action
  | {event: {name: string; context?: Record<string, unknown>}}
  | {functionCall: {call: string; catalogId?: string; args?: Record<string, unknown>}}
  | {functionCall: {'@call': string; catalogId?: string; args?: Record<string, unknown>}};

/**
 * Evaluates to true for object types with a string index signature, such as
 * `Record<string, unknown>`. Every object type is assignable to the weak
 * `{functionCall?: any}` member of `ActionLike`, so these are checked
 * separately: they carry data, not an action.
 */
type HasStringIndex<T> = string extends keyof T ? true : false;

/** Evaluates to true if type T can contain a dynamic binding. */
type IsDynamic<T> = ({path: string} extends NonNullable<T> ? true : false) extends true
  ? true
  : ({'@path': string} extends NonNullable<T> ? true : false) extends true
    ? true
    : ({call: string} extends NonNullable<T> ? true : false) extends true
      ? true
      : ({'@call': string} extends NonNullable<T> ? true : false) extends true
        ? true
        : DataBinding extends NonNullable<T>
          ? true
          : FunctionCall extends NonNullable<T>
            ? true
            : false;

/**
 * Evaluates to true if type T is a child list, which can be a template as well as a list of
 * component ids. A plain list of strings is not one: the binder resolves only properties
 * declared as child lists.
 */
type IsChildList<T> = [NonNullable<T>] extends [ChildList]
  ? Extract<ChildList, {componentId: string}> extends NonNullable<T>
    ? true
    : false
  : false;

/**
 * Resolved reference to a child component with its unique identifier and data context path.
 */
export interface ResolvedChildRef {
  /** Unique identifier of the referenced child component. */
  id: string;
  /** Base data model path scoped to this child component instance. */
  basePath: string;
}

/**
 * Maps raw Zod inferred types to their resolved runtime equivalents.
 *
 * For example, an `Action` object becomes a callable `() => Promise<void>` function. The
 * binder walks lists and objects, so an action, binding or child list inside them resolves
 * too, as at the top level.
 */
export type ResolveA2uiProp<T> = [NonNullable<T>] extends [ActionLike]
  ? HasStringIndex<NonNullable<T>> extends true
    ? Exclude<T, DynamicTypes>
    : ((options?: ActionDispatchOptions) => Promise<void>) | Extract<T, undefined>
  : IsChildList<T> extends true
    ? (string | ResolvedChildRef)[] | Extract<T, undefined>
    : Exclude<T, DynamicTypes> extends never
      ? unknown
      : IsDynamic<T> extends true
        ? Exclude<T, DynamicTypes>
        : ResolveNested<T>;

/**
 * Resolves the items of a list and the properties of an object, as the binder does.
 *
 * A check rule or a list of them is left as it is, since the binder hands it on unresolved,
 * and so is an object with a string index signature, which carries data. A value bound to
 * the data model is not walked either: the binder hands on the value the model holds.
 */
type ResolveNested<T> = T extends CheckRule | V1CheckRule | readonly (CheckRule | V1CheckRule)[]
  ? T
  : T extends readonly (infer Item)[]
    ? ResolveA2uiProp<Item>[]
    : T extends (...args: never[]) => unknown
      ? T
      : T extends object
        ? HasStringIndex<T> extends true
          ? T
          : {[K in keyof T]: ResolveA2uiProp<T[K]>} & GenerateSetters<T>
        : T;

/**
 * Generates two-way binding setters for dynamic properties.
 *
 * For example, a `value: DynamicString` property produces a `setValue(val: string)` setter.
 * A property declared as a binding with no literal branch has no such value type, so its setter
 * falls back to `unknown`.
 */
export type GenerateSetters<T> = {
  [K in keyof T as IsDynamic<T[K]> extends true ? `set${Capitalize<string & K>}` : never]-?: (
    value: [Exclude<NonNullable<T[K]>, DynamicTypes>] extends [never]
      ? unknown
      : Exclude<NonNullable<T[K]>, DynamicTypes>,
  ) => void;
};

/**
 * Fully resolved component properties, setters, and validation flags.
 *
 * Used by framework adapters (such as createReactComponent) to provide
 * strongly-typed props to component views.
 */
export type ResolveA2uiProps<T> = (T extends object
  ? {
      [K in keyof T]: ResolveA2uiProp<T[K]>;
    }
  : T) &
  GenerateSetters<T> & {
    isValid?: boolean;
    validationErrors?: string[];
    validationResults?: Array<{
      valid: boolean;
      message: string;
      code?: string;
      severity: 'error' | 'warning' | 'info';
    }>;
    accessibility?: ResolvedAccessibility;
    /** The v1.0 accessibility attributes, resolved. */
    '@accessibility'?: ResolvedAccessibility;
  };

/** Resolved accessibility attributes of a component. */
export interface ResolvedAccessibility {
  label?: string;
  description?: string;
  live?: 'off' | 'polite' | 'assertive';
  hidden?: boolean;
}

/**
 * Finalizes a component's resolved props: removes raw v1.0 `@checks` rules
 * (which the binder has already evaluated into `isValid`, `validationErrors`,
 * and `validationResults`) and, if `mirrorsAccessibility` is set, mirrors
 * `@accessibility` onto `accessibility`.
 *
 * @param resolved The resolved props, if any.
 * @param mirrorsAccessibility Whether the component's schema leaves
 *   `accessibility` free for the mirror, by declaring no custom property of
 *   that name.
 * @returns The finalized resolved props.
 */
function finalizeResolvedProps(
  resolved: unknown,
  mirrorsAccessibility: boolean,
): Record<string, unknown> {
  if (!resolved || typeof resolved !== 'object') return {};
  const {[AT_CHECKS]: _checks, ...rest} = resolved as Record<string, unknown>;
  if (mirrorsAccessibility && AT_ACCESSIBILITY in rest) {
    rest['accessibility'] = rest[AT_ACCESSIBILITY];
  }
  return rest;
}

/**
 * The maximum number of children materialized by dynamic ChildList templates.
 * Prevents unbounded resource consumption (CWE-400) when bound to massive arrays.
 */
export const MAX_DYNAMIC_CHILD_LIST_SIZE = 10_000;

/**
 * Safely bounds array length for dynamic child lists to prevent unbounded memory allocation.
 * Returns an array of at most MAX_DYNAMIC_CHILD_LIST_SIZE items.
 */
export function getSafeChildList<T = unknown>(value: unknown): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (
    value.length > MAX_DYNAMIC_CHILD_LIST_SIZE ? value.slice(0, MAX_DYNAMIC_CHILD_LIST_SIZE) : value
  ) as T[];
}

/**
 * Reactive property binder transforming raw A2UI component JSON into strongly-typed resolved props.
 *
 * Connects component properties to the data context, resolves dynamic bindings,
 * actions, structural templates, and validation checks.
 *
 * @template T Component property interface.
 */
export class GenericBinder<T> {
  private dataListeners: (() => void)[] = [];
  private propsListeners: ((props: T) => void)[] = [];
  /** Snapshot of currently resolved properties. */
  private currentProps: Partial<T> = {};
  private compUnsub?: () => void;
  private isConnected = false;

  private context: ComponentContext;
  private behaviorTree: BehaviorNode;
  /**
   * Whether `@accessibility` is mirrored onto `accessibility`. Decided by the
   * schema, not the payload, so that a custom `accessibility` property the
   * payload omits is not filled with the accessibility attributes.
   */
  private readonly mirrorsAccessibility: boolean;
  // Actions resolve to closures, which downstream value comparison cannot
  // inspect; reusing the closure while the raw payload is unchanged keeps
  // unchanged action props reference-identical across rebuilds.
  private actionClosures = new Map<
    string,
    {raw: unknown; closure: (options?: ActionDispatchOptions) => Promise<void>}
  >();
  private prevActionClosures?: Map<
    string,
    {raw: unknown; closure: (options?: ActionDispatchOptions) => Promise<void>}
  >;

  /**
   * Creates a new binder for the given component context and schema.
   *
   * @param context Component context providing state and event dispatching.
   * @param schema Zod schema defining the component properties.
   * @param options Optional child-reference analysis options overriding protocol-version defaults.
   */
  constructor(context: ComponentContext, schema: z.ZodTypeAny, options?: ChildRefAnalysisOptions) {
    this.context = context;
    const protocolVersion =
      context.componentModel?.catalog?.protocolVersion ??
      context.dataContext?.surface?.protocolVersion ??
      context.dataContext?.surface?.defaultCatalog?.protocolVersion;
    const resolvedOptions = options ?? resolveChildRefOptions(protocolVersion);
    // ponytail: bridge until Task 8 — catalog schemas are still Zod.
    const {node, doc} = toSchemaDoc(schema, protocolVersion);
    this.behaviorTree = scrapeComponentBehavior(node, doc, resolvedOptions);
    this.mirrorsAccessibility = !componentMixinLayout(schema).customKeys.has('accessibility');
    this.resolveInitialProps();
  }

  private resolveInitialProps() {
    const props = this.context.componentModel.properties;
    const resolved = this.resolveAndBind(props, this.behaviorTree, [], true);
    this.currentProps = finalizeResolvedProps(resolved, this.mirrorsAccessibility) as Partial<T>;
  }

  private connect() {
    if (this.isConnected) return;
    this.isConnected = true;
    const sub = this.context.componentModel.onUpdated.subscribe(() => {
      this.rebuildAllBindings();
    });
    this.compUnsub = () => sub.unsubscribe();
    this.rebuildAllBindings();
  }

  private rebuildAllBindings() {
    this.dataListeners.forEach(l => l());
    this.dataListeners = [];

    const props = this.context.componentModel.properties;

    // Rebuild from an empty snapshot and a fresh action closure cache so
    // properties and actions omitted by the update are evicted.
    this.currentProps = {};
    this.prevActionClosures = this.actionClosures;
    this.actionClosures = new Map();
    let resolved: unknown;
    try {
      resolved = this.resolveAndBind(props, this.behaviorTree, [], false);
    } finally {
      this.prevActionClosures = undefined;
    }
    this.currentProps = finalizeResolvedProps(resolved, this.mirrorsAccessibility) as Partial<T>;

    this.notify();
  }

  private bindDynamicValue(
    value: unknown,
    path: string[],
    isSync: boolean,
    isBoolean?: boolean,
  ): unknown {
    const coerce = isBoolean ? coerceDynamicBoolean : (v: unknown) => v;
    const bound = this.context.dataContext.subscribeDynamicValue(value, newVal => {
      this.updateDeepValue(path, coerce(newVal));
      this.notify();
    });

    if (!isSync) {
      this.dataListeners.push(() => bound.unsubscribe());
    } else {
      bound.unsubscribe();
    }
    return coerce(bound.value);
  }

  /**
   * Synchronously evaluates dynamic expressions within a nested object tree.
   *
   * Traverses objects and arrays, resolving JSON pointer paths and function calls
   * against the current data context without creating persistent reactive subscriptions.
   *
   * @param val Raw value, nested object, or dynamic expression to evaluate.
   * @param depth Current recursion depth, bounded by MAX_DYNAMIC_VALUE_DEPTH.
   * @returns Evaluated data structure with dynamic expressions resolved.
   */
  private resolveDeepSync(val: unknown, depth = 0): unknown {
    if (typeof val !== 'object' || val === null) return val;
    if (depth > MAX_DYNAMIC_VALUE_DEPTH) return undefined;

    if ('path' in val || 'call' in val || '@path' in val || '@call' in val) {
      return this.context.dataContext.resolveDynamicValue(val, depth);
    }
    if (Array.isArray(val)) return val.map(item => this.resolveDeepSync(item, depth + 1));
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = this.resolveDeepSync(v, depth + 1);
    }
    return res;
  }

  private bindAction(
    value: unknown,
    path: string[],
  ): (options?: ActionDispatchOptions) => Promise<void> {
    const cacheKey = path.join('/');
    const cached = this.actionClosures.get(cacheKey) ?? this.prevActionClosures?.get(cacheKey);
    if (cached && jsonEquals(cached.raw, value)) {
      this.actionClosures.set(cacheKey, cached);
      return cached.closure;
    }
    const closure = async (options?: ActionDispatchOptions) => {
      if (!value || typeof value !== 'object') {
        return;
      }
      const valObj = value as Record<string, unknown>;
      const isFunctionCall =
        Boolean(valObj.functionCall && typeof valObj.functionCall === 'object') ||
        'call' in valObj ||
        '@call' in valObj;
      if (isFunctionCall) {
        await this.context.dataContext.resolveAction(value as Action | Record<string, unknown>, {
          userActivation: true,
        });
        return;
      }
      let resolved = this.context.dataContext.resolveAction(
        value as Action | Record<string, unknown>,
        {userActivation: true},
      );
      // An event action whose entries wait on asynchronous calls resolves to
      // a Promise, which settles to `undefined` when an entry failed. A
      // synchronous one is dispatched without waiting.
      if (isThenable(resolved)) {
        resolved = await resolved;
      }
      if (resolved === undefined) {
        return;
      }
      await this.context.dispatchAction(resolved as Action, options?.metadata);
    };
    this.actionClosures.set(cacheKey, {raw: value, closure});
    return closure;
  }

  private mapTemplateChildren(
    rawArray: unknown,
    templateComponentId: string,
    templatePath: string,
  ): ResolvedChildRef[] {
    const arr = getSafeChildList(rawArray);
    const listContext = this.context.dataContext.nested(templatePath);
    return arr.map((_, i) => ({
      id: templateComponentId,
      basePath: listContext.nested(String(i)).path,
    }));
  }

  private bindStructuralTemplate(
    value: unknown,
    path: string[],
    isSync: boolean,
  ): ResolvedChildRef[] | unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const templateObj = value as Record<string, unknown>;
    const templatePath =
      typeof templateObj.path === 'string'
        ? templateObj.path
        : typeof templateObj['@path'] === 'string'
          ? templateObj['@path']
          : undefined;
    const templateComponentId =
      typeof templateObj.componentId === 'string' ? templateObj.componentId : undefined;

    if (!templatePath || !templateComponentId) {
      return value;
    }

    const atLeastV10 = isAtLeastVersion(
      this.context.dataContext.surface?.protocolVersion ??
        this.context.dataContext.surface?.defaultCatalog?.protocolVersion,
      '1.0',
    );
    const binding = atLeastV10 ? {'@path': templatePath} : {path: templatePath};
    const bound = this.context.dataContext.subscribeDynamicValue(binding, newVal => {
      const resolvedChildren = this.mapTemplateChildren(newVal, templateComponentId, templatePath);
      this.updateDeepValue(path, resolvedChildren);
      this.notify();
    });

    if (!isSync) {
      this.dataListeners.push(() => bound.unsubscribe());
    } else {
      bound.unsubscribe();
    }

    return this.mapTemplateChildren(bound.value, templateComponentId, templatePath);
  }

  private extractValidationResult(
    val: unknown,
    explicitRuleMessage?: string,
    fallbackMessage = 'Validation failed',
  ): {valid: boolean; message: string; code?: string; severity: 'error' | 'warning' | 'info'} {
    if (typeof val === 'object' && val !== null && 'valid' in val) {
      const rec = val as {valid: unknown; message?: unknown; code?: unknown; severity?: unknown};
      const customMessage = rec.message;
      const severity =
        rec.severity === 'warning' || rec.severity === 'info' ? rec.severity : 'error';
      const code = typeof rec.code === 'string' ? rec.code : undefined;
      const message =
        explicitRuleMessage !== undefined
          ? explicitRuleMessage
          : customMessage !== undefined && customMessage !== null
            ? String(customMessage)
            : fallbackMessage;
      return {
        valid: Boolean(rec.valid),
        message,
        ...(code !== undefined ? {code} : {}),
        severity,
      };
    }
    return {
      valid: Boolean(val),
      message: explicitRuleMessage ?? fallbackMessage,
      severity: 'error',
    };
  }

  private bindCheckable(
    value: unknown,
    path: string[],
    isSync: boolean,
    initialTarget?: Record<string, unknown>,
  ): unknown {
    const rules = Array.isArray(value) ? value : [];
    const ruleResults: {
      valid: boolean;
      message: string;
      code?: string;
      severity: 'error' | 'warning' | 'info';
    }[] = rules.map(() => ({
      valid: true,
      message: '',
      severity: 'error',
    }));

    const computeValidationState = () => {
      const errors = ruleResults
        .filter(r => !r.valid && r.severity === 'error')
        .map(r => r.message);
      const failedResults = ruleResults.filter(r => !r.valid);
      return {
        isValid: errors.length === 0,
        validationErrors: errors,
        validationResults: failedResults,
      };
    };
    const parentPath = path.slice(0, -1);
    const applyValidationState = () => {
      const state = computeValidationState();
      this.updateDeepValue([...parentPath, 'isValid'], state.isValid);
      this.updateDeepValue([...parentPath, 'validationErrors'], state.validationErrors);
      this.updateDeepValue([...parentPath, 'validationResults'], state.validationResults);
    };
    const updateValidationState = () => {
      applyValidationState();
      this.notify();
    };

    rules.forEach((rule: unknown, index: number) => {
      const ruleObj =
        typeof rule === 'object' && rule !== null ? (rule as Record<string, unknown>) : undefined;
      const condition = ruleObj && ruleObj.condition !== undefined ? ruleObj.condition : rule;
      const ruleMessage = typeof ruleObj?.message === 'string' ? ruleObj.message : undefined;
      // An explicit rule message overrides the message a condition function
      // returns. A path-bound check reads a result the agent or application
      // wrote, whose message carries the finding, so there the rule message
      // is only the fallback.
      const explicitMessage = this.isPathBoundCondition(condition) ? undefined : ruleMessage;
      const fallbackMessage = ruleMessage ?? 'Validation failed';
      ruleResults[index].message = fallbackMessage;

      if (this.context.dataContext.atLeastV10) {
        this.bindCheckCondition(
          condition,
          isSync,
          result => {
            ruleResults[index] = result;
          },
          updateValidationState,
          explicitMessage,
          fallbackMessage,
        );
        return;
      }

      const bound = this.context.dataContext.subscribeDynamicValue(condition, newVal => {
        ruleResults[index] = this.extractValidationResult(newVal, explicitMessage, fallbackMessage);
        updateValidationState();
      });

      if (!isSync) {
        this.dataListeners.push(() => bound.unsubscribe());
      } else {
        bound.unsubscribe();
      }

      ruleResults[index] = this.extractValidationResult(
        bound.value,
        explicitMessage,
        fallbackMessage,
      );
    });

    // Set initial state directly on the enclosing object being built so
    // rebuilding `this.currentProps` from `resolved` preserves validation
    // state at root, nested object, and array-element levels.
    if (initialTarget) {
      const state = computeValidationState();
      initialTarget.isValid = state.isValid;
      initialTarget.validationErrors = state.validationErrors;
      initialTarget.validationResults = state.validationResults;
    }

    return value;
  }

  /**
   * Binds the condition of one check rule on a v1.0 surface.
   *
   * While the condition waits on an asynchronous call, such as a function
   * call routed to the agent, the rule is pending and counts as valid. When
   * the call settles the rule is evaluated; if the call failed the rule is
   * invalid. Either way subscribers are notified.
   *
   * @param condition The rule's condition.
   * @param isSync Whether the binding is resolved once, without subscriptions.
   * @param setResult Stores the rule's result.
   * @param onUpdate Recomputes the validation state and notifies subscribers.
   * @param explicitMessage Message that overrides the one the condition returns.
   * @param fallbackMessage Message used when the condition returns none.
   */
  private bindCheckCondition(
    condition: unknown,
    isSync: boolean,
    setResult: (result: CheckRuleResult) => void,
    onUpdate: () => void,
    explicitMessage: string | undefined,
    fallbackMessage: string,
  ): void {
    const sig = resolveSignalKeepingPending(this.context.dataContext, condition);
    let active = !isSync;
    let current: unknown;
    const apply = (value: unknown, notify: boolean) => {
      current = value;
      const settled = settleDeep(value);
      if (isThenable(settled)) {
        setResult({valid: true, message: fallbackMessage, severity: 'error'});
        Promise.resolve(settled).then(
          settledValue => {
            if (!active || current !== value) return;
            setResult(this.checkResultOf(settledValue, explicitMessage, fallbackMessage));
            onUpdate();
          },
          () => {
            if (!active || current !== value) return;
            setResult({valid: false, message: fallbackMessage, severity: 'error'});
            onUpdate();
          },
        );
      } else {
        setResult(this.checkResultOf(settled, explicitMessage, fallbackMessage));
      }
      if (notify) onUpdate();
    };

    if (isSync) {
      apply(peekValue(sig), false);
      sig.unsubscribe?.();
      return;
    }
    let initial = true;
    const dispose = effect(() => {
      const value = getValue(sig);
      if (!initial) apply(value, true);
    });
    initial = false;
    apply(peekValue(sig), false);
    this.dataListeners.push(() => {
      active = false;
      dispose();
      sig.unsubscribe?.();
    });
  }

  /** The result of a check rule whose condition settled to `value`. */
  private checkResultOf(
    value: unknown,
    explicitMessage: string | undefined,
    fallbackMessage: string,
  ): CheckRuleResult {
    if (findFailedArgument(value)) {
      return {valid: false, message: fallbackMessage, severity: 'error'};
    }
    return this.extractValidationResult(value, explicitMessage, fallbackMessage);
  }

  /** Whether a check condition is a data binding rather than a function call. */
  private isPathBoundCondition(condition: unknown): boolean {
    if (typeof condition !== 'object' || condition === null) return false;
    const rec = condition as Record<string, unknown>;
    return this.context.dataContext.atLeastV10
      ? typeof rec['@path'] === 'string' && !('@call' in rec)
      : typeof rec['path'] === 'string' && !('call' in rec);
  }

  private getWritableBindingPath(rawPropValue: unknown): string | undefined {
    if (!rawPropValue || typeof rawPropValue !== 'object' || Array.isArray(rawPropValue)) {
      return undefined;
    }
    const rawObj = rawPropValue as Record<string, unknown>;
    const bindingKey = this.context.dataContext.atLeastV10 ? '@path' : 'path';
    const pathVal = rawObj[bindingKey];
    if (
      typeof pathVal === 'string' &&
      (this.context.dataContext.atLeastV10 || !Object.hasOwn(rawObj, 'componentId'))
    ) {
      return pathVal;
    }
    return undefined;
  }

  private bindObject(
    valObj: Record<string, unknown>,
    shape: Record<string, BehaviorNode>,
    path: string[],
    isSync: boolean,
    catchall?: BehaviorNode,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // 1. Resolve all provided properties
    for (const [k, v] of Object.entries(valObj)) {
      const childBehavior = Object.hasOwn(shape, k) ? shape[k] : (catchall ?? {type: 'STATIC'});
      result[k] = this.resolveAndBind(v, childBehavior, [...path, k], isSync, result);
    }

    // 2. Ensure all dynamic setters exist, even if the property wasn't provided in the payload
    for (const [k, childBehavior] of Object.entries(shape)) {
      if (childBehavior.type === 'DYNAMIC') {
        const setterName = `set${k.charAt(0).toUpperCase() + k.slice(1)}`;
        const rawPropValue = valObj[k];
        result[setterName] = (newValue: unknown) => {
          const pathVal = this.getWritableBindingPath(rawPropValue);
          if (pathVal !== undefined) {
            this.context.dataContext.set(pathVal, newValue);
          }
        };
      }
    }

    if (catchall?.type === 'DYNAMIC') {
      for (const [k, v] of Object.entries(valObj)) {
        if (!Object.hasOwn(shape, k) && k.length > 0) {
          const pathVal = this.getWritableBindingPath(v);
          if (pathVal !== undefined) {
            const setterName = `set${k.charAt(0).toUpperCase() + k.slice(1)}`;
            if (!Object.hasOwn(valObj, setterName)) {
              result[setterName] = (newValue: unknown) => {
                this.context.dataContext.set(pathVal, newValue);
              };
            }
          }
        }
      }
    }

    return result;
  }

  private resolveAndBind(
    value: unknown,
    behavior: BehaviorNode,
    path: string[],
    isSync: boolean,
    parentTarget?: Record<string, unknown>,
  ): unknown {
    if (
      value === undefined ||
      (value === null && !(behavior.type === 'DYNAMIC' && behavior.isBoolean))
    ) {
      return value;
    }

    switch (behavior.type) {
      case 'DYNAMIC':
        return this.bindDynamicValue(value, path, isSync, behavior.isBoolean);

      case 'ACTION':
        if (typeof value !== 'object' || Array.isArray(value)) return value;
        return this.bindAction(value, path);

      case 'STRUCTURAL':
        return this.bindStructuralTemplate(value, path, isSync);

      case 'CHECKABLE':
        if (!Array.isArray(value)) return value;
        return this.bindCheckable(value, path, isSync, parentTarget);

      case 'STATIC':
        return value;

      case 'ARRAY':
        if (!Array.isArray(value)) {
          return behavior.templateFallback
            ? this.bindStructuralTemplate(value, path, isSync)
            : value;
        }
        return value.map((item, index) =>
          this.resolveAndBind(item, behavior.element, [...path, index.toString()], isSync),
        );

      case 'OBJECT':
        if (typeof value !== 'object' || Array.isArray(value)) return value;
        return this.bindObject(
          value as Record<string, unknown>,
          behavior.shape,
          path,
          isSync,
          behavior.catchall,
        );
    }
  }

  private updateDeepValue(path: string[], newValue: unknown) {
    const updated = this.cloneAndUpdate(this.currentProps, path, newValue) as Record<
      string,
      unknown
    >;
    if (this.mirrorsAccessibility && path[0] === AT_ACCESSIBILITY && AT_ACCESSIBILITY in updated) {
      updated['accessibility'] = updated[AT_ACCESSIBILITY];
    }
    this.currentProps = updated as Partial<T>;
  }

  private cloneAndUpdate(obj: unknown, path: string[], newValue: unknown): unknown {
    if (path.length === 0) return newValue;
    const [key, ...rest] = path;

    if (Array.isArray(obj)) {
      const newArr = [...obj];
      newArr[Number(key)] = this.cloneAndUpdate(newArr[Number(key)], rest, newValue);
      return newArr;
    } else {
      const record =
        typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : {};
      return {
        ...record,
        [key]: this.cloneAndUpdate(record[key], rest, newValue),
      };
    }
  }

  /**
   * Disposes all active data subscriptions and detaches component listeners.
   */
  dispose() {
    this.actionClosures.clear();
    if (!this.isConnected) return;
    this.isConnected = false;
    this.dataListeners.forEach(l => l());
    this.dataListeners = [];
    if (this.compUnsub) {
      this.compUnsub();
      this.compUnsub = undefined;
    }
  }

  private notify() {
    this.propsListeners.forEach(l => l(this.currentProps as T));
  }

  /**
   * Subscribes to prop change notifications.
   *
   * @param listener Callback invoked whenever resolved properties update.
   * @returns A subscription object to unsubscribe.
   */
  subscribe(listener: (props: T) => void) {
    if (this.propsListeners.length === 0) {
      this.connect();
    }
    this.propsListeners.push(listener);

    return {
      unsubscribe: () => {
        this.propsListeners = this.propsListeners.filter(l => l !== listener);
        if (this.propsListeners.length === 0) {
          this.dispose();
        }
      },
    };
  }

  /**
   * Current snapshot of resolved component properties.
   */
  get snapshot() {
    return this.currentProps as T;
  }
}

/**
 * Evaluates structural equality between two JSON-compatible values.
 *
 * @param a First value to compare.
 * @param b Second value to compare.
 * @returns Whether the two values are structurally equal.
 */
function jsonEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => jsonEquals(item, b[index]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    key =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      jsonEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
