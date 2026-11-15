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
 * zod 3 helpers for writing `@a2ui/web_core` catalog schemas. The root
 * exports the v1.0 common types; `v0_9` and `v1_0` (also the `./v0_9` and
 * `./v1_0` subpaths) hold each protocol version's.
 *
 * @module
 */

export {
  AccessibilityAttributes,
  Action,
  CheckRule,
  Checkable,
  Child,
  ChildList,
  ComponentId,
  DataBinding,
  DynamicBoolean,
  DynamicNumber,
  DynamicString,
  DynamicStringList,
  DynamicValue,
  FunctionCall,
  a2uiJsonSchema,
  component,
  fromZod3,
  type A2uiJsonSchemaTarget,
} from './v1_0.js';
export * as v0_9 from './v0_9.js';
export * as v1_0 from './v1_0.js';
