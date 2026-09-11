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

import type {ReactComponentImplementation} from './react_component_implementation';

/**
 * Type guard to check if an API or component implementation is a ReactComponentImplementation.
 *
 * @internal
 */
export function isReactComponentImplementation(api: unknown): api is ReactComponentImplementation {
  return (
    typeof api === 'object' &&
    api !== null &&
    !Array.isArray(api) &&
    'render' in api &&
    typeof (api as {render: unknown}).render === 'function'
  );
}
