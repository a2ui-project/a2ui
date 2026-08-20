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

/**
 * A2UI Web Core Library.
 *
 * Provides core catalog-agnostic state management, data binding, expression evaluation,
 * message processing, and validation infrastructure for A2UI renderers and clients.
 */

export * from './catalog/index.js';
export * from './state/index.js';
export * from './processing/index.js';
export * from './rendering/index.js';
export * from './validating/index.js';
export * from './reactivity/index.js';
export * from './expressions/index.js';
export * from './errors.js';
export * from './common/events.js';
