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
import {type FunctionCall, type Action} from '../types/common-types.js';
import {MAX_FUNCTION_CALL_ARGS} from '../types/helpers.js';
import {A2uiCatalogError, A2uiExpressionError, A2uiValidationError} from '../errors.js';
import {isAtLeastVersion} from '../common/semver.js';

import {FunctionInvoker} from '../catalog/function_invoker.js';
import {resolveSurfaceCatalog} from '../state/resolve-surface-catalog.js';
import {SurfaceModel} from '../state/surface-model.js';

import {Catalog, CatalogInterface} from '../catalog/types.js';
import {SpecVersion} from '../spec_versions.js';
import {IndexApi, SYSTEM_FUNCTIONS} from '../v1_0/functions/system_functions.js';

const schemaKeysCache = new WeakMap<z.ZodTypeAny, Set<string> | null>();

/** Identifier of the built-in catalog holding the v1.0 system functions. */
const SYSTEM_FUNCTION_CATALOG_ID = 'a2ui:system-functions';

let systemFunctionCatalog: Catalog<any> | undefined;

/**
 * Returns the built-in catalog of reserved `@`-prefixed system functions.
 *
 * System functions such as `@index` belong to no catalog, so they are run
 * from here rather than from a catalog resolved on the surface. Built lazily
 * because `SYSTEM_FUNCTIONS` and this module import each other.
 */
function getSystemFunctionCatalog(): Catalog<any> {
  systemFunctionCatalog ??= new Catalog(
    SYSTEM_FUNCTION_CATALOG_ID,
    SpecVersion.V1_0,
    [],
    SYSTEM_FUNCTIONS,
  );
  return systemFunctionCatalog;
}

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

  const fn =
    catalog?.functions?.get?.(functionName) ??
    (functionName === '@index' &&
    catalog?.protocolVersion &&
    isAtLeastVersion(catalog.protocolVersion, SpecVersion.V1_0)
      ? IndexApi
      : undefined);
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
 * Checks whether a key begins with a single '@' character and is not escaped by prefix doubling.
 *
 * Matches property names conforming to `^@([^@]|$)`.
 *
 * @param key Object property key to test.
 * @returns True if the key starts with a single unescaped '@'.
 */
export function isSingleAtKey(key: string): boolean {
  return key.startsWith('@') && !key.startsWith('@@');
}

/**
 * Unescapes a property key if it begins with doubled '@@' prefix.
 *
 * In A2UI v1.0, literal keys starting with '@' are escaped by prefix doubling ('@@path' -> '@path').
 *
 * @param key Object property key to unescape.
 * @returns The unescaped key without the leading '@' if it started with '@@', otherwise the key unchanged.
 */
export function unescapeObjectKey(key: string): string {
  return key.startsWith('@@') ? key.slice(1) : key;
}

/** Recognized reserved protocol directives in v1.0 dynamic objects. */
const RESERVED_DIRECTIVES = new Set(['@path', '@call']);

/**
 * Validates that any single-'@' prefixed keys in an object are recognized protocol directives.
 *
 * In A2UI v1.0, any key matching `^@([^@]|$)` that is not a recognized protocol directive is invalid.
 *
 * @param keys The keys of the object to validate.
 * @param protocolVersion The protocol specification version.
 * @throws {A2uiValidationError} If an unrecognized single-'@' key is found in v1.0.
 */
export function validateReservedDirectives(keys: Iterable<string>, protocolVersion?: string): void {
  if (!isAtLeastVersion(protocolVersion, '1.0')) {
    return;
  }
  for (const key of keys) {
    if (isSingleAtKey(key) && !RESERVED_DIRECTIVES.has(key)) {
      throw new A2uiValidationError(
        `Unrecognized reserved protocol directive '${key}' in v1.0 dynamic object. Reserved keys must be in ${Array.from(
          RESERVED_DIRECTIVES,
        ).join(', ')}, or escaped with prefix doubling (e.g. '@${key}').`,
        undefined,
        'INVALID_RESERVED_KEY',
      );
    }
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
  private _isUserActivated = false;
  private _isPassiveEvaluation = false;

  readonly surface?: SurfaceModel<any>;

  /**
   * Initializes a new DataContext instance.
   *
   * @param surface The surface model or data model this context belongs to.
   * @param path The absolute path in the DataModel that this context is scoped to.
   * @param index Optional explicit collection iteration index.
   * @param parent Optional parent DataContext in the scope chain.
   */
  constructor(
    surface: SurfaceModel<any> | DataModel,
    readonly path: string,
    index?: number,
    parent?: DataContext,
  ) {
    if (surface instanceof DataModel) {
      this.surface = undefined;
      this.dataModel = surface;
      this.functionInvoker = () => undefined;
    } else {
      this.surface = surface;
      this.dataModel = surface.dataModel;
      this.functionInvoker =
        surface.defaultCatalog?.invoker ??
        ((name, ...rest) =>
          resolveSurfaceCatalog(surface, undefined, `Function call '${name}'`).invoker(
            name,
            ...rest,
          ));
    }
    this.explicitIndex = index;
    this.parent = parent;
    this.warnedPaths = parent ? parent.warnedPaths : new Set<string>();
  }

  /** Whether the current function evaluation was initiated by an active user action. */
  get isUserActivated(): boolean {
    return this._isUserActivated || Boolean(this.parent?.isUserActivated);
  }

  /** Whether the current function evaluation is running inside a passive reactive binding. */
  get isPassiveEvaluation(): boolean {
    return this._isPassiveEvaluation || Boolean(this.parent?.isPassiveEvaluation);
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
   * Protocol version of the bound surface.
   *
   * Reads the surface's own version, which is set even when the surface has
   * no default catalog, and falls back to the default catalog's version for
   * surface-like objects that do not carry one.
   */
  private get surfaceProtocolVersion(): string | undefined {
    return this.surface?.protocolVersion ?? this.surface?.defaultCatalog?.protocolVersion;
  }

  private _cachedAtLeastV10?: boolean;

  /** Whether this context targets A2UI protocol v1.0 or newer. */
  public get atLeastV10(): boolean {
    if (this._cachedAtLeastV10 === undefined) {
      this._cachedAtLeastV10 = isAtLeastVersion(this.surfaceProtocolVersion, '1.0');
    }
    return this._cachedAtLeastV10;
  }

  /**
   * Checks whether an object represents a data binding.
   *
   * In v1.0, data bindings must use `@path`. In v0.9, data bindings use `path`.
   *
   * @param val Candidate object to inspect.
   * @returns Whether the object represents a valid data binding for this context's protocol version.
   */
  private isDataBindingObject(val: Record<string, unknown>): boolean {
    const hasPath = this.atLeastV10
      ? '@path' in val && typeof val['@path'] === 'string'
      : 'path' in val && typeof val.path === 'string';
    return hasPath && !('componentId' in val);
  }

  /**
   * Checks whether an object represents a function call.
   *
   * In v1.0, function calls must use `@call`. In v0.9, function calls use `call`.
   *
   * @param val Candidate object to inspect.
   * @returns Whether the object represents a valid function call for this context's protocol version.
   */
  private isFunctionCallObject(val: Record<string, unknown>): boolean {
    return this.atLeastV10
      ? '@call' in val && typeof val['@call'] === 'string'
      : 'call' in val && typeof val.call === 'string';
  }

  /**
   * Checks whether a value contains any dynamic parts (path bindings,
   * function calls, or escaped/reserved directive keys) at any nesting depth.
   *
   * @param value The value or data structure to inspect.
   * @returns Whether the value contains dynamic elements requiring resolution.
   */
  private containsDynamicValue(value: unknown): boolean {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    if (Array.isArray(value)) {
      return value.some(item => this.containsDynamicValue(item));
    }
    const rec = value as Record<string, unknown>;
    if (this.isDataBindingObject(rec) || this.isFunctionCallObject(rec)) {
      return true;
    }
    if (this.atLeastV10) {
      for (const k of Object.keys(rec)) {
        if (k.startsWith('@')) {
          return true;
        }
      }
    }
    return Object.values(rec).some(v => this.containsDynamicValue(v));
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
  resolveDynamicValue<V>(value: unknown, depth = 0, userActivated = false): V {
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
      if (!this.containsDynamicValue(value)) {
        return value as V;
      }
      return value.map(item => this.resolveDynamicValue(item, depth + 1, userActivated)) as V;
    }

    const rec = value as Record<string, unknown>;

    if (this.isDataBindingObject(rec)) {
      const bindingPath = (rec['@path'] ?? rec.path) as string;
      const absolutePath = this.resolvePath(bindingPath);
      const val = this.dataModel.get(absolutePath);
      if (val === undefined) {
        this.emitMissingDataBindingWarning(absolutePath);
      }
      return val as V;
    }

    if (this.isFunctionCallObject(rec)) {
      return this.resolveFunctionCallValue<V>(rec as unknown as FunctionCall, depth, userActivated);
    }

    return this.resolvePlainObjectValue<V>(rec, depth);
  }

  /**
   * Resolves a function call by validating arguments and invoking the function.
   *
   * @param call Function call definition to execute.
   * @param depth Current recursion depth for nested expression tracking.
   * @param userActivated Whether the evaluation was initiated by an active user action.
   * @returns The resolved function return value.
   */
  private resolveFunctionCallValue<V>(call: FunctionCall, depth = 0, userActivated = false): V {
    const callName = (call['@call'] ?? call.call)!;
    // Resolve before validating: the arguments must be checked against the
    // catalog that will actually run the call, not the surface default.
    const targetCatalog = this.resolveCallCatalog(callName, call.catalogId);
    if (!targetCatalog) {
      return undefined as V;
    }
    try {
      validateFunctionArgs(callName, call.args, targetCatalog);
    } catch (e: unknown) {
      this.dispatchExpressionError(e, callName);
      return undefined as V;
    }
    const args: Record<string, unknown> = {};
    for (const [key, argVal] of Object.entries(call.args ?? {})) {
      args[key] = this.resolveDynamicValue(argVal, depth + 1, userActivated);
    }

    const abortController = new AbortController();
    const prevActivated = this._isUserActivated;
    this._isUserActivated = prevActivated || userActivated;
    let result: Signal<V> | V;
    try {
      result = this.evaluateFunctionReactive<V>(
        callName,
        args,
        targetCatalog.invoker,
        abortController.signal,
      );
    } finally {
      this._isUserActivated = prevActivated;
    }

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
    if (this.atLeastV10) {
      validateReservedDirectives(Object.keys(rec), this.surfaceProtocolVersion);
    }
    if (!this.containsDynamicValue(rec)) {
      return rec as unknown as V;
    }
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      const key = this.atLeastV10 ? unescapeObjectKey(k) : k;
      resolved[key] = this.resolveDynamicValue(v, depth + 1);
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
        typeof value === 'object' && value && ('@call' in value || 'call' in value)
          ? (((value as any)['@call'] ?? (value as any).call) as string)
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
      if (!this.containsDynamicValue(value)) {
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
    if (this.isDataBindingObject(rec)) {
      const bindingPath = (rec['@path'] ?? rec.path) as string;
      const absolutePath = this.resolvePath(bindingPath);
      this.emitMissingDataBindingWarning(absolutePath);
      return this.dataModel.getSignal<V>(absolutePath) as Signal<V>;
    }

    // 3. Function Call
    if (this.isFunctionCallObject(rec)) {
      const call = rec as unknown as FunctionCall;
      const callName = (call['@call'] ?? call.call)!;
      // Resolve before validating: the arguments must be checked against the
      // catalog that will actually run the call, not the surface default.
      const targetCatalog = this.resolveCallCatalog(callName, call.catalogId);
      if (!targetCatalog) {
        return signal(undefined as unknown as V);
      }
      try {
        validateFunctionArgs(callName, call.args, targetCatalog);
      } catch (e: unknown) {
        this.dispatchExpressionError(e, callName);
        return signal(undefined as unknown as V);
      }
      const argSignals: Record<string, Signal<unknown>> = {};

      for (const [key, argVal] of Object.entries(call.args ?? {})) {
        argSignals[key] = this.resolveSignal(argVal, depth + 1);
      }

      if (Object.keys(argSignals).length === 0) {
        const abortController = new AbortController();
        const result = this.evaluateFunctionPassive<V>({
          name: callName,
          args: {},
          abortSignal: abortController.signal,
          invoker: targetCatalog.invoker,
        });
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

          const res = this.evaluateFunctionPassive<V>({
            name: callName,
            args,
            abortSignal: abortController.signal,
            invoker: targetCatalog.invoker,
          });

          if (isSignal(res)) {
            innerUnsubscribe = effect(() => {
              setValue(resultSig, getValue(res));
            });
          } else {
            setValue(resultSig, res);
          }
        } catch (e: unknown) {
          this.dispatchExpressionError(e, callName);
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

    if (this.atLeastV10) {
      validateReservedDirectives(Object.keys(rec), this.surfaceProtocolVersion);
    }

    if (!this.containsDynamicValue(rec)) {
      return signal(value as unknown as V);
    }

    const entrySignals = Object.entries(rec).map(([k, v]) => {
      const key = this.atLeastV10 ? unescapeObjectKey(k) : k;
      return [key, this.resolveSignal(v, depth + 1)] as const;
    });
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
  resolveAction(action: Action | Record<string, unknown>): Action | unknown {
    if ('event' in action && typeof action.event === 'object' && action.event !== null) {
      const resolvedContext: Record<string, unknown> = {};
      const ev = action.event as Record<string, unknown>;
      if (ev.context && typeof ev.context === 'object' && !Array.isArray(ev.context)) {
        for (const [key, value] of Object.entries(ev.context as Record<string, unknown>)) {
          resolvedContext[key] = this.resolveDynamicValue(value);
        }
      }
      const resolvedEvent: Record<string, unknown> = {
        ...ev,
        context: resolvedContext,
      };
      if (ev.userMessage !== undefined) {
        resolvedEvent.userMessage = this.resolveDynamicValue(ev.userMessage);
      }
      return {
        ...action,
        event: resolvedEvent,
      };
    }
    if ('name' in action) {
      const actObj = action as Record<string, unknown>;
      const resolvedContext: Record<string, unknown> = {};
      if (actObj.context && typeof actObj.context === 'object' && !Array.isArray(actObj.context)) {
        for (const [key, value] of Object.entries(actObj.context as Record<string, unknown>)) {
          resolvedContext[key] = this.resolveDynamicValue(value);
        }
      }
      const resolved: Record<string, unknown> = {
        ...actObj,
        context: resolvedContext,
      };
      if (actObj.userMessage !== undefined) {
        resolved.userMessage = this.resolveDynamicValue(actObj.userMessage);
      }
      return resolved;
    }
    if ('functionCall' in action) {
      return this.resolveDynamicValue((action as any).functionCall, 0, true);
    }
    if ('call' in action) {
      return this.resolveDynamicValue(action, 0, true);
    }
    return action;
  }

  /**
   * Resolves the catalog against which a function call executes.
   *
   * From v1.0, reserved `@`-prefixed system functions such as `@index` belong
   * to no catalog, so they resolve to the built-in system function set
   * whatever the surface's catalogs are. Before v1.0 a call cannot select a
   * catalog, so a `catalogId` on it is ignored and the call runs in the
   * surface catalog.
   *
   * @param name Name of the function being called.
   * @param catalogId Identifier of the catalog named by the call, if specified.
   * @returns The resolved Catalog instance, or the surface default catalog if omitted.
   * @throws {A2uiCatalogError} If the call names a catalog ID that cannot be
   *   resolved on this surface, or names none on a surface without a default
   *   catalog. This is reported as a catalog fault rather than a missing
   *   function, since the function may exist in a catalog that is not
   *   available here.
   */
  private resolveFunctionCatalog(name: string, catalogId?: string): Catalog<any> {
    if (this.atLeastV10 && name.startsWith('@')) {
      return getSystemFunctionCatalog();
    }
    if (!this.surface) {
      throw new A2uiCatalogError(
        `No surface available to resolve catalog: ${catalogId ?? 'default'}`,
      );
    }
    return resolveSurfaceCatalog(
      this.surface,
      this.atLeastV10 ? catalogId : undefined,
      `Function call '${name}'`,
    );
  }

  /**
   * Resolves the catalog a function call runs in, dispatching a
   * `CATALOG_ERROR` to the surface when it cannot be resolved.
   *
   * @param name Name of the function being called.
   * @param catalogId Identifier of the catalog named by the call, if specified.
   * @returns The resolved Catalog instance, or `undefined` if resolution failed.
   */
  private resolveCallCatalog(name: string, catalogId?: string): Catalog<any> | undefined {
    try {
      return this.resolveFunctionCatalog(name, catalogId);
    } catch (e: unknown) {
      // A call whose catalog can't be resolved is a catalog fault, not a
      // broken expression: the function may exist in a catalog this surface
      // doesn't have.
      if (e instanceof A2uiCatalogError && this.surface) {
        this.surface.dispatchError({
          code: 'CATALOG_ERROR',
          message: e.message,
          expression: name,
        });
      } else {
        this.dispatchExpressionError(e, name);
      }
      return undefined;
    }
  }

  private evaluateFunctionPassive<V>(options: {
    name: string;
    args: Record<string, unknown>;
    invoker: FunctionInvoker;
    abortSignal?: AbortSignal;
  }): Signal<V> | V {
    const {name, args, invoker, abortSignal} = options;
    const prevPassive = this._isPassiveEvaluation;
    this._isPassiveEvaluation = true;
    try {
      return this.evaluateFunctionReactive<V>(name, args, invoker, abortSignal);
    } finally {
      this._isPassiveEvaluation = prevPassive;
    }
  }

  /**
   * Evaluates a catalog function and returns its reactive Signal or static value.
   *
   * Invokes the function with this context through the invoker of the
   * catalog the call resolved to, and dispatches an `EXPRESSION_ERROR` if
   * execution throws.
   *
   * @template V Expected return type of the function evaluation.
   * @param name Name of the function to evaluate.
   * @param args Resolved arguments to pass to the function.
   * @param invoker Invoker of the catalog the call resolved to.
   * @param abortSignal Optional abort signal to cancel asynchronous execution.
   * @returns The evaluated result as a reactive `Signal` or static value, or `undefined` on failure.
   */
  private evaluateFunctionReactive<V>(
    name: string,
    args: Record<string, unknown>,
    invoker: FunctionInvoker,
    abortSignal?: AbortSignal,
  ): Signal<V> | V {
    try {
      return invoker(name, args, this, abortSignal) as Signal<V> | V;
    } catch (e: unknown) {
      this.dispatchExpressionError(e, name);
      return undefined as unknown as V;
    }
  }

  /**
   * Dispatches an evaluation failure to the surface as an `EXPRESSION_ERROR`.
   *
   * Every failure other than an unresolvable catalog uses this code, including
   * a function missing from the catalog the call resolved to and an unknown
   * system function. Unresolvable catalogs are reported by
   * {@link resolveCallCatalog} as `CATALOG_ERROR`.
   *
   * @param e The error thrown while evaluating the call.
   * @param name Name of the function being evaluated.
   */
  private dispatchExpressionError(e: unknown, name: string): void {
    if (!this.surface) return;
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
    return new DataContext(this.surface ?? this.dataModel, newPath, index, this);
  }

  resolvePath(path: string): string {
    if (path.startsWith('/')) {
      return path;
    }
    let base = this.path;
    if (base.endsWith('/') && base.length > 1) {
      base = base.slice(0, -1);
    }
    if (path === '' || path === '.') {
      return base || '/';
    }
    if (base === '/') base = '';

    return `${base}/${path}`;
  }
}
