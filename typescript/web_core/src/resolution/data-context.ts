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

import {
  signal,
  computed,
  Signal,
  effect,
  isSignal,
  getValue,
  setValue,
  peekValue,
} from '../reactivity/signals.js';
import {z} from 'zod';
import {DataModel, DataSubscription} from '../state/data-model.js';
import {
  type DataBinding,
  type FunctionCall,
  type Action,
  MAX_FUNCTION_CALL_ARGS,
} from '../types/common-types.js';
import {A2uiCatalogError, A2uiExpressionError} from '../errors.js';

import {FunctionInvoker} from '../catalog/function_invoker.js';
import {SurfaceModel} from '../state/surface-model.js';

import {Catalog, CatalogInterface} from '../catalog/types.js';

const schemaKeysCache = new WeakMap<z.ZodTypeAny, Set<string> | null>();

/**
 * Extracts declared property keys from a Zod schema representing an object with fixed keys.
 *
 * Traverses Zod wrappers (`ZodEffects`, `ZodOptional`, `ZodNullable`, `ZodDefault`,
 * `ZodCatch`, `ZodIntersection`, `ZodUnion`) and returns the set of allowed key names.
 *
 * @param schema Zod schema to inspect.
 * @returns Set of allowed property names, or `null` if arbitrary keys are permitted or undetermined.
 */
export function getKnownSchemaKeys(schema: z.ZodTypeAny): Set<string> | null {
  if (schemaKeysCache.has(schema)) {
    return schemaKeysCache.get(schema) as Set<string> | null;
  }

  const result = ((): Set<string> | null => {
    let current: any = schema;
    while (current) {
      if (current instanceof z.ZodObject || current._def?.typeName === 'ZodObject') {
        // If passthrough is enabled, arbitrary keys are allowed.
        if (current._def?.unknownKeys === 'passthrough') {
          return null;
        }
        const shape = typeof current.shape === 'function' ? current.shape() : current.shape;
        if (shape && typeof shape === 'object') {
          return new Set(Object.keys(shape));
        }
        return null;
      }
      if (current instanceof z.ZodEffects || current._def?.typeName === 'ZodEffects') {
        current = current._def.schema;
        continue;
      }
      if (
        current instanceof z.ZodOptional ||
        current instanceof z.ZodNullable ||
        current._def?.typeName === 'ZodOptional' ||
        current._def?.typeName === 'ZodNullable'
      ) {
        current = current._def.innerType;
        continue;
      }
      if (current instanceof z.ZodDefault || current._def?.typeName === 'ZodDefault') {
        current = current._def.innerType;
        continue;
      }
      if (current instanceof z.ZodCatch || current._def?.typeName === 'ZodCatch') {
        current = current._def.innerType;
        continue;
      }
      if (current instanceof z.ZodIntersection || current._def?.typeName === 'ZodIntersection') {
        const leftKeys = getKnownSchemaKeys(current._def.left);
        const rightKeys = getKnownSchemaKeys(current._def.right);
        if (!leftKeys || !rightKeys) {
          return null;
        }
        return new Set([...leftKeys, ...rightKeys]);
      }
      if (current instanceof z.ZodUnion || current._def?.typeName === 'ZodUnion') {
        const options: z.ZodTypeAny[] = current._def.options;
        const allKeys = new Set<string>();
        for (const opt of options) {
          const k = getKnownSchemaKeys(opt);
          if (!k) return null; // If any union branch allows arbitrary keys, do not filter.
          for (const key of k) {
            allKeys.add(key);
          }
        }
        return allKeys;
      }
      return null;
    }
    return null;
  })();

  schemaKeysCache.set(schema, result);
  return result;
}

/**
 * Validates a function call's arguments against the catalog function schema and global limits.
 *
 * Functions have a strict contract: supplying unknown or excessive arguments breaks that contract
 * and causes an A2uiExpressionError rather than silently stripping them. Validating arguments before
 * creating reactive nodes also prevents uncontrolled resource consumption.
 *
 * @param functionName Name of the function being validated.
 * @param rawArgs Raw argument map to validate against the function schema.
 * @param catalog Optional catalog providing the function's schema.
 * @throws {A2uiExpressionError} If argument count exceeds `MAX_FUNCTION_CALL_ARGS`, unknown arguments are supplied, or arguments exceed expected count.
 */
export function validateFunctionArgs(
  functionName: string,
  rawArgs: Record<string, any> | undefined | null,
  catalog?: CatalogInterface<any, any> | any,
): void {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    return;
  }

  const suppliedKeys = Object.keys(rawArgs);
  if (suppliedKeys.length > MAX_FUNCTION_CALL_ARGS) {
    throw new A2uiExpressionError(
      `Function call '${functionName}' exceeds maximum allowed arguments count (${MAX_FUNCTION_CALL_ARGS})`,
      functionName,
    );
  }

  const fn = catalog?.functions?.get?.(functionName);
  if (!fn?.schema) {
    return;
  }

  const knownKeys = getKnownSchemaKeys(fn.schema);
  if (!knownKeys) {
    // Schema allows arbitrary keys (e.g. passthrough)
    return;
  }

  for (const key of suppliedKeys) {
    if (!knownKeys.has(key)) {
      throw new A2uiExpressionError(
        `Unknown argument '${key}' passed to function '${functionName}'`,
        functionName,
      );
    }
  }

  if (suppliedKeys.length > knownKeys.size) {
    throw new A2uiExpressionError(
      `Too many arguments for function '${functionName}': expected at most ${knownKeys.size}, received ${suppliedKeys.length}`,
      functionName,
    );
  }
}

/**
 * Resolves the 0-based iteration index from a context or its ancestor chain.
 *
 * Checks for an explicit index first, then checks whether the trailing
 * segment of the data path is numeric, walking the parent context chain until a
 * match is found.
 *
 * @param startCtx Initial context or context-like object to inspect.
 * @returns The resolved 0-based iteration index, or `undefined` if outside an iteration scope.
 */
export function resolveContextIndex(startCtx: unknown): number | undefined {
  let ctx = startCtx as
    | {
        explicitIndex?: number;
        getIndex?: () => number | undefined;
        index?: number;
        path?: string;
        parent?: unknown;
      }
    | undefined;
  while (ctx) {
    if (ctx.explicitIndex !== undefined && Number.isFinite(ctx.explicitIndex)) {
      return ctx.explicitIndex;
    }
    if (!(ctx instanceof DataContext) && typeof ctx.getIndex === 'function') {
      const idx = ctx.getIndex();
      if (idx !== undefined && Number.isFinite(idx)) {
        return idx;
      }
    }
    if (
      !(ctx instanceof DataContext) &&
      typeof ctx.index === 'number' &&
      Number.isFinite(ctx.index)
    ) {
      return ctx.index;
    }
    if (typeof ctx.path === 'string') {
      const parts = ctx.path.split('/').filter(Boolean);
      if (parts.length > 0 && /^\d+$/.test(parts[parts.length - 1])) {
        return parseInt(parts[parts.length - 1], 10);
      }
    }
    ctx = ctx.parent as typeof ctx;
  }
  return undefined;
}

/**
 * The maximum allowed recursion depth for evaluating nested dynamic values or function calls.
 * Prevents call stack exhaustion on deeply nested expression payloads.
 */
export const MAX_DYNAMIC_VALUE_DEPTH = 1_000;

/**
 * Scoped view of the main DataModel for resolving DynamicValues within a component hierarchy.
 *
 * Automatically resolves relative paths against the component's current scope
 * and provides tools for evaluating complex, reactive expressions.
 */
export class DataContext {
  /** Shared DataModel instance for the UI surface. */
  readonly dataModel: DataModel;
  /** Callback for executing function calls defined in the A2UI component tree. */
  readonly functionInvoker: FunctionInvoker;
  /** Parent DataContext in the hierarchy, if this context was created via `.nested()`. */
  readonly parent?: DataContext;
  /** Explicit collection iteration index supplied to this context, if any. */
  readonly explicitIndex?: number;
  private readonly warnedPaths: Set<string>;

  /**
   * Initializes a new DataContext instance.
   *
   * @param surface The surface model this context belongs to.
   * @param path The absolute path in the DataModel that this context is scoped to.
   * @param index Optional explicit collection iteration index.
   * @param parent Optional parent DataContext in the scope chain.
   */
  constructor(
    readonly surface: SurfaceModel<any>,
    readonly path: string,
    index?: number,
    parent?: DataContext,
  ) {
    this.dataModel = surface.dataModel;
    this.functionInvoker = surface.defaultCatalog.invoker;
    this.explicitIndex = index;
    this.parent = parent;
    this.warnedPaths = parent ? parent.warnedPaths : new Set<string>();
  }

  /**
   * Returns the 0-based iteration index if this context (or an ancestor context)
   * is scoped to a collection template item, or `undefined` when outside any
   * collection template scope.
   *
   * Mirrors `DataContext.index` in Python: checks an explicit `explicitIndex` first,
   * then checks strictly the trailing segment of `ctx.path`, walking `ctx.parent`.
   *
   * @returns The 0-based iteration index, or `undefined` if outside an iteration scope.
   */
  getIndex(): number | undefined {
    return resolveContextIndex(this);
  }

  /** Active iteration index if inside a collection template scope, or `undefined`. */
  get index(): number | undefined {
    return this.getIndex();
  }

  /**
   * Mutates the underlying DataModel at the specified path.
   *
   * @param path JSON pointer path, resolved relative to this context's `path` if not absolute.
   * @param value New value to store in the DataModel.
   */
  set(path: string, value: unknown): void {
    const absolutePath = this.resolvePath(path);
    this.dataModel.set(absolutePath, value);
  }

  /**
   * Checks whether an object represents a data binding.
   *
   * @param val Candidate object to inspect.
   * @returns Whether the object has a string `path` and is not a component reference.
   */
  private static isDataBindingObject(val: Record<string, unknown>): boolean {
    return 'path' in val && typeof val.path === 'string' && !('componentId' in val);
  }

  /**
   * Checks whether an object represents a function call.
   *
   * @param val Candidate object to inspect.
   * @returns Whether the object has a string `call` property.
   */
  private static isFunctionCallObject(val: Record<string, unknown>): boolean {
    return 'call' in val && typeof val.call === 'string';
  }

  /**
   * Checks whether a value contains any dynamic parts (path bindings or
   * function calls) at any nesting depth that require resolution.
   *
   * @param value The value or data structure to inspect.
   * @returns Whether the value contains any dynamic path bindings or function calls.
   */
  private static containsDynamicValue(value: unknown): boolean {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    if (Array.isArray(value)) {
      return value.some(item => DataContext.containsDynamicValue(item));
    }
    const rec = value as Record<string, unknown>;
    if (DataContext.isDataBindingObject(rec) || DataContext.isFunctionCallObject(rec)) {
      return true;
    }
    return Object.values(rec).some(v => DataContext.containsDynamicValue(v));
  }

  /**
   * Emits a warning if a data binding path does not exist in the data model.
   *
   * @param absolutePath Absolute JSON pointer path to check.
   */
  private emitMissingDataBindingWarning(absolutePath: string): void {
    if (
      typeof this.dataModel?.hasPath === 'function' &&
      !this.dataModel.hasPath(absolutePath) &&
      !this.warnedPaths.has(absolutePath)
    ) {
      this.warnedPaths.add(absolutePath);
      void this.surface?.dispatchWarning?.({
        code: 'MISSING_DATA_BINDING',
        path: absolutePath,
        message: `Preflight DataBinding Warning: The bound JSON Pointer '${absolutePath}' does not physically exist in the active DataModel. Evaluating to None.`,
      });
    }
  }

  /**
   * Synchronously evaluates a DynamicValue into its concrete runtime value.
   *
   * Evaluates the value once at the current moment without creating reactive subscriptions.
   * Use `subscribeDynamicValue` for reactive updates.
   * @param value The DynamicValue object or raw value from the A2UI JSON payload.
   * @param depth The current recursion depth when evaluating nested arguments or expressions.
   * @returns The synchronously resolved value.
   */
  resolveDynamicValue<V>(value: unknown, depth = 0): V {
    if (depth > MAX_DYNAMIC_VALUE_DEPTH) {
      const err = new A2uiExpressionError(
        `Maximum dynamic value nesting depth exceeded (${MAX_DYNAMIC_VALUE_DEPTH})`,
      );
      this.dispatchExpressionError(err, 'DynamicValue');
      return undefined as any;
    }

    if (value === null || typeof value !== 'object') {
      return value as V;
    }

    if (Array.isArray(value)) {
      if (!DataContext.containsDynamicValue(value)) {
        return value as V;
      }
      return value.map(item => this.resolveDynamicValue(item, depth + 1)) as V;
    }

    const rec = value as Record<string, unknown>;

    if (DataContext.isDataBindingObject(rec)) {
      const absolutePath = this.resolvePath((value as DataBinding).path);
      const val = this.dataModel.get(absolutePath);
      if (val === undefined) {
        this.emitMissingDataBindingWarning(absolutePath);
      }
      return val as V;
    }

    if (DataContext.isFunctionCallObject(rec)) {
      return this.resolveFunctionCallValue<V>(value as FunctionCall, depth);
    }

    return this.resolvePlainObjectValue<V>(rec, depth);
  }

  /**
   * Resolves a function call by validating arguments and invoking the function.
   *
   * @param call Function call definition to execute.
   * @param depth Current recursion depth for nested expression tracking.
   * @returns The resolved function return value.
   */
  private resolveFunctionCallValue<V>(call: FunctionCall, depth = 0): V {
    let targetCatalog: Catalog<any>;
    try {
      // Resolve before validating: the arguments must be checked against the
      // catalog that will actually run the call, not the surface default.
      targetCatalog = this.resolveFunctionCatalog(call.catalogId);
      validateFunctionArgs(call.call, call.args, targetCatalog);
    } catch (e: unknown) {
      this.dispatchExpressionError(e, call.call);
      return undefined as V;
    }
    const args: Record<string, unknown> = {};
    for (const [key, argVal] of Object.entries(call.args ?? {})) {
      args[key] = this.resolveDynamicValue(argVal, depth + 1);
    }

    const abortController = new AbortController();
    const result = this.evaluateFunctionReactive<V>(
      call.call,
      args,
      abortController.signal,
      call.catalogId,
      targetCatalog.invoker,
    );

    if (result === undefined) {
      return undefined as unknown as V;
    }

    return (isSignal(result) ? peekValue(result) : result) as V;
  }

  /**
   * Recursively resolves dynamic values nested inside a plain object.
   *
   * @param rec Plain object dictionary to resolve.
   * @param depth Current recursion depth for nested expression tracking.
   * @returns A copy of the object with all nested dynamic values resolved.
   */
  private resolvePlainObjectValue<V>(rec: Record<string, unknown>, depth = 0): V {
    if (!DataContext.containsDynamicValue(rec)) {
      return rec as unknown as V;
    }
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      resolved[k] = this.resolveDynamicValue(v, depth + 1);
    }
    return resolved as unknown as V;
  }

  /**
   * Reactively listens to changes in a DynamicValue.
   *
   * Whenever the underlying data or function dependencies change, the `onChange`
   * callback fires with the freshly evaluated result.
   *
   * @template V Expected type of the resolved value.
   * @param value The DynamicValue or raw value to evaluate and observe.
   * @param onChange Callback fired whenever the evaluated result changes.
   * @returns A subscription containing the current value and an `unsubscribe` method.
   */
  subscribeDynamicValue<V>(
    value: unknown,
    onChange: (value: V | undefined) => void,
  ): DataSubscription<V> {
    const sig = this.resolveSignal<V>(value);

    let isSync = true;
    let currentValue = peekValue(sig);

    const dispose = effect(() => {
      const val = getValue(sig);
      currentValue = val;
      if (!isSync) {
        onChange(val);
      }
    });
    isSync = false;

    return {
      get value() {
        return currentValue;
      },
      unsubscribe: () => {
        dispose();
        sig.unsubscribe?.();
      },
    };
  }

  /**
   * Resolves a DynamicValue into a reactive Signal.
   *
   * Recursively resolves any nested path bindings or function calls into a
   * single reactive `Signal`. Changes to underlying data or function dependencies
   * cause the signal's value to update.
   *
   * @template V Expected type of the signal value.
   * @param value The DynamicValue or raw value to evaluate and observe.
   * @param depth The current recursion depth when evaluating nested arguments or expressions.
   * @returns A reactive Signal containing the result of the evaluation.
   */
  resolveSignal<V>(value: unknown, depth = 0): Signal<V> {
    if (depth > MAX_DYNAMIC_VALUE_DEPTH) {
      const err = new A2uiExpressionError(
        `Maximum dynamic value nesting depth exceeded (${MAX_DYNAMIC_VALUE_DEPTH})`,
      );
      this.dispatchExpressionError(
        err,
        typeof value === 'object' && value && 'call' in value
          ? (value as FunctionCall).call
          : 'DynamicValue',
      );
      return signal(undefined as unknown as V);
    }

    // 1. Primitive literals
    if (typeof value !== 'object' || value === null) {
      return signal(value as V);
    }

    // 1b. Arrays: each element may itself be a DynamicValue (e.g. `and`/`or` `values`)
    if (Array.isArray(value)) {
      // Fast path: fully static arrays need no per-element signals.
      if (!DataContext.containsDynamicValue(value)) {
        return signal(value as V);
      }
      const itemSignals = value.map(item => this.resolveSignal(item, depth + 1));
      const resultSig = computed(() => itemSignals.map(s => getValue(s))) as Signal<V>;
      resultSig.unsubscribe = () => {
        for (const s of itemSignals) {
          s.unsubscribe?.();
        }
      };
      return resultSig;
    }

    const rec = value as Record<string, unknown>;

    // 2. Path Check
    if (DataContext.isDataBindingObject(rec)) {
      const absolutePath = this.resolvePath((value as DataBinding).path);
      this.emitMissingDataBindingWarning(absolutePath);
      return this.dataModel.getSignal<V>(absolutePath) as Signal<V>;
    }

    // 3. Function Call
    if (DataContext.isFunctionCallObject(rec)) {
      const call = value as FunctionCall;
      let targetCatalog: Catalog<any>;
      try {
        // Resolve before validating: the arguments must be checked against the
        // catalog that will actually run the call, not the surface default.
        targetCatalog = this.resolveFunctionCatalog(call.catalogId);
        validateFunctionArgs(call.call, call.args, targetCatalog);
      } catch (e: unknown) {
        this.dispatchExpressionError(e, call.call);
        return signal(undefined as unknown as V);
      }
      const argSignals: Record<string, Signal<unknown>> = {};

      for (const [key, argVal] of Object.entries(call.args ?? {})) {
        argSignals[key] = this.resolveSignal(argVal, depth + 1);
      }

      if (Object.keys(argSignals).length === 0) {
        const abortController = new AbortController();
        const result = this.evaluateFunctionReactive<V>(
          call.call,
          {},
          abortController.signal,
          call.catalogId,
          targetCatalog.invoker,
        );
        const sig = isSignal(result) ? result : signal(result as V);
        sig.unsubscribe = () => abortController.abort();
        return sig;
      }

      const keys = Object.keys(argSignals);
      const resultSig = signal<V | undefined>(undefined);
      let abortController: AbortController | undefined;
      let innerUnsubscribe: (() => void) | undefined;

      const argsSig = computed(() => {
        const argsRecord: Record<string, unknown> = {};
        for (let i = 0; i < keys.length; i++) {
          argsRecord[keys[i]] = getValue(argSignals[keys[i]]);
        }
        return argsRecord;
      });

      const stopper = effect(() => {
        try {
          const args = getValue(argsSig);

          if (abortController) abortController.abort();
          if (innerUnsubscribe) {
            innerUnsubscribe();
            innerUnsubscribe = undefined;
          }
          abortController = new AbortController();

          const res = this.evaluateFunctionReactive<V>(
            call.call,
            args,
            abortController.signal,
            call.catalogId,
            targetCatalog.invoker,
          );

          if (isSignal(res)) {
            innerUnsubscribe = effect(() => {
              setValue(resultSig, getValue(res));
            });
          } else {
            setValue(resultSig, res);
          }
        } catch (e: unknown) {
          this.dispatchExpressionError(e, call.call);
          // In reactive mode, we should not throw. Instead, reset the signal value.
          setValue(resultSig, undefined);
        }
      });

      resultSig.unsubscribe = () => {
        stopper();
        if (innerUnsubscribe) innerUnsubscribe();
        if (abortController) abortController.abort();
        for (let i = 0; i < keys.length; i++) {
          argSignals[keys[i]].unsubscribe?.();
        }
      };

      return resultSig as unknown as Signal<V>;
    }

    if (!DataContext.containsDynamicValue(rec)) {
      return signal(value as unknown as V);
    }

    const entrySignals = Object.entries(rec).map(([k, v]) => [k, this.resolveSignal(v)] as const);
    const objSig = computed(() => {
      const resolved: Record<string, unknown> = {};
      for (const [k, s] of entrySignals) {
        resolved[k] = getValue(s);
      }
      return resolved as unknown as V;
    }) as Signal<V>;
    const prevUnsubscribe = objSig.unsubscribe?.bind(objSig);
    objSig.unsubscribe = () => {
      prevUnsubscribe?.();
      for (const [, s] of entrySignals) {
        s.unsubscribe?.();
      }
    };
    return objSig;
  }

  /**
   * Resolves an action by evaluating its top-level dynamic values.
   *
   * For event actions, resolves each value in the context map.
   * For function call actions, evaluates the function call.
   *
   * @param action The Action object to resolve.
   * @returns The resolved action payload or function execution result.
   */
  resolveAction(action: Action): Action | unknown {
    if ('event' in action) {
      const resolvedContext: Record<string, unknown> = {};
      if (action.event.context) {
        for (const [key, value] of Object.entries(action.event.context)) {
          resolvedContext[key] = this.resolveDynamicValue(value);
        }
      }
      return {
        event: {
          ...action.event,
          context: resolvedContext,
        },
      };
    }
    if ('functionCall' in action) {
      return this.resolveDynamicValue(action.functionCall);
    }
    return action;
  }

  /**
   * Resolves the catalog against which a function call executes.
   *
   * @param catalogId Identifier of the catalog named by the call, if specified.
   * @returns The resolved Catalog instance, or the surface default catalog if omitted.
   * @throws {A2uiCatalogError} If the call names a catalog ID that cannot be
   *   resolved on this surface. This is reported as a catalog fault rather than
   *   a missing function, since the function may exist in a catalog that is not
   *   available here.
   */
  private resolveFunctionCatalog(catalogId?: string): Catalog<any> {
    if (catalogId === undefined) {
      return this.surface.defaultCatalog;
    }
    const target = this.surface.availableCatalogs?.get(catalogId);
    if (!target) {
      throw new A2uiCatalogError(`Catalog not found: ${catalogId}`);
    }
    return target;
  }

  /**
   * Evaluates a catalog function and returns its reactive Signal or static value.
   *
   * Resolves the appropriate function invoker from the specified catalog or
   * surface default, invokes the function with this context, and dispatches an
   * expression error if execution throws.
   *
   * @template V Expected return type of the function evaluation.
   * @param name Name of the function to evaluate.
   * @param args Resolved arguments to pass to the function.
   * @param abortSignal Optional abort signal to cancel asynchronous execution.
   * @param catalogId Optional catalog ID override declaring the function.
   * @param resolvedInvoker Optional pre-resolved function invoker to avoid redundant catalog lookup.
   * @returns The evaluated result as a reactive `Signal` or static value, or `undefined` on failure.
   */
  private evaluateFunctionReactive<V>(
    name: string,
    args: Record<string, unknown>,
    abortSignal?: AbortSignal,
    catalogId?: string,
    resolvedInvoker?: FunctionInvoker,
  ): Signal<V> | V {
    const invoker =
      resolvedInvoker ??
      (catalogId === undefined
        ? this.functionInvoker
        : this.resolveFunctionCatalog(catalogId).invoker);
    try {
      return invoker(name, args, this, abortSignal) as Signal<V> | V;
    } catch (e: unknown) {
      this.dispatchExpressionError(e, name);
      return undefined as unknown as V;
    }
  }

  private dispatchExpressionError(e: unknown, name: string): void {
    if (
      e instanceof z.ZodError ||
      (typeof e === 'object' && e !== null && (e as {name?: string}).name === 'ZodError')
    ) {
      const zodErr = e as z.ZodError;
      const err = new A2uiExpressionError(
        `Validation failed for function '${name}': ${zodErr.message}`,
        name,
        zodErr.errors ?? (zodErr as unknown as {issues?: unknown}).issues,
      );
      this.surface.dispatchError({
        code: 'EXPRESSION_ERROR',
        message: err.message,
        expression: name,
        details: err.details,
      });
    } else if (e instanceof A2uiExpressionError) {
      this.surface.dispatchError({
        code: 'EXPRESSION_ERROR',
        message: e.message,
        expression: e.expression,
        details: e.details,
      });
    } else {
      const errObj = typeof e === 'object' && e !== null ? (e as {message?: string}) : {};
      this.surface.dispatchError({
        code: 'EXPRESSION_ERROR',
        message: errObj.message ?? `An unexpected error occurred in function ${name}.`,
        expression: name,
      });
    }
  }

  /**
   * Creates a child DataContext scoped to a deeper relative path.
   *
   * @param relativePath The path relative to the current context's path.
   * @param index Optional explicit iteration index for this nested scope.
   * @returns A new DataContext instance pointing to the resolved absolute path.
   */
  nested(relativePath: string, index?: number): DataContext {
    const newPath = this.resolvePath(relativePath);
    return new DataContext(this.surface, newPath, index, this);
  }

  private resolvePath(path: string): string {
    if (path.startsWith('/')) {
      return path;
    }
    if (path === '' || path === '.') {
      return this.path;
    }

    let base = this.path;
    if (base.endsWith('/') && base.length > 1) {
      base = base.slice(0, -1);
    }
    if (base === '/') base = '';

    return `${base}/${path}`;
  }
}
