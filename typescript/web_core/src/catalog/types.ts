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
import type {ProtocolVersion} from '../processing/adapters/base.js';
import {DataContext} from '../rendering/data-context.js';
import {Signal} from '../reactivity/signals.js';
import {A2uiExpressionError} from '../errors.js';
import {loadCatalogFromSchema} from './schema_loader.js';
import {generateCatalogSchema} from './schema_generator.js';
import {
  buildComponentRefMap,
  type ComponentChildRefs,
  type ComponentRefMap,
} from './reference-map.js';
import {V09_CHILD_REF_OPTIONS} from '../v0_9/standard_defs.js';

export type {ComponentChildRefs};

/**
 * Registry mapping A2UI function return type identifiers to their TypeScript runtime types.
 *
 * Core defines version-agnostic primitives. Specific protocol versions (such as v1.0)
 * or custom catalogs can augment this interface using TypeScript module declaration merging.
 */
export interface A2uiReturnTypeMap {
  string: string;
  number: number;
  boolean: boolean;
  array: unknown[];
  object: Record<string, unknown>;
  any: unknown;
  void: void;
}

/**
 * Union of valid A2UI function return type identifiers.
 */
export type A2uiReturnType = keyof A2uiReturnTypeMap | (string & {});

/**
 * Infers the TypeScript runtime return type for a given A2UI return type identifier.
 */
export type InferA2uiReturnType<T extends string> = T extends keyof A2uiReturnTypeMap
  ? A2uiReturnTypeMap[T]
  : unknown;

/**
 * Specification and schema for an A2UI function API.
 */
export interface FunctionApi {
  /** Name of the function as it appears in A2UI JSON payloads. */
  readonly name: string;
  /** Return type identifier for the function. */
  readonly returnType: A2uiReturnType;
  /** Zod schema validating the function's input arguments. */
  readonly schema: z.ZodTypeAny;
  /** Allowed caller contexts for the function. */
  readonly allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
  /** Whether the function requires explicit user interaction before execution. */
  readonly requiresUserActivation?: boolean;
  /** Human-readable description of the function's purpose. */
  readonly description?: string;
}

/**
 * A function implementation that can be registered with a catalog or evaluator.
 */
export interface FunctionImplementation extends FunctionApi {
  /**
   * Executes the function logic with the provided arguments and context.
   *
   * @param args Validated input arguments for the function.
   * @param context Data context for expression and state resolution.
   * @param abortSignal Optional abort signal to cancel async execution.
   * @returns The resolved function output value or reactive Signal.
   */
  execute(
    args: Record<string, unknown>,
    context: DataContext,
    abortSignal?: AbortSignal,
  ): unknown | Signal<unknown>;
}

/**
 * Recursively unwraps dynamic wire AST nodes into their evaluated runtime values.
 */
export type ResolvedDynamic<T> = T extends {path: string} | {call: string}
  ? never
  : T extends (infer U)[]
    ? ResolvedDynamic<U>[]
    : T extends object
      ? {[K in keyof T]: ResolvedDynamic<T[K]>}
      : T;

/**
 * Extracts and resolves execution-time argument types from a function's Zod validation schema.
 */
export type ResolvedFunctionArgs<Schema extends z.ZodTypeAny> = ResolvedDynamic<z.infer<Schema>>;

/**
 * Creates a typed FunctionImplementation from an API definition and an execution callback.
 *
 * @param api The function API definition containing name, schema, and metadata.
 * @param execute The execution handler callback.
 * @returns A complete FunctionImplementation object.
 */
export function createFunctionImplementation<
  Schema extends z.ZodTypeAny = z.ZodTypeAny,
  TReturn extends A2uiReturnType = A2uiReturnType,
>(
  api: {
    name: string;
    returnType: TReturn;
    schema: Schema;
    allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
    requiresUserActivation?: boolean;
    description?: string;
  },
  execute: (
    args: ResolvedFunctionArgs<Schema>,
    context: DataContext,
    abortSignal?: AbortSignal,
  ) => InferA2uiReturnType<TReturn> | Signal<InferA2uiReturnType<TReturn>>,
): FunctionImplementation {
  return {
    name: api.name,
    returnType: api.returnType,
    schema: api.schema,
    allowedCallers: api.allowedCallers,
    requiresUserActivation: api.requiresUserActivation,
    description: api.description,
    execute: execute as (
      args: Record<string, unknown>,
      ctx: DataContext,
      ab?: AbortSignal,
    ) => unknown,
  };
}

import {FunctionInvoker} from './function_invoker.js';

/**
 * Contract for a component's capabilities and properties, independent of rendering implementation.
 *
 * @template Schema The Zod schema type for the component's properties.
 */
export interface ComponentApi<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Name of the component as it appears in A2UI JSON (e.g., 'Button'). */
  name: string;

  /**
   * Zod schema describing the properties of this component.
   *
   * Must include catalog-specific common properties (e.g. 'weight', 'accessibility')
   * and must omit envelope fields like 'component' or 'id'.
   */
  readonly schema: Schema;

  /** Optional allowed parent component types (e.g. ['Column', 'Surface']). */
  readonly allowedParents?: string[];

  /** Optional allowed child component types (e.g. ['Text', 'Button']). */
  readonly allowedChildren?: string[];
}

/**
 * An implementation of a UI component using Web Components (Custom Elements).
 * Extends ComponentApi to include the Custom Element's tag name.
 *
 * @template Schema the Zod schema type for the component's properties.
 */
export interface WebComponentImplementation<
  Schema extends z.ZodTypeAny = z.ZodTypeAny,
> extends ComponentApi<Schema> {
  /** The HTML tag name of the Custom Element registered for this component. */
  readonly tagName: string;
}

/**
 * Infers the schema type from a ComponentApi.
 *
 * Uses `z.infer` on the `schema` property of a `ComponentApi` object to access
 * component properties with type safety.
 */
export type InferredComponentApiSchemaType<Api extends ComponentApi> = z.infer<Api['schema']>;

/**
 * Public structural interface for `Catalog`.
 *
 * Declares all publicly accessed properties of `Catalog` to prevent property
 * renaming during compilation.
 */
export declare interface CatalogInterface<
  T extends ComponentApi = ComponentApi,
  F extends FunctionApi = FunctionImplementation,
> {
  /** Unique identifier for the catalog (usually a URI). */
  readonly id: string;
  /** Optional protocol specification version supported by this catalog. */
  readonly protocolVersion?: ProtocolVersion | string;
  /** Map of registered component definitions. */
  readonly components: ReadonlyMap<string, T>;
  /** Map of registered function definitions. */
  readonly functions: ReadonlyMap<string, F>;
  /** Schema for theme parameters used by this catalog. */
  readonly themeSchema?: z.ZodObject<z.ZodRawShape>;
  /** System instructions or usage guidelines for this catalog. */
  readonly instructions?: string;
  /** Invoker callback that delegates to this catalog's registered functions. */
  readonly invoker: FunctionInvoker;
  /** Dynamically reconstructed standard A2UI catalog JSON Schema document. */
  readonly catalogSchema: Record<string, unknown>;
  /** Component reference map for child reference extraction and topology validation. */
  readonly componentRefMap: ComponentRefMap;
}

/**
 * Collection of available components and functions.
 *
 * The `F` parameter distinguishes catalogs that carry executable function
 * implementations (`FunctionImplementation`, the default and the only kind a
 * renderer should hold) from schema-only catalogs (`FunctionApi`), whose
 * functions are signatures loaded from catalog JSON with no code attached.
 * Consumers that need to execute functions, such as `NodeResolver`, constrain
 * `F` to `FunctionImplementation` so a schema-only catalog is rejected at
 * compile time rather than resolving values to `undefined` at runtime.
 */
export class Catalog<
  T extends ComponentApi,
  F extends FunctionApi = FunctionImplementation,
> implements CatalogInterface<T, F> {
  /** Unique identifier for the catalog. */
  readonly id: string;

  /**
   * Optional protocol specification version supported by this catalog.
   */
  readonly protocolVersion?: ProtocolVersion | string;

  /**
   * Map of available components keyed by component name.
   *
   * Readonly to encourage immutable extension patterns.
   */
  readonly components: ReadonlyMap<string, T>;

  /**
   * Map of functions provided by this catalog.
   */
  readonly functions: ReadonlyMap<string, F>;

  /**
   * Schema for theme parameters used by this catalog.
   */
  readonly themeSchema?: z.ZodObject<z.ZodRawShape>;

  /**
   * Optional system instructions or usage guidelines for this catalog.
   */
  readonly instructions?: string;

  /**
   * Function invoker callback that delegates to this catalog's registered functions.
   */
  readonly invoker: FunctionInvoker;

  private cachedCatalogSchema?: Record<string, unknown>;

  /**
   * Dynamically reconstructs and memoizes the unified standard A2UI catalog JSON Schema document.
   */
  get catalogSchema(): Record<string, unknown> {
    if (!this.cachedCatalogSchema) {
      this.cachedCatalogSchema = generateCatalogSchema(this);
    }
    return this.cachedCatalogSchema;
  }

  private _componentRefMap?: ComponentRefMap;

  /**
   * Lazily computed component reference map for child reference extraction and topology validation.
   */
  get componentRefMap(): ComponentRefMap {
    if (!this._componentRefMap) {
      this._componentRefMap = buildComponentRefMap(this, V09_CHILD_REF_OPTIONS);
    }
    return this._componentRefMap;
  }

  constructor(
    id: string,
    components: T[],
    functions: F[] = [],
    themeSchema?: z.ZodObject<any>,
    instructions?: string,
    protocolVersion?: ProtocolVersion | string,
  ) {
    this.id = id;
    this.protocolVersion = protocolVersion;

    const compMap = new Map<string, T>();
    for (const comp of components) {
      compMap.set(comp.name, comp);
    }
    this.components = compMap;

    const funcMap = new Map<string, F>();
    for (const fn of functions) {
      funcMap.set(fn.name, fn);
    }
    this.functions = funcMap;

    this.themeSchema = themeSchema;
    this.instructions = instructions;

    this.invoker = (name, rawArgs, ctx, abortSignal) => {
      const fn = this.functions.get(name);
      if (!fn) {
        throw new A2uiExpressionError(`Function not found in catalog '${this.id}': ${name}`, name);
      }
      const execute = (fn as Partial<FunctionImplementation>).execute;
      if (typeof execute !== 'function') {
        throw new A2uiExpressionError(
          `Function '${name}' in catalog '${this.id}' is schema-only and has no implementation.`,
          name,
        );
      }

      // Provides runtime safety: Coerces and strips invalid arguments before execute()
      try {
        const safeArgs = fn.schema.parse(rawArgs);
        return execute.call(fn, safeArgs, ctx, abortSignal);
      } catch (e: any) {
        if (e?.name === 'ZodError' || e instanceof z.ZodError) {
          throw new A2uiExpressionError(
            `Validation failed for function '${name}': ${e.message}`,
            name,
            e.errors ?? e.issues,
          );
        }
        throw e;
      }
    };
  }

  /**
   * Constructs a schema-only Catalog directly from a raw A2UI catalog schema.
   *
   * @param catalogSchema Raw catalog schema or client capabilities payload object.
   * @returns A new Catalog populated with component and function schemas.
   */
  static fromSchema(catalogSchema: Record<string, any>): Catalog<ComponentApi, FunctionApi> {
    return loadCatalogFromSchema(catalogSchema);
  }
}
