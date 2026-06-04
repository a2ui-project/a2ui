/*
 * Copyright 2025 Google LLC
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
import {Signal} from '@preact/signals-core';
import {A2uiExpressionError} from '../errors.js';

/**
 * Robust check for a Preact Signal that works across package boundaries.
 */
export function isSignal(val: any): val is Signal<any> {
  return val && typeof val === 'object' && 'value' in val && 'peek' in val;
}

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
 * Infers the schema type from a ComponentApi.
 *
 * This type uses `z.infer` on the `schema` property of a `ComponentApi` object.
 * It is used to access the schema props of a component with type safety.
 */
export type InferredComponentApiSchemaType<Api extends ComponentApi> = z.infer<Api['schema']>;

/**
 * A collection of available components and functions.
 */
export class Catalog<T extends ComponentApi> {
  readonly id: string;

  /**
   * A map of available components.
   * This is readonly to encourage immutable extension patterns.
   */
  readonly components: ReadonlyMap<string, T>;

  /**
   * Map of functions provided by this catalog.
   */
  readonly functions: ReadonlyMap<string, FunctionImplementation>;

  /**
   * The schema for theme parameters used by this catalog.
   */
  readonly themeSchema?: z.ZodObject<any>;

  /**
   * A ready-to-use FunctionInvoker callback that delegates to this catalog's functions.
   * Can be passed directly to a DataContext.
   */
  readonly invoker: FunctionInvoker;

  constructor(
    id: string,
    components: T[],
    functions: FunctionImplementation[] = [],
    themeSchema?: z.ZodObject<any>,
  ) {
    this.id = id;

    const compMap = new Map<string, T>();
    for (const comp of components) {
      compMap.set(comp.name, comp);
    }
    this.components = compMap;

    const funcMap = new Map<string, FunctionImplementation>();
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

      // Provides runtime safety: Coerces and strips invalid arguments before execute()
      try {
        const safeArgs = fn.schema.parse(rawArgs);
        return fn.execute(safeArgs, ctx, abortSignal);
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
}
