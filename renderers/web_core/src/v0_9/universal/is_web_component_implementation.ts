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

import type {WebComponentImplementation} from './web_component_implementation.js';

/**
 * Type guard to check if a component API or implementation is a WebComponentImplementation.
 *
 * @param api The object to check
 * @returns true if the object implements WebComponentImplementation
 */
export function isWebComponentImplementation(api: unknown): api is WebComponentImplementation {
  return (
    typeof api === 'object' &&
    api !== null &&
    'tagName' in api &&
    typeof (api as {tagName?: unknown}).tagName === 'string'
  );
}
