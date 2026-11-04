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

import type {AgentFunction} from './agent_function.js';

/**
 * Brand set on every `AgentFunction`, so `isAgentFunction` recognizes one
 * from another copy of this package.
 *
 * Kept apart from `AgentFunction` so that modules `AgentFunction` depends on,
 * such as the catalog serializer, can recognize one without a circular
 * import.
 */
export const AGENT_FUNCTION_BRAND = Symbol.for('@a2ui/web_core/AgentFunction');

/**
 * Type guard checking whether a value is an {@link AgentFunction}.
 */
export function isAgentFunction(value: unknown): value is AgentFunction {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[AGENT_FUNCTION_BRAND] === true &&
    typeof (value as {handler?: unknown}).handler === 'function'
  );
}
