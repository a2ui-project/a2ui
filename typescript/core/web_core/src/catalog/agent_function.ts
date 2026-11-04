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

import {A2uiCatalogError} from '../errors.js';
import {AGENT_FUNCTION_BRAND, isAgentFunction} from './agent_function_brand.js';
import {copyLoadedDefinition} from './json_entries.js';
import {
  convertFunctionArgsJsonSchemaToZod,
  functionParameterNames,
  isZodSchema,
} from './schema_loader.js';
import type {
  A2uiReturnType,
  FunctionApi,
  InferA2uiReturnType,
  ResolvedFunctionArgs,
} from './types.js';

export {isAgentFunction};

/**
 * Execution context passed to an {@link AgentFunctionHandler} when a renderer
 * invokes an agent function via `callAgentFunction`.
 */
export interface AgentFunctionContext {
  /** Identifier of the catalog that owns the function. */
  readonly catalogId: string;
  /** Identifier of the surface that initiated the call. */
  readonly surfaceId: string;
  /** Unique correlation identifier for the `callAgentFunction` exchange. */
  readonly functionCallId: string;
}

/**
 * Callback that executes an agent function on the agent side.
 *
 * A handler may take `(args)` or `(args, context)`: one that doesn't need the
 * call's metadata can leave `context` out.
 *
 * @param args Validated input arguments (with schema defaults applied).
 * @param context Call metadata including `catalogId`, `surfaceId`, and `functionCallId`.
 * @returns A JSON-compatible result value or a Promise resolving to one.
 */
export type AgentFunctionHandler<TArgs = Record<string, unknown>, TReturn = unknown> = (
  args: TArgs,
  context: AgentFunctionContext,
) => TReturn | Promise<TReturn>;

/**
 * Configuration options for constructing an {@link AgentFunction}.
 *
 * An agent function built this way is always `rendererOnly`: only the
 * renderer calls it, with `callAgentFunction`. To bind a handler to a function
 * the catalog already declares, and keep its `allowedCallers`, use
 * {@link AgentFunction.fromApi}.
 */
export interface AgentFunctionInit<
  Schema extends z.ZodTypeAny | Record<string, unknown> = Record<string, unknown>,
  TReturn extends A2uiReturnType = A2uiReturnType,
> {
  /** Name of the function as it appears in A2UI JSON payloads. */
  readonly name: string;
  /** Handler invoked on the agent when a renderer calls this function. */
  readonly handler: AgentFunctionHandler<
    Schema extends z.ZodTypeAny ? ResolvedFunctionArgs<Schema> : Record<string, unknown>,
    InferA2uiReturnType<TReturn>
  >;
  /** Return type identifier for the function. Defaults to `'any'`. */
  readonly returnType?: TReturn;
  /** Zod schema or JSON Schema object validating the function's input arguments. */
  readonly schema?: Schema;
  /** Whether the function requires explicit user interaction before execution. Defaults to `false`. */
  readonly requiresUserActivation?: boolean;
  /** Human-readable description of the function's purpose. */
  readonly description?: string;
}

/**
 * Key of the fields only `AgentFunction.fromApi` passes to the constructor,
 * so code outside this module can't set them.
 */
const FROM_API = Symbol('AgentFunction.fromApi');

interface FromApiInit extends AgentFunctionInit<any, any> {
  readonly [FROM_API]: {
    readonly declaration: FunctionApi;
    readonly allowedCallers?: 'rendererOnly' | 'rendererOrAgent';
  };
}

/**
 * A catalog function whose handler runs on the agent rather than the renderer.
 *
 * `AgentFunction` implements {@link FunctionApi} (and intentionally omits
 * `FunctionImplementation.execute`) so that:
 * - `Catalog.toJson()`, `Catalog.validationSchema`, and `PayloadValidator`
 *   treat it identically to any other declared catalog function.
 * - If a catalog containing an `AgentFunction` is passed to a renderer,
 *   `Catalog.invoker` sees no local `execute` implementation and routes calls
 *   to the agent via `callAgentFunction`.
 * - On the agent side, `RendererToAgentMessageProcessor` reads
 *   `catalog.agentFunctions` to answer incoming `callAgentFunction` messages
 *   with `handler`.
 *
 * Add agent functions to a catalog with `catalog.copyWith({agentFunctions})`.
 *
 * The type parameters only type the constructor's `handler` from `schema` and
 * `returnType`, so any `AgentFunction` is assignable to `AgentFunction`.
 *
 * @template Schema The Zod schema or JSON Schema object of the arguments.
 * @template TReturn The return type identifier.
 */
export class AgentFunction<
  Schema extends z.ZodTypeAny | Record<string, unknown> = Record<string, unknown>,
  TReturn extends A2uiReturnType = A2uiReturnType,
> implements FunctionApi {
  /** @internal */
  readonly [AGENT_FUNCTION_BRAND] = true;
  /** Name of the function as it appears in A2UI JSON payloads. */
  readonly name: string;
  /** Return type identifier for the function. */
  readonly returnType: A2uiReturnType;
  /** Zod schema validating the function's input arguments. */
  readonly schema: z.ZodTypeAny;
  /** Agent-side handler callback. Use `withHandler` to bind another one. */
  readonly handler: AgentFunctionHandler<any, any>;
  /**
   * Allowed caller contexts for the function: `rendererOnly`, or the
   * `rendererOrAgent` of a declaration bound with `fromApi`.
   */
  readonly allowedCallers: 'rendererOnly' | 'rendererOrAgent';
  /** Whether the function requires explicit user interaction before execution. */
  readonly requiresUserActivation: boolean;
  /** Human-readable description of the function's purpose. */
  readonly description?: string;
  /** Original `FunctionApi` declaration bound via `AgentFunction.fromApi`, if any. */
  readonly declaration?: FunctionApi;
  /** @internal */
  readonly explicitAllowedCallers?: 'rendererOnly' | 'rendererOrAgent';
  /** @internal */
  readonly explicitRequiresUserActivation?: boolean;
  /**
   * @internal The parameter names of a JSON Schema `schema`, as written,
   * which a v1.0 catalog checks against UAX #31 with those of the Zod schema.
   */
  readonly declaredParameterNames?: ReadonlyArray<string>;

  /**
   * Initializes a new `rendererOnly` agent function.
   *
   * @param init The function's name, handler and signature.
   * @throws {TypeError} If `handler` is not callable.
   */
  constructor(init: AgentFunctionInit<Schema, TReturn>) {
    if (typeof init?.handler !== 'function') {
      throw new TypeError(`Agent function '${init?.name ?? ''}' requires a callable handler.`);
    }
    const fromApi = (init as Partial<FromApiInit>)[FROM_API];
    this.name = init.name;
    this.returnType = init.returnType ?? 'any';
    this.schema = resolveAgentFunctionSchema(init.schema);
    if (init.schema !== undefined && !isZodSchema(init.schema)) {
      this.declaredParameterNames = functionParameterNames(init.schema);
    }
    this.handler = init.handler;
    this.explicitAllowedCallers = fromApi?.allowedCallers;
    this.allowedCallers = fromApi?.allowedCallers ?? 'rendererOnly';
    this.explicitRequiresUserActivation = init.requiresUserActivation;
    this.requiresUserActivation = init.requiresUserActivation ?? false;
    this.description = init.description;
    this.declaration = fromApi?.declaration;
  }

  /**
   * Binds an agent-side `handler` to a function a catalog declares (for
   * example, an entry from `Catalog.fromJson(doc).functions`).
   *
   * Keeps the declaration's signature, `allowedCallers` and JSON Schema
   * definition, so `Catalog.toJson()` continues to emit the authored catalog
   * document unchanged, and records `declaration` so
   * `catalog.copyWith({agentFunctions: [...]})` replaces the declaration in
   * place. That catalog must declare `api`.
   *
   * @param api Existing schema-only function declaration.
   * @param handler Agent-side execution callback.
   * @returns A new `AgentFunction` wrapping `api`.
   * @throws {TypeError} If `api` is already an `AgentFunction` or `handler` is not callable.
   * @throws {A2uiCatalogError} If `api` is `agentOnly`, which a renderer
   *   never calls, or requires user activation without being `rendererOnly`.
   */
  static fromApi<TArgs = Record<string, unknown>, TReturn = unknown>(
    api: FunctionApi,
    handler: AgentFunctionHandler<TArgs, TReturn>,
  ): AgentFunction {
    if (isAgentFunction(api)) {
      throw new TypeError(`Function '${api.name}' is already an agent function.`);
    }
    if (api.allowedCallers === 'agentOnly') {
      throw new A2uiCatalogError(
        `Function '${api.name}' is agentOnly, so a renderer never calls it and it can't be an agent function.`,
      );
    }
    if (
      api.requiresUserActivation === true &&
      api.allowedCallers !== undefined &&
      api.allowedCallers !== 'rendererOnly'
    ) {
      throw new A2uiCatalogError(
        `Function '${api.name}' requires user activation, so its allowedCallers must be rendererOnly, not ${api.allowedCallers}.`,
      );
    }
    const init: FromApiInit = {
      name: api.name,
      returnType: api.returnType,
      schema: api.schema,
      handler: handler as AgentFunctionHandler<any, any>,
      requiresUserActivation: api.requiresUserActivation,
      description: api.description,
      [FROM_API]: {declaration: api, allowedCallers: api.allowedCallers},
    };
    const fn: AgentFunction = new AgentFunction<any, any>(init);
    copyLoadedDefinition(api, fn);
    return fn;
  }

  /**
   * Returns a copy of this agent function bound to a different handler, with
   * the same name, signature, `allowedCallers` and description: for example,
   * to swap in a test double, or a handler for one session. One built with
   * `fromApi` is rebuilt from the same declaration, so it still replaces that
   * declaration in its catalog.
   *
   * @param handler The new agent-side execution callback.
   * @returns A new `AgentFunction`.
   * @throws {TypeError} If `handler` is not callable.
   */
  withHandler<TArgs = Record<string, unknown>, TReturn = unknown>(
    handler: AgentFunctionHandler<TArgs, TReturn>,
  ): AgentFunction {
    if (this.declaration !== undefined) {
      return AgentFunction.fromApi(this.declaration, handler);
    }
    return new AgentFunction<any, any>({
      name: this.name,
      returnType: this.returnType,
      schema: this.schema,
      handler: handler as AgentFunctionHandler<any, any>,
      requiresUserActivation: this.explicitRequiresUserActivation,
      description: this.description,
    });
  }
}

function resolveAgentFunctionSchema(
  schema: z.ZodTypeAny | Record<string, unknown> | undefined,
): z.ZodTypeAny {
  if (schema === undefined) {
    return z.record(z.unknown());
  }
  if (isZodSchema(schema)) {
    return schema;
  }
  if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
    if (Object.keys(schema).length === 0) {
      return z.record(z.unknown());
    }
    // A v1.0 catalog checks the parameter names when the function is added.
    return convertFunctionArgsJsonSchemaToZod(schema);
  }
  return z.record(z.unknown());
}
