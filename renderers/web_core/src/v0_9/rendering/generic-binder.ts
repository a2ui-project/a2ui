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
import {ComponentContext} from './component-context.js';
import {Action, ChildList, DataBinding, FunctionCall} from '../schema/common-types.js';

// --- Schema Scraping ---

/**
 * Represents the intended runtime behavior of a property parsed from its Zod schema.
 *
 * - `DYNAMIC`: The property can be bound to the `DataModel` (e.g. `DynamicString`).
 *    The Binder will automatically subscribe to data changes and emit primitive values.
 * - `ACTION`: The property represents a user interaction (e.g. `Action`).
 *    The Binder will resolve deep payload bindings and output a ready-to-call `() => void` closure.
 * - `STRUCTURAL`: The property dictates the rendering of child components (e.g. `ChildList`).
 *    The Binder outputs lists of objects containing `{ id, basePath }` for structural layout.
 * - `CHECKABLE`: Special property for handling validation arrays (e.g. `checks`).
 *    The Binder will reactively evaluate the rules and inject `isValid` and `validationErrors` booleans into the parent object.
 * - `STATIC`: A primitive value that requires no reactive subscription or resolution.
 * - `OBJECT` / `ARRAY`: Recursive traversal nodes for complex nested schemas.
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
 * This allows the Generic Binder to know *how* to handle a piece of raw JSON
 * data without needing hardcoded logic for every specific component type.
 * It identifies core A2UI primitives (Dynamic values, Actions, ChildLists) by
 * inspecting the shape of ZodUnion objects defined in `common-types.ts`.
 */
export function scrapeSchemaBehavior(schema: z.ZodTypeAny): BehaviorNode {
  return getFieldBehavior(schema);
}

function getFieldBehavior(type: z.ZodTypeAny, propertyName?: string): BehaviorNode {
  let current = type;

  // Unwrap optionals/nullables/defaults
  while (
    current._def.typeName === 'ZodOptional' ||
    current._def.typeName === 'ZodNullable' ||
    current._def.typeName === 'ZodDefault'
  ) {
    current = current._def.innerType;
  }

  if (propertyName === 'checks') {
    return {type: 'CHECKABLE'};
  }

  // Structural matching for A2UI primitives using typeName to avoid dual-module instanceof issues
  if (current._def.typeName === 'ZodUnion') {
    const options = current._def.options as z.ZodTypeAny[];

    // ActionSchema is a union containing { event: ... }
    const isAction = options.some(o => o._def.typeName === 'ZodObject' && o._def.shape().event);
    if (isAction) return {type: 'ACTION'};

    // Dynamic strings/values are unions containing DataBindingSchema { path: ... } but NOT { componentId: ... }
    const isDynamic = options.some(
      o => o._def.typeName === 'ZodObject' && o._def.shape().path && !o._def.shape().componentId,
    );
    if (isDynamic) return {type: 'DYNAMIC'};

    // ChildList is a union containing an array and an object with { componentId, path }
    const isChildList = options.some(
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
      shape[key] = getFieldBehavior(value as z.ZodTypeAny, key);
    }
    return {type: 'OBJECT', shape};
  }

  // Fallback
  return {type: 'STATIC'};
}

// --- Generic Binder ---

type DynamicTypes = DataBinding | FunctionCall;
type IsDynamic<T> = DataBinding extends NonNullable<T> ? true : false;

/**
 * Maps raw Zod inferred types to their resolved runtime equivalents.
 * For example, an `Action` object becomes a callable `() => void` function.
 */
export type ResolveA2uiProp<T> = [NonNullable<T>] extends [Action]
  ? (() => void) | Extract<T, undefined>
  : [NonNullable<T>] extends [ChildList]
    ? any | Extract<T, undefined>
    : Exclude<T, DynamicTypes> extends never
      ? any
      : Exclude<T, DynamicTypes>;

/**
 * Automatically generates two-way binding setters for dynamic properties.
 * If a schema has a `value: DynamicString`, this type generates a `setValue(val: string)` method.
 */
export type GenerateSetters<T> = {
  [K in keyof T as IsDynamic<T[K]> extends true ? `set${Capitalize<string & K>}` : never]-?: (
    value: Exclude<NonNullable<T[K]>, DynamicTypes>,
  ) => void;
};

/**
 * The final output type of the Generic Binder, providing fully resolved, ready-to-use props.
 * This is what framework-specific adapters (like `createReactComponent`) pass to the developer's view logic.
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
 * The Generic Binder is a framework-agnostic engine that transforms raw A2UI JSON payload
 * configurations into a single, cohesive reactive stream of strongly-typed `ResolvedProps`.
 *
 * It solves the problem of manual state management: developers do not need to write
 * boilerplate code to subscribe to data paths, evaluate logic expressions, or tear down
 * listeners when components unmount.
 *
 * Usage Flow:
 * 1. Takes a `ComponentContext` (the raw JSON config) and a `Zod Schema` (the API definition).
 * 2. Uses `scrapeSchemaBehavior` to analyze the schema.
 * 3. Deeply iterates over the raw JSON properties, applying rules based on the scraped behavior.
 * 4. Subscribes to the `DataContext` for all `DYNAMIC` and `CHECKABLE` paths.
 * 5. Bundles the final resolved primitives, structural arrays, and executable Actions into `currentProps`.
 * 6. Exposes a `subscribe()` interface for framework-specific adapters (React, Angular) to listen to state changes.
 */
export class GenericBinder<T> {
  private dataListeners: (() => void)[] = [];
  private propsListeners: ((props: T) => void)[] = [];
  public currentProps: Partial<T> = {};
  private compUnsub?: () => void;
  private isConnected = false;

  private context: ComponentContext;
  private behaviorTree: BehaviorNode;

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
    const resolved = this.resolveAndBind(props, this.behaviorTree, [], true);
    this.currentProps = {...this.currentProps, ...resolved} as Partial<T>;
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

    const resolved = this.resolveAndBind(props, this.behaviorTree, [], false);
    this.currentProps = {...this.currentProps, ...resolved} as Partial<T>;

    this.notify();
  }

  private resolveAndBind(value: any, behavior: BehaviorNode, path: string[], isSync: boolean): any {
    if (value === undefined || value === null) return value;

    switch (behavior.type) {
      case 'DYNAMIC': {
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

      case 'ACTION': {
        return () => {
          const resolveDeepSync = (val: any): any => {
            if (typeof val !== 'object' || val === null) return val;
            if ('path' in val || 'call' in val)
              return this.context.dataContext.resolveDynamicValue(val);
            if (Array.isArray(val)) return val.map(resolveDeepSync);
            const res: any = {};
            for (const [k, v] of Object.entries(val)) res[k] = resolveDeepSync(v);
            return res;
          };
          this.context.dispatchAction(resolveDeepSync(value));
        };
      }

      case 'STRUCTURAL': {
        if (value && typeof value === 'object' && value.path && value.componentId) {
          const bound = this.context.dataContext.subscribeDynamicValue(
            {path: value.path},
            newVal => {
              const arr = Array.isArray(newVal) ? newVal : [];
              const listContext = this.context.dataContext.nested(value.path);
              const resolvedChildren = arr.map((_, i) => ({
                id: value.componentId,
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
          const listContext = this.context.dataContext.nested(value.path);
          return currentArr.map((_, i) => ({
            id: value.componentId,
            basePath: listContext.nested(String(i)).path,
          }));
        }
        return value;
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
          this.updateDeepValue([...parentPath, 'isValid' as any], errors.length === 0);
          this.updateDeepValue([...parentPath, 'validationErrors' as any], errors);
          this.notify();
        };

        rules.forEach((rule: any, index: number) => {
          const condition = rule.condition || rule; // Support both {condition, message} and direct logic expr if message is missing
          const message = rule.message || 'Validation failed';
          ruleResults[index].message = message;

          const bound = this.context.dataContext.subscribeDynamicValue(condition, newVal => {
            ruleResults[index].valid = !!newVal;
            updateValidationState();
          });

          if (!isSync) {
            this.dataListeners.push(() => bound.unsubscribe());
          } else {
            bound.unsubscribe();
          }
          ruleResults[index].valid = !!bound.value;
        });

        // Set initial state
        const initialErrors = ruleResults.filter(r => !r.valid).map(r => r.message);
        this.updateDeepValue([...parentPath, 'isValid' as any], initialErrors.length === 0);
        this.updateDeepValue([...parentPath, 'validationErrors' as any], initialErrors);

        return value; // The 'checks' property itself remains as the original rules array
      }

      case 'STATIC':
        return value;

      case 'ARRAY': {
        if (!Array.isArray(value)) return value;
        return value.map((item, index) =>
          this.resolveAndBind(item, behavior.element, [...path, index.toString()], isSync),
        );
      }

      case 'OBJECT': {
        if (typeof value !== 'object') return value;
        const result: any = {};

        // 1. Resolve all provided properties
        for (const [k, v] of Object.entries(value)) {
          const childBehavior = behavior.shape[k] || {type: 'STATIC'};
          result[k] = this.resolveAndBind(v, childBehavior, [...path, k], isSync);
        }

        // 2. Ensure all dynamic setters exist, even if the property wasn't provided in the payload
        for (const [k, childBehavior] of Object.entries(behavior.shape)) {
          if (childBehavior.type === 'DYNAMIC') {
            const setterName = `set${k.charAt(0).toUpperCase() + k.slice(1)}`;
            const rawPropValue = value[k];
            result[setterName] = (newValue: any) => {
              if (rawPropValue && typeof rawPropValue === 'object' && 'path' in rawPropValue) {
                this.context.dataContext.set((rawPropValue as any).path, newValue);
              }
            };
          }
        }

        return result;
      }
    }
  }

  private updateDeepValue(path: string[], newValue: any) {
    this.currentProps = this.cloneAndUpdate(this.currentProps, path, newValue);
  }

  private cloneAndUpdate(obj: any, path: string[], newValue: any): any {
    if (path.length === 0) return newValue;
    const [key, ...rest] = path;

    if (Array.isArray(obj)) {
      const newArr = [...obj];
      newArr[Number(key)] = this.cloneAndUpdate(newArr[Number(key)], rest, newValue);
      return newArr;
    } else {
      return {
        ...(obj || {}),
        [key]: this.cloneAndUpdate((obj || {})[key], rest, newValue),
      };
    }
  }

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

  get snapshot() {
    return this.currentProps as T;
  }
}
