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

/**
 * Package-internal access to the way `DataContext` resolves function
 * arguments. Not exported from any entry point of the package.
 */

import type {Catalog} from '../catalog/types.js';
import type {Signal} from '../reactivity/signals.js';
import type {DataContext} from './data-context.js';

/** Evaluation flags carried by a scoped `DataContext` view. */
export interface DataContextFlags {
  userActivated?: boolean;
  passive?: boolean;
  action?: boolean;
  noAgentRouting?: boolean;
  activeCatalogId?: string;
  activeCatalog?: Catalog<any>;
}

/** Dotted delegates registered by `DataContext` so private members survive Closure renaming. */
interface DataContextInternals {
  withFlags(ctx: DataContext, flags: DataContextFlags): DataContext;
  resolveValue(
    ctx: DataContext,
    value: unknown,
    depth: number,
    userActivated: boolean,
    keepPending: boolean,
  ): unknown;
  allowsAgentRouting(ctx: DataContext): boolean;
  resolveSignalValue(
    ctx: DataContext,
    value: unknown,
    depth: number,
    keepPending: boolean,
  ): Signal<unknown>;
  activeCatalogId(ctx: DataContext): string | undefined;
}

let internals: DataContextInternals | undefined;

function getInternals(): DataContextInternals {
  if (!internals) {
    throw new Error('DataContext internals have not been registered.');
  }
  return internals;
}

/** Registers `DataContext`'s package-internal callbacks from its `static` initializer. */
export function registerDataContextInternals(impl: DataContextInternals): void {
  internals = impl;
}

/**
 * Resolves a value once, as an argument of a function call.
 *
 * A pending result stays a Promise, and, from v1.0, a call that fails resolves
 * to a `FailedArgument` once its failure has been reported.
 *
 * @param ctx The context to resolve in.
 * @param value The DynamicValue to resolve.
 * @param depth The current recursion depth.
 * @param userActivated Whether the evaluation was initiated by an active user action.
 * @param options `allowAgentRouting: false` makes a call the renderer does not
 *   implement fail instead of going to the agent.
 * @returns The resolved value.
 */
export function resolveArgumentValue(
  ctx: DataContext,
  value: unknown,
  depth: number,
  userActivated: boolean,
  options?: {allowAgentRouting?: boolean},
): unknown {
  const impl = getInternals();
  const scope =
    options?.allowAgentRouting === false ? impl.withFlags(ctx, {noAgentRouting: true}) : ctx;
  return impl.resolveValue(scope, value, depth, userActivated, true);
}

/**
 * Whether a call the renderer does not implement may be sent to the agent
 * from this context. It may not where the result cannot wait for the answer,
 * such as the arguments of an agent's `callRendererFunction`.
 *
 * @param ctx The context the call is evaluated in.
 * @returns Whether the call may be routed.
 */
export function allowsAgentRouting(ctx: DataContext): boolean {
  return getInternals().allowsAgentRouting(ctx);
}

/**
 * Resolves a value into a Signal that holds pending results as Promises.
 *
 * While a function call in `value` waits on an asynchronous call, the signal
 * holds a Promise that settles to the value or, from v1.0, to a
 * `FailedArgument` once the failure has been reported.
 *
 * @param ctx The context to resolve in.
 * @param value The DynamicValue to resolve.
 * @returns The Signal, whose `unsubscribe` ends its subscriptions.
 */
export function resolveSignalKeepingPending(ctx: DataContext, value: unknown): Signal<unknown> {
  return getInternals().resolveSignalValue(ctx, value, 0, true);
}

/**
 * Returns a view of `ctx` in which a call the renderer does not implement
 * fails instead of being sent to the agent.
 *
 * @param ctx The context to evaluate in.
 * @returns The view.
 */
export function withoutAgentRouting(ctx: DataContext): DataContext {
  return getInternals().withFlags(ctx, {noAgentRouting: true});
}

/**
 * Returns the catalog ID of the catalog function currently executing in `ctx`,
 * if any.
 *
 * @param ctx The context to inspect.
 * @returns The active catalog ID, or `undefined`.
 */
export function activeCallCatalogId(ctx: DataContext): string | undefined {
  return getInternals().activeCatalogId(ctx);
}

/**
 * Returns a view of `ctx` scoped to `catalogId` as the active function catalog.
 *
 * @param ctx The context to evaluate in.
 * @param catalogId The catalog ID of the executing function.
 * @param catalog Optional catalog instance so standalone RPC or direct invoker
 *   catalogs not registered in `surface.availableCatalogs` still resolve nested calls.
 * @returns The view.
 */
export function withActiveCallCatalogId(
  ctx: DataContext,
  catalogId: string,
  catalog?: Catalog<any>,
): DataContext {
  return getInternals().withFlags(ctx, {activeCatalogId: catalogId, activeCatalog: catalog});
}
