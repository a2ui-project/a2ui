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

import {z} from 'zod';

import {
  coerceDynamicBoolean,
  isDynamicBooleanSchema,
} from '../catalog/validation_result_coercion.js';
import {ActionDispatchOptions} from '../common/metadata.js';
import {isAtLeastVersion} from '../common/semver.js';
import {findFailedArgument, isThenable, settleDeep} from '../common/settle_deep.js';
import {effect, getValue, peekValue} from '../reactivity/signals.js';
import {type ChildRefKind} from '../types/child-ref-helpers.js';
import {
  AccessibilityAttributesSchema,
  Action,
  CheckRule,
  ChildList,
  DataBinding,
  FunctionCall,
} from '../types/common-types.js';
import type {Action as V1Action, CheckRule as V1CheckRule} from '../v1_0/schema/common-types.js';
import {ComponentContext} from './component-context.js';
import {MAX_DYNAMIC_VALUE_DEPTH} from './data-context.js';
import {resolveSignalKeepingPending} from './data-context-internal.js';
import {
  type UnwrappedZodField,
  extractRefFields,
  getUnionOptions,
  isTemplateRefObject,
  unwrapZodField,
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
 * Represents the intended runtime behavior of a property parsed from its Zod
 * schema.
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
  | {type: 'OBJECT'; shape: Record<string, BehaviorNode>}
  | {type: 'ARRAY'; element: BehaviorNode};

const behaviorCache = new WeakMap<z.ZodTypeAny, BehaviorNode>();
const componentBehaviorCache = new WeakMap<z.ZodTypeAny, BehaviorNode>();

function augmentRootObjectShape(
  schema: z.ZodTypeAny,
  baseShape: Record<string, BehaviorNode>,
): Record<string, BehaviorNode> {
  const nextShape: Record<string, BehaviorNode> = {...baseShape};
  for (const [key, refKind] of extractRefFields(schema)) {
    if (refKind.kind === 'list' && nextShape[key]?.type !== 'STRUCTURAL') {
      nextShape[key] = {type: 'STRUCTURAL'};
    }
  }
  if (!Object.hasOwn(nextShape, 'accessibility')) {
    nextShape.accessibility = getFieldBehavior(AccessibilityAttributesSchema);
  }
  return nextShape;
}

/**
 * Traverses a Zod schema tree to build a `BehaviorNode` map.
 *
 * Enables GenericBinder to determine how to handle raw JSON properties
 * without hardcoding logic for specific component types.
 *
 * @param schema Zod schema to inspect.
 * @returns Root BehaviorNode describing schema properties.
 */
export function scrapeSchemaBehavior(schema: z.ZodTypeAny): BehaviorNode {
  const cached = behaviorCache.get(schema);
  if (cached) {
    return cached;
  }
  const behavior = getFieldBehavior(schema);
  const isRootRecord = unwrapZodField(schema).schema?._def?.typeName === 'ZodRecord';
  const result: BehaviorNode =
    behavior.type === 'OBJECT'
      ? {type: 'OBJECT', shape: augmentRootObjectShape(schema, behavior.shape)}
      : isRootRecord
        ? {type: 'OBJECT', shape: augmentRootObjectShape(schema, {})}
        : behavior;
  behaviorCache.set(schema, result);
  return result;
}

/**
 * Builds the root object `BehaviorNode` for a component's property map,
 * normalizing open non-object component schemas (`z.record(...)`, `z.any()`,
 * `z.unknown()`) into `{ type: 'OBJECT', shape }` with structural child-list
 * and `accessibility` behaviors attached.
 */
export function scrapeComponentBehavior(schema: z.ZodTypeAny): BehaviorNode {
  const cached = componentBehaviorCache.get(schema);
  if (cached) {
    return cached;
  }
  const scraped = scrapeSchemaBehavior(schema);
  const result: BehaviorNode =
    scraped.type === 'OBJECT'
      ? scraped
      : {type: 'OBJECT', shape: augmentRootObjectShape(schema, {})};
  componentBehaviorCache.set(schema, result);
  return result;
}

/**
 * Extracts the definition name from a schema's REF: description, if present.
 * Walks wrapper and pipeline chains to locate the first `REF:` description.
 */
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
    if (!unwrapZodField(def['in']).hasTransform) {
      return somePipelineLeaf(def['out'], predicate, nextVisited);
    }
    return false;
  }
  return predicate(field.schema);
}

function isSingleChildField(prop: z.ZodTypeAny): boolean {
  if (hasChildRefKind(prop, 'component-id')) return true;
  const refDef = getRefDefName(prop);
  return refDef === 'ComponentId' || refDef === 'Child';
}

/**
 * Checks whether a schema represents a checkable validation rule or list of rules.
 */
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
    return Object.hasOwn(shape, 'event');
  });
}

function isDynamicOption(option: z.ZodTypeAny): boolean {
  const refDef = getRefDefName(option);
  if (refDef === 'DataBinding' || refDef === 'FunctionCall' || refDef.startsWith('Dynamic')) {
    return true;
  }
  return somePipelineLeaf(option, current => {
    if (current?._def?.typeName !== 'ZodObject') return false;
    const shape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    const hasComponentId =
      isTemplateRefObject(current) || Object.values(shape).some(prop => isSingleChildField(prop));
    return (
      (Object.hasOwn(shape, '@path') ||
        Object.hasOwn(shape, 'path') ||
        Object.hasOwn(shape, '@call') ||
        Object.hasOwn(shape, 'call')) &&
      !hasComponentId
    );
  });
}

function isChildListOption(option: z.ZodTypeAny): boolean {
  if (hasChildRefKind(option, 'child-list') || getRefDefName(option) === 'ChildList') {
    return true;
  }
  return somePipelineLeaf(option, current => isTemplateRefObject(current));
}

function isArrayOption(option: z.ZodTypeAny): boolean {
  return somePipelineLeaf(option, current => current?._def?.typeName === 'ZodArray');
}

function hasSingleChildObjectField(option: z.ZodTypeAny): boolean {
  return somePipelineLeaf(option, current => {
    if (current?._def?.typeName !== 'ZodObject') return false;
    const shape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    return Object.values(shape).some(prop => isSingleChildField(prop));
  });
}

function isDynamicDef(defName: string, typeName?: string): boolean {
  return (
    (defName === 'DataBinding' || defName === 'FunctionCall' || defName.startsWith('Dynamic')) &&
    typeName !== 'ZodObject' &&
    typeName !== 'ZodArray'
  );
}

function isBooleanOrNullishOption(option: z.ZodTypeAny): boolean {
  const field = unwrapZodField(option);
  if (field.schema?._def?.typeName === 'ZodPipeline') {
    const def = field.schema._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
    if (unwrapZodField(def['in']).hasTransform) {
      return isBooleanOrNullishOption(def['in']);
    }
    return isBooleanOrNullishOption(def['in']) || isBooleanOrNullishOption(def['out']);
  }
  const typeName = field.schema?._def?.typeName as string | undefined;
  return typeName === 'ZodBoolean' || typeName === 'ZodNull' || typeName === 'ZodUndefined';
}

function matchUnionBehavior(options: z.ZodTypeAny[]): BehaviorNode | undefined {
  if (options.some(isActionOption)) return {type: 'ACTION'};
  if (options.some(isDynamicOption)) {
    const literalOptions = options.filter(opt => !isDynamicOption(opt));
    const isBoolean = literalOptions.length > 0 && literalOptions.every(isBooleanOrNullishOption);
    return isBoolean ? {type: 'DYNAMIC', isBoolean: true} : {type: 'DYNAMIC'};
  }
  if (
    options.some(isChildListOption) ||
    (options.some(isArrayOption) && options.some(hasSingleChildObjectField))
  ) {
    return {type: 'STRUCTURAL'};
  }
  return undefined;
}

function mergeIntersectedBehaviors(left: BehaviorNode, right: BehaviorNode): BehaviorNode {
  if (left.type === 'STATIC') return right;
  if (right.type === 'STATIC') return left;
  if (left.type === 'OBJECT' && right.type === 'OBJECT') {
    const shape: Record<string, BehaviorNode> = {...left.shape};
    for (const [key, rightVal] of Object.entries(right.shape)) {
      shape[key] = Object.hasOwn(shape, key)
        ? mergeIntersectedBehaviors(shape[key], rightVal)
        : rightVal;
    }
    return {type: 'OBJECT', shape};
  }
  if (left.type === 'ARRAY' && right.type === 'ARRAY') {
    return {type: 'ARRAY', element: mergeIntersectedBehaviors(left.element, right.element)};
  }
  if (left.type === 'DYNAMIC' && right.type === 'DYNAMIC') {
    return left.isBoolean || right.isBoolean
      ? {type: 'DYNAMIC', isBoolean: true}
      : {type: 'DYNAMIC'};
  }
  return left;
}

function mergeUnionPropertyBehaviors(left: BehaviorNode, right: BehaviorNode): BehaviorNode {
  if (left.type === right.type) {
    if (left.type === 'OBJECT' && right.type === 'OBJECT') {
      return mergeUnionObjectShapes([left.shape, right.shape]);
    }
    if (left.type === 'ARRAY' && right.type === 'ARRAY') {
      return {type: 'ARRAY', element: mergeUnionPropertyBehaviors(left.element, right.element)};
    }
    if (left.type === 'DYNAMIC' && right.type === 'DYNAMIC') {
      return left.isBoolean && right.isBoolean
        ? {type: 'DYNAMIC', isBoolean: true}
        : {type: 'DYNAMIC'};
    }
    return left;
  }
  if (
    (left.type === 'STRUCTURAL' && right.type === 'STATIC') ||
    (left.type === 'STATIC' && right.type === 'STRUCTURAL')
  ) {
    return {type: 'STRUCTURAL'};
  }
  return {type: 'STATIC'};
}

function mergeUnionObjectShapes(shapes: Record<string, BehaviorNode>[]): BehaviorNode {
  const merged: Record<string, BehaviorNode> = {};
  for (const shape of shapes) {
    for (const [key, behavior] of Object.entries(shape)) {
      merged[key] = Object.hasOwn(merged, key)
        ? mergeUnionPropertyBehaviors(merged[key], behavior)
        : behavior;
    }
  }
  return {type: 'OBJECT', shape: merged};
}

function matchObjectVariantUnionBehavior(
  options: z.ZodTypeAny[],
  visited: Set<z.ZodTypeAny>,
): BehaviorNode {
  const nonNullish = options.filter(opt => {
    const typeName = unwrapZodField(opt).schema?._def?.typeName as string | undefined;
    return typeName !== 'ZodNull' && typeName !== 'ZodUndefined';
  });
  if (nonNullish.length === 0) {
    return {type: 'STATIC'};
  }
  const shapes: Record<string, BehaviorNode>[] = [];
  for (const option of nonNullish) {
    const branchBehavior = getFieldBehavior(option, visited);
    if (branchBehavior.type !== 'OBJECT') {
      return {type: 'STATIC'};
    }
    shapes.push(branchBehavior.shape);
  }
  return mergeUnionObjectShapes(shapes);
}

function scrapeObjectShape(
  objShape: Record<string, z.ZodTypeAny>,
  visited: Set<z.ZodTypeAny>,
): Record<string, BehaviorNode> {
  const shape: Record<string, BehaviorNode> = {};
  for (const [key, value] of Object.entries(objShape)) {
    shape[key] = getFieldBehavior(value, visited);
  }
  return shape;
}

/**
 * Recursively maps a Zod schema to its corresponding BehaviorNode.
 *
 * @param type Zod schema to inspect.
 * @param visited Set of already visited schemas on the current branch for cycle detection.
 * @returns Behavior node representing runtime handling for the schema.
 */
function getFieldBehavior(type: z.ZodTypeAny, visited = new Set<z.ZodTypeAny>()): BehaviorNode {
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

  if (
    field.refs.has('child-list') ||
    hasChildRefKind(type, 'child-list') ||
    defName === 'ChildList'
  ) {
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
    const inField = unwrapZodField(def['in']);
    if (inField.hasTransform) {
      return getFieldBehavior(def['in'], nextVisited);
    }
    return mergeIntersectedBehaviors(
      getFieldBehavior(def['in'], nextVisited),
      getFieldBehavior(def['out'], nextVisited),
    );
  }

  if (typeName === 'ZodIntersection') {
    const def = current._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
    return mergeIntersectedBehaviors(
      getFieldBehavior(def.left, nextVisited),
      getFieldBehavior(def.right, nextVisited),
    );
  }

  // Structural matching for A2UI primitives and variant unions using typeName to avoid dual-module instanceof issues
  const unionOptions = getUnionOptions(current);
  if (unionOptions) {
    const unionBehavior = matchUnionBehavior(unionOptions);
    if (unionBehavior) {
      return unionBehavior.type === 'DYNAMIC' && isDynamicBooleanSchema(type)
        ? {type: 'DYNAMIC', isBoolean: true}
        : unionBehavior;
    }
    return matchObjectVariantUnionBehavior(unionOptions, nextVisited);
  }

  // Recursive array scraping
  if (typeName === 'ZodArray') {
    return {
      type: 'ARRAY',
      element: getFieldBehavior(current._def.type as z.ZodTypeAny, nextVisited),
    };
  }

  // Recursive object scraping
  if (typeName === 'ZodObject') {
    if (isTemplateRefObject(current)) {
      return {type: 'STRUCTURAL'};
    }
    const rawShape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    return {
      type: 'OBJECT',
      shape: scrapeObjectShape(rawShape, nextVisited),
    };
  }

  // Fallback
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
    accessibility?: {
      label?: string;
      description?: string;
      live?: 'off' | 'polite' | 'assertive';
      hidden?: boolean;
    };
  };

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
   */
  constructor(context: ComponentContext, schema: z.ZodTypeAny) {
    this.context = context;
    this.behaviorTree = scrapeComponentBehavior(schema);
    this.resolveInitialProps();
  }

  private resolveInitialProps() {
    const props = this.context.componentModel.properties;
    const resolved = this.resolveAndBind(props, this.behaviorTree, [], true);
    this.currentProps = (resolved ?? {}) as Partial<T>;
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
    this.currentProps = (resolved ?? {}) as Partial<T>;

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

  private bindObject(
    valObj: Record<string, unknown>,
    shape: Record<string, BehaviorNode>,
    path: string[],
    isSync: boolean,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // 1. Resolve all provided properties
    for (const [k, v] of Object.entries(valObj)) {
      const childBehavior = shape[k] || {type: 'STATIC'};
      result[k] = this.resolveAndBind(v, childBehavior, [...path, k], isSync, result);
    }

    // 2. Ensure all dynamic setters exist, even if the property wasn't provided in the payload
    for (const [k, childBehavior] of Object.entries(shape)) {
      if (childBehavior.type === 'DYNAMIC') {
        const setterName = `set${k.charAt(0).toUpperCase() + k.slice(1)}`;
        const rawPropValue = valObj[k];
        result[setterName] = (newValue: unknown) => {
          if (rawPropValue && typeof rawPropValue === 'object') {
            const rawObj = rawPropValue as Record<string, unknown>;
            const bindingKey = this.context.dataContext.atLeastV10 ? '@path' : 'path';
            const pathVal = rawObj[bindingKey];
            if (
              typeof pathVal === 'string' &&
              (this.context.dataContext.atLeastV10 || !('componentId' in rawObj))
            ) {
              this.context.dataContext.set(pathVal, newValue);
            }
          }
        };
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
        return this.bindAction(value, path);

      case 'STRUCTURAL':
        return this.bindStructuralTemplate(value, path, isSync);

      case 'CHECKABLE':
        return this.bindCheckable(value, path, isSync, parentTarget);

      case 'STATIC':
        return value;

      case 'ARRAY':
        if (!Array.isArray(value)) return value;
        return value.map((item, index) =>
          this.resolveAndBind(item, behavior.element, [...path, index.toString()], isSync),
        );

      case 'OBJECT':
        if (typeof value !== 'object' || Array.isArray(value)) return value;
        return this.bindObject(value as Record<string, unknown>, behavior.shape, path, isSync);
    }
  }

  private updateDeepValue(path: string[], newValue: unknown) {
    this.currentProps = this.cloneAndUpdate(this.currentProps, path, newValue) as Partial<T>;
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
