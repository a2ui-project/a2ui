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

import type {Signal} from '../reactivity/signals.js';
import type {DataContext} from './data-context.js';

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
  const scope =
    options?.allowAgentRouting === false ? ctx['withFlags']({noAgentRouting: true}) : ctx;
  return scope['resolveValue'](value, depth, userActivated, true);
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
  return ctx['allowsAgentRouting'];
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
  return ctx['resolveSignalValue'](value, 0, true);
}

/**
 * Returns a view of `ctx` in which a call the renderer does not implement
 * fails instead of being sent to the agent.
 *
 * @param ctx The context to evaluate in.
 * @returns The view.
 */
export function withoutAgentRouting(ctx: DataContext): DataContext {
  return ctx['withFlags']({noAgentRouting: true});
}
