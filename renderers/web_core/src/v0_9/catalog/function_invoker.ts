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

import {DataContext} from '../rendering/data-context.js';

/**
 * A function that invokes a catalog function by name and returns its result synchronously or as a Signal.
 *
 * @param name The name of the function to invoke.
 * @param args The arguments to pass to the function.
 * @param context The data context in which the function is being executed.
 * @param abortSignal An optional AbortSignal for asynchronous or long-running operations.
 * @returns The result of the function call, which can be a literal, a Signal, or a Promise (handled by the caller).
 */
export type FunctionInvoker = (
  name: string,
  args: Record<string, any>,
  context: DataContext,
  abortSignal?: AbortSignal,
) => any;
