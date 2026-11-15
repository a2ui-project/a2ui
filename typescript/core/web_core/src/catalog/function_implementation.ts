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

import type {Signal} from '../reactivity/signals.js';
import type {DataContext} from '../resolution/data-context.js';
import type {AuthoredSchema} from './entry-schema.js';
import {copyLoadedDefinition} from './loaded_definitions.js';
import type {
  A2uiReturnType,
  FunctionImplementation,
  InferA2uiReturnType,
  ResolvedFunctionArgs,
} from './types.js';

/**
 * Creates a typed FunctionImplementation from an API definition and an execution callback.
 *
 * @param api The function API definition containing name, schema, and metadata.
 * @param execute The execution handler callback.
 * @returns A complete FunctionImplementation object.
 */
export function createFunctionImplementation<
  Schema extends AuthoredSchema = AuthoredSchema,
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
  const implementation: FunctionImplementation = {
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
  // An implementation of a function `Catalog.fromJson` loaded keeps its
  // definition, so `toJson` writes it as the catalog document does.
  copyLoadedDefinition(api, implementation);
  return implementation;
}
