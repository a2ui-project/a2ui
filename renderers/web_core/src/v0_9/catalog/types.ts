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
import {DataContext} from '../rendering/data-context.js';
import {Signal} from '../reactivity/signals.js';
import {A2uiExpressionError} from '../errors.js';
import {loadCatalogFromSchema} from './schema_loader.js';

export type A2uiReturnType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';

export type InferA2uiReturnType<T extends A2uiReturnType> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'array'
        ? any[]
        : T extends 'object'
          ? Record<string, any>
          : T extends 'void'
            ? void
            : any;

/**
 * A definition of a UI function's API.
 */
export interface FunctionApi {
  readonly name: string;
  readonly returnType: A2uiReturnType;
  readonly schema: z.ZodTypeAny;
  readonly description?: string;
}

/**
 * A function implementation that can be registered with the evaluator or basic catalog.
 */
export interface FunctionImplementation extends FunctionApi {
  execute(
    args: Record<string, any>,
    context: DataContext,
    abortSignal?: AbortSignal,
  ): unknown | Signal<unknown>;
}

export function createFunctionImplementation<
  Schema extends z.ZodTypeAny,
  TReturn extends A2uiReturnType,
>(
  api: {name: string; returnType: TReturn; schema: Schema},
  execute: (
    args: z.infer<Schema>,
    context: DataContext,
    abortSignal?: AbortSignal,
  ) => InferA2uiReturnType<TReturn> | Signal<InferA2uiReturnType<TReturn>>,
): FunctionImplementation {
  return {
    name: api.name,
    returnType: api.returnType,
    schema: api.schema,
    execute: execute as (args: Record<string, any>, ctx: DataContext, ab?: AbortSignal) => unknown,
  };
}

import {FunctionInvoker} from './function_invoker.js';

/**
 * A definition of a UI component's API.
 * This interface defines the contract for a component's capabilities and properties,
 * independent of any specific rendering implementation.
 *
 * @template Schema the Zod schema type for the component's properties.
 */
export interface ComponentApi<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  /** The name of the component as it appears in the A2UI JSON (e.g., 'Button'). */
  name: string;

  /**
   * The Zod schema describing the **properties** of this component.
   *
   * - MUST include catalog-specific common properties (e.g. 'weight', 'accessibility').
   * - MUST NOT include 'component' or 'id' as those are handled by the framework/envelope.
   */
  readonly schema: Schema;
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
 * This type uses `z.infer` on the `schema` property of a `ComponentApi` object.
 * It is used to access the schema props of a component with type safety.
 */
export type InferredComponentApiSchemaType<Api extends ComponentApi> = z.infer<Api['schema']>;

/**
 * Interface for Catalog to prevent property renaming in 1P (Closure Compiler).
 *
 * This must declare all publicly accessed properties of Catalog.
 */
export declare interface CatalogInterface<
  T extends ComponentApi,
  F extends FunctionApi = FunctionImplementation,
> {
  readonly id: string;
  readonly components: ReadonlyMap<string, T>;
  readonly functions: ReadonlyMap<string, F>;
  readonly themeSchema?: z.ZodObject<any>;
  readonly invoker: FunctionInvoker;
}

/**
 * A collection of available components and functions.
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
  readonly id: string;

  /**
   * A map of available components.
   * This is readonly to encourage immutable extension patterns.
   */
  readonly components: ReadonlyMap<string, T>;

  /**
   * Map of functions provided by this catalog.
   */
  readonly functions: ReadonlyMap<string, F>;

  /**
   * The schema for theme parameters used by this catalog.
   */
  readonly themeSchema?: z.ZodObject<any>;

  /**
   * A ready-to-use FunctionInvoker callback that delegates to this catalog's functions.
   * Can be passed directly to a DataContext.
   */
  readonly invoker: FunctionInvoker;

  constructor(id: string, components: T[], functions: F[] = [], themeSchema?: z.ZodObject<any>) {
    this.id = id;

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
   * Constructs a fully-typed schema-only Catalog directly from raw A2UI catalog schema.
   *
   * @param catalogSchema Raw catalog schema or client capabilities payload object.
   */
  static fromSchema(catalogSchema: Record<string, any>): Catalog<ComponentApi, FunctionApi> {
    return loadCatalogFromSchema(catalogSchema);
  }
}
