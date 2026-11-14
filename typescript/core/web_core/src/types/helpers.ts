/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  type ChildRefKind,
  type RefSchemaOptions,
  markChildRef,
  childRefKindOf,
} from './child-ref-helpers.js';

export {type ChildRefKind, type RefSchemaOptions, markChildRef, childRefKindOf};

/**
 * The maximum number of arguments accepted in a single function call.
 *
 * Caps the work a single call can schedule, so an oversized `args` payload
 * cannot exhaust memory by creating one reactive listener per key (CWE-400).
 * Enforced by `DataContext.validateFunctionArgs` before any argument is
 * resolved.
 */
export const MAX_FUNCTION_CALL_ARGS = 1_000;
