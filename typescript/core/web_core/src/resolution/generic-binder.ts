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

import {getLegacySchemaAdapter} from '../catalog/legacy_schema_adapter.js';
import {
  isComponentDefinition,
  type ComponentDefinition,
  type DataTypeDefinition,
} from '../catalog/model/catalog_model.js';
import type {ResolveDefinitionProps} from '../catalog/model/infer_definition_props.js';
import {
  definitionEnvelopeLayout,
  definitionToBehavior,
  type ModelBehaviorNode,
} from '../catalog/model/model_semantics.js';
import {coerceModelDynamicBoolean} from '../catalog/model/model_validator.js';
import {ActionDispatchOptions} from '../common/metadata.js';
import {isAtLeastVersion} from '../common/semver.js';
import {findFailedArgument, isPlainObject, isThenable, settleDeep} from '../common/settle_deep.js';
import {effect, getValue, peekValue} from '../reactivity/signals.js';
import type {
  Action,
  CheckRule,
  ChildList,
  DataBinding,
  FunctionCall,
} from '../types/common-types.js';
import {V08_CHILD_REF_OPTIONS} from '../v0_8/standard_defs.js';
import {V09_CHILD_REF_OPTIONS} from '../v0_9/standard_defs.js';
import type {Action as V1Action, CheckRule as V1CheckRule} from '../v1_0/schema/common-types.js';
import {V10_CHILD_REF_OPTIONS} from '../v1_0/standard_defs.js';
import {ComponentContext} from './component-context.js';
import {MAX_DYNAMIC_VALUE_DEPTH} from './data-context.js';
import {resolveSignalKeepingPending} from './data-context-internal.js';
import type {ChildRefAnalysisOptions} from './ref-fields.js';

export type {ResolveDefinitionProps};

/** The outcome of one check rule. */
interface CheckRuleResult {
  valid: boolean;
  message: string;
  code?: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * Represents the intended runtime behavior of a component property.
 *
 * Derived directly from a canonical {@link ComponentDefinition} via
 * `definitionToBehavior` (zero-dependency), or via the registered legacy
 * schema adapter for Zod-backed components.
 */
export type BehaviorNode = ModelBehaviorNode;

const AT_ACCESSIBILITY = '@accessibility';
const AT_CHECKS = '@checks';

const BEHAVIOR_NODE_TYPES = new Set([
  'DYNAMIC',
  'ACTION',
  'STRUCTURAL',
  'CHECKABLE',
  'STATIC',
  'OBJECT',
  'ARRAY',
]);

function isBehaviorNode(value: unknown): value is BehaviorNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as {type?: unknown}).type === 'string' &&
    BEHAVIOR_NODE_TYPES.has((value as {type: string}).type) &&
    !('_def' in value)
  );
}

/** Input accepted by the {@link GenericBinder} constructor. */
export type GenericBinderTarget =
  | ComponentDefinition
  | {
      readonly definition?: ComponentDefinition;
      readonly types?: Readonly<Record<string, DataTypeDefinition>>;
      readonly schema?: unknown;
    }
  | BehaviorNode
  | unknown;

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

/**
 * Traverses a legacy Zod schema tree to build a `BehaviorNode` map.
 *
 * Delegates to the registered {@link LegacySchemaAdapter} so `generic-binder`
 * has no direct runtime dependency on Zod. For canonical definitions, call
 * `definitionToBehavior(def)` directly.
 */
export function scrapeSchemaBehavior(
  schema: unknown,
  options?: ChildRefAnalysisOptions,
): BehaviorNode {
  if (!schema) {
    return {type: 'STATIC'};
  }
  if (isComponentDefinition(schema)) {
    return definitionToBehavior(schema);
  }
  const adapter = getLegacySchemaAdapter();
  if (!adapter) {
    return {type: 'STATIC'};
  }
  return adapter.scrapeSchemaBehavior(schema, options);
}

/**
 * Builds the root object `BehaviorNode` for a component's property map.
 *
 * Accepts either a canonical {@link ComponentDefinition} (resolved directly
 * without Zod) or a legacy Zod schema (delegated to {@link LegacySchemaAdapter}).
 */
export function scrapeComponentBehavior(
  schema: unknown,
  options?: ChildRefAnalysisOptions,
): BehaviorNode {
  if (isComponentDefinition(schema)) {
    return definitionToBehavior(schema);
  }
  const adapter = getLegacySchemaAdapter();
  if (!adapter) {
    return {
      type: 'OBJECT',
      shape: {
        '@checks': {type: 'CHECKABLE'},
      },
    };
  }
  return adapter.scrapeComponentBehavior(schema, options);
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

/**
 * Strips `DynamicTypes` branches from `T` while keeping `any` and string-indexed
 * data objects such as `Record<string, unknown>` intact.
 */
type StripDynamic<T> = 0 extends 1 & T
  ? T
  : T extends unknown
    ? HasStringIndex<T> extends true
      ? T
      : T extends DynamicTypes
        ? never
        : T
    : never;

/**
 * Removes string-indexed object members such as `Record<string, unknown>` from
 * a union before checking whether any remaining branch is a dynamic binding.
 */
type StripStringIndex<T> = T extends unknown ? (HasStringIndex<T> extends true ? never : T) : never;

type IsDynamicShape<T> = [T] extends [never]
  ? false
  : ({path: string} extends T ? true : false) extends true
    ? true
    : ({'@path': string} extends T ? true : false) extends true
      ? true
      : ({call: string} extends T ? true : false) extends true
        ? true
        : ({'@call': string} extends T ? true : false) extends true
          ? true
          : DataBinding extends T
            ? true
            : FunctionCall extends T
              ? true
              : false;

/** Evaluates to true if type T can contain a dynamic binding. */
type IsDynamic<T> = 0 extends 1 & T
  ? true
  : unknown extends T
    ? false
    : IsDynamicShape<StripStringIndex<NonNullable<T>>>;

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
export type ResolveA2uiProp<T> = 0 extends 1 & T
  ? T
  : unknown extends T
    ? unknown
    : [NonNullable<T>] extends [ActionLike]
      ? HasStringIndex<NonNullable<T>> extends true
        ? StripDynamic<T>
        : ((options?: ActionDispatchOptions) => Promise<void>) | Extract<T, undefined>
      : IsChildList<T> extends true
        ? (string | ResolvedChildRef)[] | Extract<T, undefined>
        : IsDynamic<T> extends true
          ? [StripDynamic<NonNullable<T>>] extends [never]
            ? unknown
            : StripDynamic<T>
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
    value: [StripDynamic<NonNullable<T[K]>>] extends [never]
      ? unknown
      : StripDynamic<NonNullable<T[K]>>,
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
   * Creates a new binder for the given component context and canonical
   * {@link ComponentDefinition}, precomputed {@link BehaviorNode}, or legacy Zod schema.
   *
   * @param context Component context providing state and event dispatching.
   * @param schema Canonical ComponentDefinition, `{definition, types}` wrapper, BehaviorNode, or legacy Zod schema.
   * @param options Optional child-reference analysis options overriding protocol-version defaults.
   */
  constructor(
    context: ComponentContext,
    schema: GenericBinderTarget,
    options?: ChildRefAnalysisOptions,
  ) {
    this.context = context;
    if (isBehaviorNode(schema)) {
      this.behaviorTree = schema;
      this.mirrorsAccessibility = true;
    } else if (isComponentDefinition(schema)) {
      const catalogTypes = context.componentModel?.catalog?.types;
      this.behaviorTree = definitionToBehavior(schema, catalogTypes);
      this.mirrorsAccessibility = !definitionEnvelopeLayout(schema).customKeys.has('accessibility');
    } else if (
      typeof schema === 'object' &&
      schema !== null &&
      'definition' in schema &&
      (schema as {definition?: ComponentDefinition}).definition
    ) {
      const wrapper = schema as {
        definition: ComponentDefinition;
        types?: Readonly<Record<string, DataTypeDefinition>>;
      };
      this.behaviorTree = definitionToBehavior(
        wrapper.definition,
        wrapper.types ?? context.componentModel?.catalog?.types,
      );
      this.mirrorsAccessibility = !definitionEnvelopeLayout(wrapper.definition).customKeys.has(
        'accessibility',
      );
    } else {
      const legacySchema =
        typeof schema === 'object' && schema !== null && 'schema' in schema && !('_def' in schema)
          ? (schema as {schema?: unknown}).schema
          : schema;
      const resolvedOptions =
        options ??
        resolveChildRefOptions(
          context.componentModel?.catalog?.protocolVersion ??
            context.dataContext?.surface?.protocolVersion ??
            context.dataContext?.surface?.defaultCatalog?.protocolVersion,
        );
      this.behaviorTree = scrapeComponentBehavior(legacySchema, resolvedOptions);
      const layout = getLegacySchemaAdapter()?.componentMixinLayout(legacySchema);
      this.mirrorsAccessibility = !(layout?.customKeys.has('accessibility') ?? false);
    }
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
    const sub = this.context.componentModel.onUpdated?.subscribe(() => {
      this.rebuildAllBindings();
    });
    this.compUnsub = sub ? () => sub.unsubscribe() : undefined;
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
    const coerce = isBoolean ? coerceModelDynamicBoolean : (v: unknown) => v;
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

    if (Array.isArray(val)) return val.map(item => this.resolveDeepSync(item, depth + 1));
    if (!isPlainObject(val)) return val;
    if ('path' in val || 'call' in val || '@path' in val || '@call' in val) {
      return this.context.dataContext.resolveDynamicValue(val, depth);
    }
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
    const templatePath = typeof templateObj.path === 'string' ? templateObj.path : undefined;
    const templateComponentId =
      typeof templateObj.componentId === 'string' ? templateObj.componentId : undefined;

    if (!templatePath || !templateComponentId) {
      return value;
    }

    const atLeastV10 = this.context.dataContext.atLeastV10;
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
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return false;
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
