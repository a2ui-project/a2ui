/*
 * Copyright 2026 Google LLC
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

// Enable Lit's SSR DOM shim (`@lit-labs/ssr-dom-shim`) when running under
// Closure/Node test runners before Lit modules are imported.
const g = globalThis as Record<string, unknown>;
g['CLOSURE_DEFINES'] = {
  ...((g['CLOSURE_DEFINES'] as Record<string, unknown> | undefined) ?? {}),
  'RUNNING_IN_NODEJS': true,
};

export {};
