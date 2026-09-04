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
import {ComponentContext} from './component-context.js';
import {Action, ChildList, DataBinding, childRefKindOf} from '../types/common-types.js';
import {extractRefDefName} from '../catalog/reference-map.js';

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
  | {type: 'DYNAMIC'}
  | {type: 'ACTION'}
  | {type: 'STRUCTURAL'}
  | {type: 'CHECKABLE'}
  | {type: 'STATIC'}
  | {type: 'OBJECT'; shape: Record<string, BehaviorNode>}
  | {type: 'ARRAY'; element: BehaviorNode};

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
  return getFieldBehavior(schema);
}

/**
 * Unwraps Zod wrapper schemas (ZodOptional, ZodNullable, ZodDefault,
 * ZodReadonly, ZodEffects) to retrieve the underlying inner schema type.
 *
 * @param type Zod schema to unwrap.
 * @returns The inner Zod schema.
 */
function unwrapZodSchema(type: z.ZodTypeAny): z.ZodTypeAny {
  let current: any = type;
  while (current) {
    const typeName = current._def?.typeName;
    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault' ||
      typeName === 'ZodReadonly'
    ) {
      current = current._def.innerType;
    } else if (typeName === 'ZodEffects') {
      current = current._def.schema;
    } else {
      break;
    }
  }
  return current;
}

/**
 * Extracts the definition name from a schema's REF: description, if present.
 *
 * @param type Zod schema to inspect.
 * @returns Target definition name, or an empty string.
 */
function getRefDefName(type: z.ZodTypeAny): string {
  const current: any = unwrapZodSchema(type);
  const desc: string = current?.description ?? current?._def?.description ?? '';
  if (!desc || !desc.startsWith('REF:')) return '';
  const cleanDesc = desc.slice(4);
  return extractRefDefName(cleanDesc.split('|')[0]);
}

/**
 * Checks whether a schema represents a checkable validation rule or list of rules.
 *
 * @param type Zod schema to inspect.
 * @returns Whether the schema represents a checkable field.
 */
function isCheckableField(type: z.ZodTypeAny): boolean {
  const current: any = unwrapZodSchema(type);

  const defName = getRefDefName(current);
  if (defName === 'Checkable' || defName === 'CheckRule') {
    return true;
  }

  if (current?._def?.typeName === 'ZodArray') {
    const elem = unwrapZodSchema(current._def.type);
    const elemDefName = getRefDefName(elem);
    if (elemDefName === 'CheckRule') {
      return true;
    }
  }

  return false;
}

/**
 * Recursively maps a Zod schema to its corresponding BehaviorNode.
 *
 * @param type Zod schema to inspect.
 * @returns Behavior node representing runtime handling for the schema.
 */
function getFieldBehavior(type: z.ZodTypeAny): BehaviorNode {
  const current: any = unwrapZodSchema(type);

  if (isCheckableField(current)) {
    return {type: 'CHECKABLE'};
  }

  const defName = getRefDefName(current);

  if (defName === 'Action') {
    return {type: 'ACTION'};
  }

  if (childRefKindOf(current) === 'child-list' || defName === 'ChildList') {
    return {type: 'STRUCTURAL'};
  }

  if (
    (defName === 'DataBinding' || defName.startsWith('Dynamic')) &&
    current._def.typeName !== 'ZodObject' &&
    current._def.typeName !== 'ZodArray'
  ) {
    return {type: 'DYNAMIC'};
  }

  // Structural matching for A2UI primitives using typeName to avoid dual-module instanceof issues
  if (current._def.typeName === 'ZodUnion') {
    const options = current._def.options as z.ZodTypeAny[];

    // ActionSchema is a union containing { event: ... }
    const isAction =
      options.some(o => getRefDefName(o) === 'Action') ||
      options.some(o => o._def.typeName === 'ZodObject' && o._def.shape().event);
    if (isAction) return {type: 'ACTION'};

    // Dynamic strings/values are unions containing DataBindingSchema { path: ... } but NOT { componentId: ... }
    const isDynamic =
      options.some(
        o => getRefDefName(o) === 'DataBinding' || getRefDefName(o).startsWith('Dynamic'),
      ) ||
      options.some(
        o => o._def.typeName === 'ZodObject' && o._def.shape().path && !o._def.shape().componentId,
      );
    if (isDynamic) return {type: 'DYNAMIC'};

    // ChildList is a union containing an array and an object with { componentId, path }
    const isChildList =
      options.some(o => childRefKindOf(o) === 'child-list' || getRefDefName(o) === 'ChildList') ||
      options.some(
        o => o._def.typeName === 'ZodObject' && o._def.shape().componentId && o._def.shape().path,
      );
    if (isChildList) return {type: 'STRUCTURAL'};
  } else if (current._def.typeName === 'ZodString') {
    // ComponentId falls back to STATIC since we can't perfectly identify it, which is fine because STATIC returns strings as-is.
  }

  // Recursive array scraping
  if (current._def.typeName === 'ZodArray') {
    return {
      type: 'ARRAY',
      element: getFieldBehavior(current._def.type),
    };
  }

  // Recursive object scraping
  if (current._def.typeName === 'ZodObject') {
    const shape: Record<string, BehaviorNode> = {};
    const objShape = current._def.shape();
    for (const [key, value] of Object.entries(objShape)) {
      shape[key] = getFieldBehavior(value as z.ZodTypeAny);
    }
    return {type: 'OBJECT', shape};
  }

  // Fallback
  return {type: 'STATIC'};
}

/** Types recognized as dynamic data bindings or expression function calls. */
type DynamicTypes =
  | DataBinding
  | {path: string}
  | {call: string; catalogId?: string; args?: Record<string, unknown>; returnType?: string};

/** Types recognized as user actions or function call events. */
type ActionLike =
  | Action
  | {event: {name: string; context?: Record<string, unknown>}}
  | {functionCall: {call: string; catalogId?: string; args?: Record<string, unknown>}};

/** Evaluates to true if type T can contain a dynamic binding. */
type IsDynamic<T> = DataBinding extends NonNullable<T> ? true : false;

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
 * For example, an `Action` object becomes a callable `() => void` function.
 */
export type ResolveA2uiProp<T> = [NonNullable<T>] extends [ActionLike]
  ? (() => void) | Extract<T, undefined>
  : [NonNullable<T>] extends [ChildList]
    ? (string | ResolvedChildRef)[] | Extract<T, undefined>
    : Exclude<T, DynamicTypes> extends never
      ? unknown
      : Exclude<T, DynamicTypes>;

/**
 * Generates two-way binding setters for dynamic properties.
 *
 * For example, a `value: DynamicString` property produces a `setValue(val: string)` setter.
 */
export type GenerateSetters<T> = {
  [K in keyof T as IsDynamic<T[K]> extends true ? `set${Capitalize<string & K>}` : never]-?: (
    value: Exclude<NonNullable<T[K]>, DynamicTypes>,
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
  };

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
  public currentProps: Partial<T> = {};
  private compUnsub?: () => void;
  private isConnected = false;

  private context: ComponentContext;
  private behaviorTree: BehaviorNode;
  // Actions resolve to closures, which downstream value comparison cannot
  // inspect; reusing the closure while the raw payload is unchanged keeps
  // unchanged action props reference-identical across rebuilds.
  private actionClosures = new Map<string, {raw: unknown; closure: () => void}>();

  /**
   * Creates a new binder for the given component context and schema.
   *
   * @param context Component context providing state and event dispatching.
   * @param schema Zod schema defining the component properties.
   */
  constructor(context: ComponentContext, schema: z.ZodTypeAny) {
    this.context = context;
    this.behaviorTree = scrapeSchemaBehavior(schema);

    if (this.behaviorTree.type !== 'OBJECT') {
      this.behaviorTree = {type: 'OBJECT', shape: {}};
    }

    this.resolveInitialProps();
  }

  private resolveInitialProps() {
    const props = this.context.componentModel.properties;
    const resolved = this.resolveAndBind(props, this.behaviorTree, [], true) as
      | Record<string, unknown>
      | undefined;
    this.currentProps = {...this.currentProps, ...(resolved || {})} as Partial<T>;
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

    const resolved = this.resolveAndBind(props, this.behaviorTree, [], false) as
      | Record<string, unknown>
      | undefined;
    this.currentProps = {...this.currentProps, ...(resolved || {})} as Partial<T>;

    this.notify();
  }

  private bindDynamicValue(value: unknown, path: string[], isSync: boolean): unknown {
    const bound = this.context.dataContext.subscribeDynamicValue(value, newVal => {
      this.updateDeepValue(path, newVal);
      this.notify();
    });

    if (!isSync) {
      this.dataListeners.push(() => bound.unsubscribe());
    } else {
      bound.unsubscribe();
    }
    return bound.value;
  }

  private bindAction(value: unknown, path: string[]): () => void {
    const cacheKey = path.join('/');
    const cached = this.actionClosures.get(cacheKey);
    if (cached && jsonEquals(cached.raw, value)) {
      return cached.closure;
    }
    const closure = () => {
      const resolveDeepSync = (val: unknown): unknown => {
        if (typeof val !== 'object' || val === null) return val;
        if ('path' in val || 'call' in val) {
          return this.context.dataContext.resolveDynamicValue(val);
        }
        if (Array.isArray(val)) return val.map(resolveDeepSync);
        const res: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val)) res[k] = resolveDeepSync(v);
        return res;
      };
      this.context.dispatchAction(resolveDeepSync(value) as Action | Record<string, unknown>);
    };
    this.actionClosures.set(cacheKey, {raw: value, closure});
    return closure;
  }

  private bindStructuralTemplate(
    value: unknown,
    path: string[],
    isSync: boolean,
  ): ResolvedChildRef[] | unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const templateObj = value as Record<string, unknown>;
      const templatePath = typeof templateObj.path === 'string' ? templateObj.path : undefined;
      const templateComponentId =
        typeof templateObj.componentId === 'string' ? templateObj.componentId : undefined;
      if (templatePath && templateComponentId) {
        const bound = this.context.dataContext.subscribeDynamicValue(
          {path: templatePath},
          newVal => {
            const arr = Array.isArray(newVal) ? newVal : [];
            const listContext = this.context.dataContext.nested(templatePath);
            const resolvedChildren: ResolvedChildRef[] = arr.map((_, i) => ({
              id: templateComponentId,
              basePath: listContext.nested(String(i)).path,
            }));
            this.updateDeepValue(path, resolvedChildren);
            this.notify();
          },
        );

        if (!isSync) {
          this.dataListeners.push(() => bound.unsubscribe());
        } else {
          bound.unsubscribe();
        }

        const currentArr = Array.isArray(bound.value) ? bound.value : [];
        const listContext = this.context.dataContext.nested(templatePath);
        return currentArr.map((_, i) => ({
          id: templateComponentId,
          basePath: listContext.nested(String(i)).path,
        }));
      }
    }
    return value;
  }

  private resolveAndBind(
    value: unknown,
    behavior: BehaviorNode,
    path: string[],
    isSync: boolean,
  ): unknown {
    if (value === undefined || value === null) return value;

    switch (behavior.type) {
      case 'DYNAMIC': {
        return this.bindDynamicValue(value, path, isSync);
      }

      case 'ACTION': {
        return this.bindAction(value, path);
      }

      case 'STRUCTURAL': {
        return this.bindStructuralTemplate(value, path, isSync);
      }

      case 'CHECKABLE': {
        const rules = Array.isArray(value) ? value : [];
        const ruleResults: {valid: boolean; message: string}[] = rules.map(() => ({
          valid: true,
          message: '',
        }));

        const parentPath = path.slice(0, -1);
        const updateValidationState = () => {
          const errors = ruleResults.filter(r => !r.valid).map(r => r.message);
          this.updateDeepValue([...parentPath, 'isValid'], errors.length === 0);
          this.updateDeepValue([...parentPath, 'validationErrors'], errors);
          this.notify();
        };

        rules.forEach((rule: unknown, index: number) => {
          const ruleObj =
            typeof rule === 'object' && rule !== null
              ? (rule as Record<string, unknown>)
              : undefined;
          const condition = ruleObj && ruleObj.condition !== undefined ? ruleObj.condition : rule;
          const message =
            typeof ruleObj?.message === 'string' ? ruleObj.message : 'Validation failed';
          ruleResults[index].message = message;

          const extractResult = (val: unknown) => {
            if (typeof val === 'object' && val !== null && 'valid' in val) {
              ruleResults[index].valid = Boolean((val as {valid: unknown}).valid);
              const customMessage = (val as {message?: unknown}).message;
              ruleResults[index].message =
                customMessage !== undefined && customMessage !== null
                  ? String(customMessage)
                  : message;
            } else {
              ruleResults[index].valid = Boolean(val);
              ruleResults[index].message = message;
            }
          };

          const bound = this.context.dataContext.subscribeDynamicValue(condition, newVal => {
            extractResult(newVal);
            updateValidationState();
          });

          if (!isSync) {
            this.dataListeners.push(() => bound.unsubscribe());
          } else {
            bound.unsubscribe();
          }
          extractResult(bound.value);
        });

        // Set initial state
        const initialErrors = ruleResults.filter(r => !r.valid).map(r => r.message);
        this.updateDeepValue([...parentPath, 'isValid'], initialErrors.length === 0);
        this.updateDeepValue([...parentPath, 'validationErrors'], initialErrors);

        return value;
      }

      case 'STATIC': {
        return value;
      }

      case 'ARRAY': {
        if (!Array.isArray(value)) return value;
        return value.map((item, index) =>
          this.resolveAndBind(item, behavior.element, [...path, index.toString()], isSync),
        );
      }

      case 'OBJECT': {
        if (typeof value !== 'object') return value;
        const valObj = value as Record<string, unknown>;
        const result: Record<string, unknown> = {};

        // 1. Resolve all provided properties
        for (const [k, v] of Object.entries(valObj)) {
          const childBehavior = behavior.shape[k] || {type: 'STATIC'};
          result[k] = this.resolveAndBind(v, childBehavior, [...path, k], isSync);
        }

        // 2. Ensure all dynamic setters exist, even if the property wasn't provided in the payload
        for (const [k, childBehavior] of Object.entries(behavior.shape)) {
          if (childBehavior.type === 'DYNAMIC') {
            const setterName = `set${k.charAt(0).toUpperCase() + k.slice(1)}`;
            const rawPropValue = valObj[k];
            result[setterName] = (newValue: unknown) => {
              if (rawPropValue && typeof rawPropValue === 'object' && 'path' in rawPropValue) {
                const pathVal = (rawPropValue as {path: unknown}).path;
                if (typeof pathVal === 'string') {
                  this.context.dataContext.set(pathVal, newValue);
                }
              }
            };
          }
        }

        return result;
      }
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
